import {
  DEFAULT_COACH_MODEL,
  createChatCompletion,
  streamChatCompletion,
} from "../services/openai";
import {
  executeTool,
  getOpenAITools,
  getToolRegistry,
  summarizeToolCall,
  validateToolInput,
} from "./tools";
import { getCoachContextSnapshot, getCoachRequestContext } from "./context";
import { summarizeCoachMemory } from "./memory";
import { parseCoachActionDraftMessage } from "./actionDraftContract";
import { buildContextFingerprint } from "./fingerprint";
import { recordCoachPayloadTelemetry } from "./telemetry";
import {
  buildRepairPrompt,
  getValidationFailureMessage,
  validateCoachResponse,
} from "./responseValidation";

const MAX_TOOL_LOOPS = 2;
const COACH_TEMPERATURE = 0.2;

export const SYSTEM_PROMPT = [
  "You are a supportive AI fitness coach.",
  "Be concise, practical, and friendly.",
  "Reply with a succinct assistantText.",
  "If proposing an action, include a JSON object in a fenced ```json``` block using contractVersion coach_action_v1 with assistantText and an optional actionDraft.",
  "Action drafts must include kind, confidence, risk, title, summary, and payload. For workouts/templates: payload includes name/title, optional gymId, and exercises: [{ exerciseId, sets?: [{ reps?, weight?, duration?, rpe? }], notes? }]. For gyms: payload includes name/title and optional equipmentIds.",
  "The Context availability payload is authoritative for whether context sharing is enabled.",
  "Never fabricate available equipment. Only use equipmentSummary when provided.",
  "If contextEnabled is false, do NOT claim you can see equipment. Ask the user to enable context or choose a gym, then stop.",
  "When asked to produce a workout, you MUST output at least 5 exercises with sets and reps in a fenced ```json``` block shaped as { name, exercises: [{ name, sets, reps }] }.",
  "If you cannot comply due to missing context, ask for the missing information and stop.",
  "When asked to convert to template JSON, output ONLY a fenced ```json``` block with { name, exercises: [{ exerciseId, sets, reps, warmupSets? }] } and no extra text.",
  "Do not invent user data. Use tools when you need workout history, templates, or exercises.",
  "Respect workout space equipment constraints. Never recommend exercises that require unavailable equipment.",
  "If contextEnabled is true and equipmentSummary exists, use only that equipment when generating workouts.",
  "Do not suggest creating a new gym/space if activeGymId is present or if a gym with the same normalized name already exists.",
  "Only suggest creating a gym if there is no activeGymId and no existing gyms match by normalized name.",
  "If activeGymId is present but equipmentSummary is missing, say you cannot see equipment and ask the user to enable context sharing or share their equipment.",
  "When you provide a plan or recommendation, include a line: 'Designed for: <space name>'. If unknown, ask the user.",
  "If the context snapshot includes launchContext.source 'gym_detail', start your next reply with: \"I'll design workouts for <gym name>.\" Use the active space name if available.",
  "If the context snapshot includes launchContext.source 'exercise_detail', start your next reply with: \"Let's break down <exercise name>.\" Use the exercise name if available.",
  "If a write action is requested, ask for user confirmation before changes are made.",
  "Avoid high-risk actionDrafts unless the user explicitly requests overwriting or destructive changes.",
  "Avoid asking multiple clarifying questions; propose reasonable defaults instead.",
  "Avoid medical advice; recommend a professional for injuries or health concerns.",
].join(" ");

const READ_TOOL_SCOPES = {
  sessions: ["get_recent_sessions", "get_session_detail", "get_training_summary"],
  templates: ["get_templates", "get_template_detail"],
  exerciseHistory: ["search_exercises", "get_exercise_history", "get_personal_records"],
  spaces: [
    "get_workout_spaces",
    "get_active_space",
    "get_equipment_for_space",
    "get_exercise_substitutions",
  ],
};

const WRITE_TOOLS = [
  "create_template",
  "add_planned_workout",
  "update_user_goal",
  "create_workout_space",
  "update_workout_space",
  "set_active_space",
];

function normalizeContextStatePayload(contextConfig, requestContext) {
  const selectedGym =
    contextConfig?.contextState?.selectedGym ??
    (requestContext?.activeGymId != null
      ? {
          id: requestContext.activeGymId,
          name: requestContext.gymName ?? null,
        }
      : null);
  const contextEnabled = Boolean(contextConfig?.enabled);
  let equipmentSummary = [];
  if (contextEnabled) {
    const provided = contextConfig?.contextState?.equipmentSummary;
    if (typeof provided === "string") {
      equipmentSummary = provided.trim() ? provided.trim() : [];
    } else if (Array.isArray(provided)) {
      equipmentSummary = provided;
    }
  }
  return {
    contextEnabled,
    selectedGym:
      selectedGym && selectedGym.id != null
        ? { id: selectedGym.id, name: selectedGym.name ?? null }
        : null,
    equipmentSummary,
  };
}

export function buildSystemMessages({
  contextSnapshot,
  memorySummary,
  requestContext,
  contextState,
}) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (contextState) {
    messages.push({
      role: "system",
      content: `Context availability (authoritative JSON):\n${JSON.stringify(contextState)}`,
    });
  }
  if (memorySummary) {
    messages.push({
      role: "system",
      content: `Coach memory summary (JSON):\n${JSON.stringify(memorySummary)}`,
    });
  }
  if (requestContext) {
    messages.push({
      role: "system",
      content: `Coach request context (JSON):\n${JSON.stringify(requestContext)}`,
    });
  }
  if (contextSnapshot) {
    messages.push({
      role: "system",
      content: `Context snapshot (JSON, may be truncated):\n${JSON.stringify(
        contextSnapshot
      )}`,
    });
  }
  return messages;
}

function extractCompletionContent(completion) {
  const message = completion?.choices?.[0]?.message;
  if (!message) return "";
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        return typeof part?.text === "string" ? part.text : "";
      })
      .join("")
      .trim();
  }
  return "";
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildToolResultMessage(toolCallId, result) {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify(result),
  };
}

function buildAssistantToolCallMessage(toolCalls) {
  return {
    role: "assistant",
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: call.type ?? "function",
      function: {
        name: call.function?.name ?? call.name,
        arguments: call.function?.arguments ?? call.arguments ?? "",
      },
    })),
  };
}

export async function runCoachTurn({
  apiKey,
  chatHistory,
  userMessage,
  contextConfig,
  responseMode = "general",
  memoryEnabled,
  memorySummary,
  onStreamStart,
  onStreamDelta,
  onStreamEnd,
}) {
  const allowReadTools = Boolean(contextConfig?.enabled);
  const allowedTools = new Set(WRITE_TOOLS);
  const activeGymId = contextConfig?.activeGymId ?? null;
  if (allowReadTools) {
    const scopes = contextConfig?.scopes ?? {};
    Object.entries(READ_TOOL_SCOPES).forEach(([scopeKey, toolNames]) => {
      if (!scopes[scopeKey]) return;
      toolNames.forEach((toolName) => allowedTools.add(toolName));
    });
  }
  const tools = getOpenAITools({
    allowRead: allowReadTools,
    allowWrite: true,
    allowedTools,
  });
  const registry = getToolRegistry();
  const toolEvents = [];
  const proposals = [];
  const debug = {
    model: DEFAULT_COACH_MODEL,
    toolCalls: [],
    contextMeta: null,
    contextContract: null,
    allowedTools: Array.from(allowedTools),
    payloadFingerprint: null,
    payloadBuiltAt: null,
    requestContext: null,
    requestMeta: null,
    requestFingerprint: null,
    actionContractVersion: null,
    actionParseErrors: null,
    actionDraft: null,
    contextState: null,
    responseValidation: null,
  };

  const memorySummaryData = memoryEnabled ? summarizeCoachMemory(memorySummary) : null;

  let requestContext = {
    activeGymId: null,
    gymName: null,
    equipmentIds: [],
    equipmentCount: 0,
    exerciseLibraryCount: 0,
    customExercisesCount: 0,
    templatesCount: 0,
    recentWorkoutsCount: 0,
    lastWorkoutDate: null,
    contextBytes: 0,
    contextBuildMs: 0,
  };
  let requestMeta = { contextBytes: 0, contextBuildMs: 0 };
  try {
    const result = await getCoachRequestContext({ activeGymId });
    requestContext = result.context ?? requestContext;
    requestMeta = result.meta ?? requestMeta;
  } catch {
    // Fall back to a minimal request context if the DB is unavailable.
  }
  const requestFingerprint = await buildContextFingerprint(
    requestContext,
    requestMeta?.contextBytes ?? null
  );
  const requestExerciseCount =
    (requestContext.exerciseLibraryCount ?? 0) + (requestContext.customExercisesCount ?? 0);
  const contextState = normalizeContextStatePayload(contextConfig, requestContext);

  let contextSnapshot = null;
  let contextContract = null;
  if (contextConfig?.enabled) {
    // TODO: Extend context snapshot sources (planner, long-term stats) as needed.
    const { snapshot, meta, contract } = await getCoachContextSnapshot({
      scopes: contextConfig.scopes,
      sessionLimit: contextConfig.sessionLimit,
      templateLimit: contextConfig.templateLimit,
      memorySummary: memoryEnabled ? memorySummary : null,
      launchContext: contextConfig.launchContext ?? null,
      activeGymId,
    });
    contextSnapshot = snapshot;
    contextContract = contract ?? null;
    debug.contextMeta = meta;
    debug.contextContract = contextContract;
  }
  const templatesAvailable = Boolean(contextConfig?.enabled && contextConfig.scopes?.templates);
  const sessionsAvailable = Boolean(contextConfig?.enabled && contextConfig.scopes?.sessions);
  const summaryOnly = !contextSnapshot;
  const payloadSummary = {
    activeGymId: contextContract?.activeGymId ?? requestContext.activeGymId ?? null,
    activeGymName: contextContract?.activeGymName ?? requestContext.gymName ?? null,
    equipmentCount: contextContract?.equipmentCount ?? requestContext.equipmentCount ?? 0,
    equipmentIds: requestContext.equipmentIds ?? [],
    exerciseLibraryCount:
      contextContract?.exerciseLibraryCount ?? requestContext.exerciseLibraryCount ?? 0,
    customExercisesCount:
      contextContract?.customExercisesCount ?? requestContext.customExercisesCount ?? 0,
    templatesCount: templatesAvailable
      ? contextContract?.templatesCount ?? requestContext.templatesCount ?? null
      : null,
    recentWorkoutsCount: sessionsAvailable
      ? contextContract?.recentWorkoutsCount ?? requestContext.recentWorkoutsCount ?? null
      : null,
    contextBytes: contextContract?.contextBytes ?? requestMeta.contextBytes ?? null,
    buildMs: contextContract?.buildMs ?? requestMeta.contextBuildMs ?? null,
    summaryOnly,
  };

  let loop = 0;
  let history = [...chatHistory, { role: "user", content: userMessage }];
  let conversation = [
    ...buildSystemMessages({
      contextSnapshot,
      memorySummary: memorySummaryData,
      requestContext,
      contextState,
    }),
    ...history,
  ];
  debug.estimatedTokens = Math.ceil(JSON.stringify(conversation).length / 4);

  let payloadFingerprint = requestFingerprint;
  let payloadBuiltAt = Date.now();
  let snapshotFingerprint = null;
  let finalAssistant = null;
  let pendingToolMessages = [];

  debug.payloadFingerprint = payloadFingerprint;
  debug.payloadBuiltAt = payloadBuiltAt;
  debug.requestContext = requestContext;
  debug.requestMeta = requestMeta;
  debug.requestFingerprint = requestFingerprint;
  debug.contextState = contextState;

  console.info(
    `coach_payload gym=${requestContext.activeGymId ?? "none"} eq=${
      requestContext.equipmentCount ?? 0
    } ex=${requestExerciseCount} bytes=${requestMeta?.contextBytes ?? 0} ms=${
      requestMeta?.contextBuildMs ?? 0
    } fp=${requestFingerprint.hash}`
  );

  if (contextSnapshot) {
    snapshotFingerprint = await buildContextFingerprint(
      contextSnapshot,
      contextContract?.contextBytes ?? null
    );
    await recordCoachPayloadTelemetry({
      fingerprint: snapshotFingerprint,
      contract: contextContract,
      builtAt: payloadBuiltAt,
    });
  }

  while (loop < MAX_TOOL_LOOPS) {
    loop += 1;
    const streamResult = await streamChatCompletion({
      apiKey,
      model: DEFAULT_COACH_MODEL,
      messages: conversation,
      tools,
      onDelta: onStreamDelta,
      onStart: onStreamStart,
      onEnd: onStreamEnd,
    });

    debug.toolCalls = streamResult.toolCalls ?? [];

    if (!streamResult.toolCalls?.length) {
      finalAssistant = streamResult.content ?? "";
      if (finalAssistant) {
        history = [...history, { role: "assistant", content: finalAssistant }];
      }
      break;
    }

    const assistantToolCallMessage = buildAssistantToolCallMessage(streamResult.toolCalls);
    history = [...history, assistantToolCallMessage];
    conversation = [
      ...buildSystemMessages({
        contextSnapshot,
        memorySummary: memorySummaryData,
        requestContext,
        contextState,
      }),
      ...history,
    ];

    pendingToolMessages = [];
    for (const toolCall of streamResult.toolCalls) {
      const name = toolCall.function?.name ?? toolCall.name;
      const argsText = toolCall.function?.arguments ?? toolCall.arguments ?? "{}";
      const parsedArgs = safeParseJSON(argsText) ?? {};
      const tool = registry.get(name);

      if (!allowedTools.has(name)) {
        toolEvents.push({
          name,
          status: "error",
          summary: "Tool blocked by context settings.",
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "error",
            error: "Tool blocked by context settings.",
          })
        );
        continue;
      }

      if (!tool) {
        toolEvents.push({
          name,
          status: "error",
          summary: "Tool not found.",
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "error",
            error: "Tool not found.",
          })
        );
        continue;
      }

      const validation = validateToolInput(tool, parsedArgs);
      if (!validation.valid) {
        toolEvents.push({
          name,
          status: "error",
          summary: "Invalid tool input.",
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "error",
            error: validation.errors.join("; "),
          })
        );
        continue;
      }

      if (tool.isWriteTool) {
        const summary = summarizeToolCall(name, parsedArgs);
        proposals.push({
          id: toolCall.id,
          name,
          input: parsedArgs,
          summary,
          status: "pending",
        });
        toolEvents.push({
          name,
          status: "pending",
          summary,
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "pending_confirmation",
            summary,
          })
        );
        continue;
      }

      try {
        const result = await executeTool(name, parsedArgs, {
          scopes: contextConfig?.scopes ?? {},
          activeGymId,
        });
        toolEvents.push({
          name,
          status: "success",
          summary: summarizeToolCall(name, parsedArgs),
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "success",
            result,
          })
        );
      } catch (err) {
        toolEvents.push({
          name,
          status: "error",
          summary: summarizeToolCall(name, parsedArgs),
        });
        pendingToolMessages.push(
          buildToolResultMessage(toolCall.id, {
            status: "error",
            error: err?.message ?? "Tool failed.",
          })
        );
      }
    }

    history = [...history, ...pendingToolMessages];
    conversation = [
      ...buildSystemMessages({
        contextSnapshot,
        memorySummary: memorySummaryData,
        requestContext,
        contextState,
      }),
      ...history,
    ];
  }

  let responseValidation = {
    status: "ok",
    mode: "general",
    repaired: false,
    error: null,
  };

  if (!finalAssistant) {
    finalAssistant = "I ran into an issue while preparing your response.";
    history = [...history, { role: "assistant", content: finalAssistant }];
  } else {
    const firstValidation = validateCoachResponse({
      userMessage,
      assistantText: finalAssistant,
      responseMode,
      contextEnabled: contextState.contextEnabled,
    });
    responseValidation.mode = firstValidation.mode;
    if (!firstValidation.valid) {
      const repairPrompt = buildRepairPrompt({
        validationMode: firstValidation.mode,
        contextEnabled: contextState.contextEnabled,
        invalidContent: finalAssistant,
        selectedGym: contextState.selectedGym,
      });
      let repairedAssistant = "";
      try {
        const repairCompletion = await createChatCompletion({
          apiKey,
          model: DEFAULT_COACH_MODEL,
          messages: [
            ...conversation,
            { role: "assistant", content: finalAssistant },
            { role: "user", content: repairPrompt },
          ],
          temperature: COACH_TEMPERATURE,
        });
        repairedAssistant = extractCompletionContent(repairCompletion);
      } catch {
        repairedAssistant = "";
      }

      const repairedValidation = validateCoachResponse({
        userMessage,
        assistantText: repairedAssistant,
        responseMode,
        contextEnabled: contextState.contextEnabled,
      });
      if (repairedValidation.valid) {
        finalAssistant = repairedAssistant;
        responseValidation = {
          status: "repaired",
          mode: repairedValidation.mode,
          repaired: true,
          error: null,
        };
      } else {
        finalAssistant = getValidationFailureMessage(firstValidation.mode);
        responseValidation = {
          status: "failed",
          mode: repairedValidation.mode,
          repaired: true,
          error: repairedValidation.error ?? firstValidation.error ?? "Validation failed.",
        };
      }
      if (history.length && history[history.length - 1]?.role === "assistant") {
        history = [
          ...history.slice(0, -1),
          { ...history[history.length - 1], content: finalAssistant },
        ];
      } else {
        history = [...history, { role: "assistant", content: finalAssistant }];
      }
    }
  }

  const parsedActionDraft = parseCoachActionDraftMessage(finalAssistant);
  const assistantText = parsedActionDraft.assistantText || finalAssistant;
  const actionDraft = parsedActionDraft.actionDraft ?? null;
  const actionContractVersion = parsedActionDraft.contractVersion ?? null;
  const actionParseErrors = parsedActionDraft.parseErrors ?? null;

  if (history.length && history[history.length - 1]?.role === "assistant") {
    history = [
      ...history.slice(0, -1),
      { ...history[history.length - 1], content: assistantText },
    ];
  }

  debug.actionContractVersion = actionContractVersion;
  debug.actionParseErrors = actionParseErrors;
  debug.actionDraft = actionDraft;
  debug.responseValidation = responseValidation;

  return {
    assistant: assistantText,
    conversation: history,
    toolEvents,
    proposals,
    pendingToolMessages,
    debug,
    contextContract,
    payloadFingerprint,
    payloadBuiltAt,
    payloadSummary,
    actionDraft,
    actionContractVersion,
    actionParseErrors,
    responseValidation,
  };
}

export async function executeWriteToolCall({ proposal, onResult, context }) {
  if (!proposal) return null;
  try {
    const result = await executeTool(proposal.name, proposal.input, context);
    onResult?.({ status: "success", result });
    return { status: "success", result };
  } catch (err) {
    const error = err?.message ?? "Tool failed.";
    onResult?.({ status: "error", error });
    return { status: "error", error };
  }
}
