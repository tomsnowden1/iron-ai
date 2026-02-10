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
import {
  getCoachContextSnapshot,
  getCoachExerciseCandidates,
  getCoachRequestContext,
} from "./context";
import { getAllExercises } from "../db";
import { summarizeCoachMemory } from "./memory";
import { parseCoachActionDraftMessage } from "./actionDraftContract";
import { buildContextFingerprint } from "./fingerprint";
import { recordCoachPayloadTelemetry } from "./telemetry";
import {
  buildRepairPrompt,
  getValidationFailureMessage,
  isLegExerciseByMetadata,
  parseCoachEditIntent,
  validateAddLegEditResult,
  validateCoachResponse,
} from "./responseValidation";

const MAX_TOOL_LOOPS = 2;
const COACH_TEMPERATURE = 0.2;
const ENABLE_WRITE_TOOLS = false;
const MAX_PROMPT_HISTORY_MESSAGES = 24;
const MAX_PROMPT_HISTORY_CHARS = 32000;
const MAX_LEG_EDIT_CANDIDATES = 40;
const DEFAULT_APPENDED_SET_COUNT = 3;
const DEFAULT_APPENDED_REPS = 10;
const SAFE_EDIT_FAILURE_MESSAGE =
  "I couldn't safely apply that edit while keeping your current workout intact. Please try again with a more specific change request.";

export const SYSTEM_PROMPT = [
  "You are a supportive AI fitness coach.",
  "Be concise, practical, and friendly.",
  "Reply with a succinct assistantText.",
  "If proposing an action, include a JSON object in a fenced ```json``` block using contractVersion coach_action_v1 with assistantText and an optional actionDraft.",
  "Action drafts must include kind, confidence, risk, title, summary, and payload. For workouts/templates: payload includes name/title, optional gymId, and exercises: [{ exerciseId, sets?: [{ reps?, weight?, duration?, rpe? }], notes? }]. For gyms: payload includes name/title and optional equipmentIds.",
  "For workout/template drafts, every exercise must include exerciseId from the provided candidate exercise list.",
  "Never invent exercise IDs or exercise names outside the candidate list.",
  "If you cannot confidently map a requested exercise, return needsReview: [{ requestedName, suggestions: [{ exerciseId, name }] }] and do not guess.",
  "Never ask users to copy/paste JSON. Do not expose raw template or workout JSON in assistantText.",
  "For workout requests and workout edits, prefer actionDraft kind create_workout with a complete, updated exercise list.",
  "For template requests, prefer actionDraft kind create_template and guide users to save/open the template.",
  "Apply requested workout edits directly; do not enter repeated confirmation loops.",
  "The Context availability payload is authoritative for whether context sharing is enabled.",
  "Never fabricate available equipment. Only use equipmentSummary when provided.",
  "If contextEnabled is false, do NOT claim you can see equipment. Still provide a generic workout and include a brief nudge to enable context or choose a gym for personalization.",
  "If the user asks to adjust an existing workout draft, return an updated create_workout actionDraft even when contextEnabled is false.",
  "When asked to produce a workout, include at least 5 exercises with sets and reps.",
  "If context is missing, continue with safe generic assumptions when possible; only ask one clarifying question when the request is impossible without missing details.",
  "Do not invent user data. Use tools when you need workout history, templates, or exercises.",
  "Respect workout space equipment constraints. Never recommend exercises that require unavailable equipment.",
  "If contextEnabled is true and equipmentSummary exists, use only that equipment when generating workouts.",
  "Do not suggest creating a new gym/space if activeGymId is present or if a gym with the same normalized name already exists.",
  "Only suggest creating a gym if there is no activeGymId and no existing gyms match by normalized name.",
  "If activeGymId is present but equipmentSummary is missing, do not claim you can see equipment. Continue using the provided candidate list and include a brief nudge to enable context sharing for better personalization.",
  "When you provide a plan or recommendation, include a line: 'Designed for: <space name>'. If unknown, ask the user.",
  "If the context snapshot includes launchContext.source 'gym_detail', start your next reply with: \"I'll design workouts for <gym name>.\" Use the active space name if available.",
  "If the context snapshot includes launchContext.source 'exercise_detail', start your next reply with: \"Let's break down <exercise name>.\" Use the exercise name if available.",
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
  exerciseCandidates,
  currentDraft,
  editIntent,
  legEditCandidates,
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
  if (Array.isArray(exerciseCandidates) && exerciseCandidates.length > 0) {
    messages.push({
      role: "system",
      content: `Exercise candidates (authoritative JSON, choose exerciseId only from this list):\n${JSON.stringify(
        exerciseCandidates
      )}`,
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
  if (currentDraft && editIntent?.isEditRequest) {
    messages.push({
      role: "system",
      content: `Current draft (authoritative JSON):\n${JSON.stringify(currentDraft)}`,
    });
    if (editIntent.kind === "add_legs_exercises" && editIntent.addCount) {
      messages.push({
        role: "system",
        content: `Requested edit intent: append exactly ${editIntent.addCount} NEW legs exercises to the END. Preserve all existing exercises, sets, reps, and order unchanged.`,
      });
    }
    if (Array.isArray(legEditCandidates) && legEditCandidates.length > 0) {
      messages.push({
        role: "system",
        content: `Allowed legs edit candidates (authoritative JSON, choose exerciseId only from this list):\n${JSON.stringify(
          legEditCandidates
        )}`,
      });
    }
    messages.push({
      role: "system",
      content:
        "Draft editing contract: return coach_action_v1 JSON with assistantText and either (A) actionDraft for CREATE mode, or (B) editDraft for EDIT mode. EDIT mode format: { mode: \"EDIT\", ops: [{ op: \"add_exercises\", count: <number>, muscleGroup: \"legs\", placement: \"end\", exerciseIds?: [<id>...] }] }. Prefer EDIT mode whenever currentDraft is provided.",
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

function extractEditDraftPayloadFromAssistant(text) {
  const value = String(text ?? "");
  const fenceRegex = /```json\s*([\s\S]*?)```/gi;
  let match = null;
  while ((match = fenceRegex.exec(value)) !== null) {
    const parsed = safeParseJSON(match[1] ?? "");
    if (!parsed || typeof parsed !== "object") continue;
    const payload = parsed.editDraft ?? parsed.draftEdit ?? null;
    if (payload && typeof payload === "object") return payload;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = safeParseJSON(trimmed);
    if (parsed && typeof parsed === "object") {
      const payload = parsed.editDraft ?? parsed.draftEdit ?? null;
      if (payload && typeof payload === "object") return payload;
    }
  }
  return null;
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

function estimateConversationTokens(messages) {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function normalizePromptHistoryMessage(message) {
  if (!message || typeof message !== "object") return null;
  const role = String(message.role ?? "").trim();
  if (role !== "user" && role !== "assistant") return null;
  return {
    role,
    content:
      typeof message.content === "string"
        ? message.content
        : String(message.content ?? ""),
  };
}

function buildPromptHistoryWindow(chatHistory, userMessage) {
  const normalizedHistory = Array.isArray(chatHistory)
    ? chatHistory.map((entry) => normalizePromptHistoryMessage(entry)).filter(Boolean)
    : [];
  const nextUserMessage = String(userMessage ?? "");
  const fullHistory = [...normalizedHistory, { role: "user", content: nextUserMessage }];
  const byMessageLimit = fullHistory.slice(-MAX_PROMPT_HISTORY_MESSAGES);

  const boundedHistory = [];
  let charTotal = 0;
  for (let i = byMessageLimit.length - 1; i >= 0; i -= 1) {
    const message = byMessageLimit[i];
    const content = String(message.content ?? "");
    const nextTotal = charTotal + content.length;
    if (boundedHistory.length > 0 && nextTotal > MAX_PROMPT_HISTORY_CHARS) {
      continue;
    }
    boundedHistory.unshift({ role: message.role, content });
    charTotal = nextTotal;
  }

  if (
    !boundedHistory.length ||
    boundedHistory[boundedHistory.length - 1]?.role !== "user"
  ) {
    boundedHistory.push({ role: "user", content: nextUserMessage });
    charTotal += nextUserMessage.length;
  }

  return {
    history: boundedHistory,
    meta: {
      originalMessages: fullHistory.length,
      usedMessages: boundedHistory.length,
      droppedMessages: Math.max(0, fullHistory.length - boundedHistory.length),
      maxMessages: MAX_PROMPT_HISTORY_MESSAGES,
      maxChars: MAX_PROMPT_HISTORY_CHARS,
      charsUsed: charTotal,
    },
  };
}

function isContextWindowOverflowError(error) {
  const code = String(error?.code ?? "").toLowerCase();
  if (code.includes("context")) return true;
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("context length") ||
    message.includes("maximum context length") ||
    message.includes("too many tokens")
  );
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildExerciseCatalogById(exercises) {
  const list = Array.isArray(exercises) ? exercises : [];
  return new Map(
    list
      .map((exercise) => [toPositiveInt(exercise?.id), exercise])
      .filter(([id]) => id != null)
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLegMuscleGroup(value) {
  const normalized = normalizeText(value);
  return (
    normalized.includes("leg") ||
    normalized.includes("quad") ||
    normalized.includes("hamstring") ||
    normalized.includes("glute") ||
    normalized.includes("calf") ||
    normalized.includes("adductor") ||
    normalized.includes("abductor")
  );
}

function buildLegEditCandidates({
  exerciseCandidates,
  exerciseCatalogById,
  max = MAX_LEG_EDIT_CANDIDATES,
}) {
  const list = Array.isArray(exerciseCandidates) ? exerciseCandidates : [];
  const seen = new Set();
  const resolved = [];
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i];
    const exerciseId = toPositiveInt(candidate?.exerciseId ?? candidate?.id);
    if (exerciseId == null || seen.has(exerciseId)) continue;
    const canonical = exerciseCatalogById.get(exerciseId) ?? candidate;
    if (!isLegExerciseByMetadata(canonical)) continue;
    seen.add(exerciseId);
    resolved.push({
      exerciseId,
      name: canonical?.name ?? candidate?.name ?? `Exercise ${exerciseId}`,
      primaryMuscles: Array.isArray(canonical?.primaryMuscles)
        ? canonical.primaryMuscles
        : [],
      secondaryMuscles: Array.isArray(canonical?.secondaryMuscles)
        ? canonical.secondaryMuscles
        : [],
    });
    if (resolved.length >= max) break;
  }
  return resolved;
}

function buildDefaultExerciseSets(exerciseMeta) {
  const defaultSetCount =
    toPositiveInt(exerciseMeta?.default_sets) ?? DEFAULT_APPENDED_SET_COUNT;
  const defaultReps = toPositiveInt(exerciseMeta?.default_reps) ?? DEFAULT_APPENDED_REPS;
  return Array.from({ length: defaultSetCount }, () => ({ reps: defaultReps }));
}

function normalizeEditContract(editDraft) {
  if (!editDraft || typeof editDraft !== "object") {
    return { mode: null, ops: [] };
  }
  const mode = String(editDraft.mode ?? "").trim().toUpperCase();
  const ops = Array.isArray(editDraft.ops) ? editDraft.ops : [];
  return { mode, ops };
}

function applyAddLegExercisesOperation({
  draft,
  operation,
  legCandidates,
  exerciseCatalogById,
}) {
  const count = toPositiveInt(operation?.count);
  if (count == null) {
    return { valid: false, error: "add_exercises operation requires a positive count." };
  }
  const muscleGroup = operation?.muscleGroup ?? operation?.muscle_group ?? "legs";
  if (!isLegMuscleGroup(muscleGroup)) {
    return { valid: false, error: "add_exercises currently supports legs-only edits." };
  }
  const placement = String(operation?.placement ?? "end").trim().toLowerCase();
  if (placement !== "end") {
    return { valid: false, error: "add_exercises only supports placement=end." };
  }

  const exercises = Array.isArray(draft?.payload?.exercises) ? draft.payload.exercises : [];
  const existingIds = new Set(
    exercises.map((entry) => toPositiveInt(entry?.exerciseId)).filter((id) => id != null)
  );
  const legCandidateMap = new Map(
    legCandidates.map((entry) => [toPositiveInt(entry?.exerciseId), entry]).filter(([id]) => id != null)
  );

  const selected = [];
  const selectedSet = new Set();
  const requestedIds = Array.isArray(operation?.exerciseIds) ? operation.exerciseIds : [];
  requestedIds.forEach((rawId) => {
    const exerciseId = toPositiveInt(rawId);
    if (exerciseId == null) return;
    if (existingIds.has(exerciseId) || selectedSet.has(exerciseId)) return;
    if (!legCandidateMap.has(exerciseId)) return;
    selectedSet.add(exerciseId);
    selected.push(exerciseId);
  });

  for (let i = 0; i < legCandidates.length && selected.length < count; i += 1) {
    const exerciseId = toPositiveInt(legCandidates[i]?.exerciseId);
    if (exerciseId == null) continue;
    if (existingIds.has(exerciseId) || selectedSet.has(exerciseId)) continue;
    selectedSet.add(exerciseId);
    selected.push(exerciseId);
  }

  if (selected.length !== count) {
    return {
      valid: false,
      error: `Unable to append ${count} new leg exercises with the available candidate list.`,
    };
  }

  const appended = selected.map((exerciseId) => {
    const exerciseMeta = exerciseCatalogById.get(exerciseId) ?? legCandidateMap.get(exerciseId);
    const entry = {
      exerciseId,
      sets: buildDefaultExerciseSets(exerciseMeta),
    };
    if (exerciseMeta?.name) {
      entry.name = exerciseMeta.name;
    }
    return entry;
  });

  draft.payload.exercises = [...exercises, ...appended];
  return { valid: true, error: null };
}

function applyEditOperations({
  currentDraft,
  editOps,
  legCandidates,
  exerciseCatalogById,
}) {
  if (!currentDraft || typeof currentDraft !== "object") {
    return { valid: false, error: "Current workout draft is missing." };
  }
  const nextDraft = JSON.parse(JSON.stringify(currentDraft));
  if (!Array.isArray(nextDraft?.payload?.exercises)) {
    return { valid: false, error: "Current workout draft has no exercises to edit." };
  }

  for (let i = 0; i < editOps.length; i += 1) {
    const operation = editOps[i];
    const opName = String(operation?.op ?? "").trim();
    if (opName === "add_exercises") {
      const result = applyAddLegExercisesOperation({
        draft: nextDraft,
        operation,
        legCandidates,
        exerciseCatalogById,
      });
      if (!result.valid) return result;
      continue;
    }
    return {
      valid: false,
      error: `Unsupported edit operation: ${opName || "unknown"}.`,
    };
  }

  return { valid: true, error: null, draft: nextDraft };
}

export async function runCoachTurn({
  apiKey,
  keyMode = "user",
  chatHistory,
  userMessage,
  contextConfig,
  draftEditConfig = null,
  responseMode = "general",
  memoryEnabled,
  memorySummary,
  onStreamStart,
  onStreamDelta,
  onStreamEnd,
}) {
  const useServerKey = keyMode === "server";
  const allowReadTools = Boolean(contextConfig?.enabled);
  const allowedTools = new Set();
  if (ENABLE_WRITE_TOOLS) {
    WRITE_TOOLS.forEach((tool) => allowedTools.add(tool));
  }
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
    allowWrite: ENABLE_WRITE_TOOLS,
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
    promptWindow: null,
    contextWindowRetry: false,
    editIntent: null,
    editLegCandidateCount: 0,
    editResolution: null,
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
  let libraryExercises = [];
  let exerciseCandidates = [];
  let libraryIdSet = new Set();
  let allowedCandidateIds = new Set();
  let exerciseCatalogById = new Map();
  try {
    libraryExercises = await getAllExercises();
    libraryIdSet = new Set(
      libraryExercises
        .map((exercise) => Number.parseInt(exercise?.id, 10))
        .filter((id) => Number.isFinite(id) && id > 0)
    );
    exerciseCatalogById = buildExerciseCatalogById(libraryExercises);
  } catch {
    libraryExercises = [];
    libraryIdSet = new Set();
    exerciseCatalogById = new Map();
  }
  try {
    exerciseCandidates = await getCoachExerciseCandidates({
      activeGymId,
      contextEnabled: contextState.contextEnabled,
      userMessage,
    });
  } catch {
    exerciseCandidates = [];
  }
  if (!exerciseCandidates.length && libraryExercises.length) {
    exerciseCandidates = libraryExercises.slice(0, 40).map((exercise) => ({
      exerciseId: exercise.id,
      name: exercise.name ?? "Unknown Exercise",
      aliases: Array.isArray(exercise.aliases) ? exercise.aliases : [],
      equipment: Array.isArray(exercise.equipment) ? exercise.equipment : [],
      primaryMuscles: Array.isArray(exercise.primaryMuscles)
        ? exercise.primaryMuscles
        : [],
    }));
  }
  allowedCandidateIds = new Set(
    exerciseCandidates
      .map((candidate) => Number.parseInt(candidate?.exerciseId ?? candidate?.id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const currentDraft = draftEditConfig?.currentDraft ?? null;
  const hasEditableWorkoutDraft =
    currentDraft?.kind === "create_workout" &&
    Array.isArray(currentDraft?.payload?.exercises) &&
    currentDraft.payload.exercises.length > 0;
  const editIntent = hasEditableWorkoutDraft
    ? parseCoachEditIntent(userMessage)
    : { isEditRequest: false, kind: null, addCount: null };
  const editModeEnabled = Boolean(hasEditableWorkoutDraft && editIntent.isEditRequest);
  const legEditCandidates = editModeEnabled
    ? buildLegEditCandidates({ exerciseCandidates, exerciseCatalogById })
    : [];
  debug.editIntent = editIntent;
  debug.editLegCandidateCount = legEditCandidates.length;

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
    candidateExerciseCount: exerciseCandidates.length,
    summaryOnly,
  };

  const systemMessages = buildSystemMessages({
    contextSnapshot,
    memorySummary: memorySummaryData,
    requestContext,
    contextState,
    exerciseCandidates,
    currentDraft: editModeEnabled ? currentDraft : null,
    editIntent,
    legEditCandidates,
  });
  const promptHistoryWindow = buildPromptHistoryWindow(chatHistory, userMessage);

  let loop = 0;
  let history = promptHistoryWindow.history;
  let conversation = [...systemMessages, ...history];
  debug.promptWindow = promptHistoryWindow.meta;
  debug.estimatedTokens = estimateConversationTokens(conversation);

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
  debug.exerciseCandidateCount = exerciseCandidates.length;

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
    let streamResult = null;
    const runStreamRequest = (messages) =>
      streamChatCompletion({
        apiKey,
        useServerKey,
        model: DEFAULT_COACH_MODEL,
        messages,
        tools,
        onDelta: onStreamDelta,
        onStart: onStreamStart,
        onEnd: onStreamEnd,
      });

    try {
      streamResult = await runStreamRequest(conversation);
    } catch (error) {
      if (!debug.contextWindowRetry && isContextWindowOverflowError(error)) {
        debug.contextWindowRetry = true;
        debug.contextWindowRetryError =
          String(error?.message ?? "").trim() || "Context window exceeded";
        history = [{ role: "user", content: String(userMessage ?? "") }];
        conversation = [...systemMessages, ...history];
        debug.promptWindow = {
          ...(debug.promptWindow ?? {}),
          usedMessages: history.length,
          droppedMessages: Math.max(
            0,
            (debug.promptWindow?.originalMessages ?? history.length) - history.length
          ),
          retriedWithMinimalHistory: true,
          charsUsed: history[0]?.content?.length ?? 0,
        };
        debug.estimatedTokens = estimateConversationTokens(conversation);
        streamResult = await runStreamRequest(conversation);
      } else {
        throw error;
      }
    }

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
    conversation = [...systemMessages, ...history];

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
    conversation = [...systemMessages, ...history];
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
  } else if (!editModeEnabled) {
    const firstValidation = validateCoachResponse({
      userMessage,
      assistantText: finalAssistant,
      responseMode,
      contextEnabled: contextState.contextEnabled,
      allowedCandidateIds,
      libraryIdSet,
      currentDraft: editModeEnabled ? currentDraft : null,
      editIntent,
      exerciseCatalogById,
    });
    responseValidation.mode = firstValidation.mode;
    if (!firstValidation.valid) {
      const repairPrompt = buildRepairPrompt({
        validationMode: firstValidation.mode,
        contextEnabled: contextState.contextEnabled,
        invalidContent: finalAssistant,
        selectedGym: contextState.selectedGym,
        candidateExercises: exerciseCandidates,
      });
      let repairedAssistant = "";
      try {
        const repairCompletion = await createChatCompletion({
          apiKey,
          useServerKey,
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
        allowedCandidateIds,
        libraryIdSet,
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
  } else {
    responseValidation = {
      status: "ok",
      mode: "workout",
      repaired: false,
      error: null,
    };
  }

  const parsedActionDraft = parseCoachActionDraftMessage(finalAssistant);
  let assistantText = parsedActionDraft.assistantText || finalAssistant;
  let actionDraft = parsedActionDraft.actionDraft ?? null;
  const parsedEditDraft = extractEditDraftPayloadFromAssistant(finalAssistant);
  const actionContractVersion = parsedActionDraft.contractVersion ?? null;
  const actionParseErrors = parsedActionDraft.parseErrors ?? null;

  if (editModeEnabled) {
    const editContract = normalizeEditContract(parsedEditDraft);
    let resolvedDraft = null;
    let editResolutionError = null;

    if (editIntent.kind === "add_legs_exercises") {
      const opFromModel = editContract.mode === "EDIT" ? editContract.ops : [];
      const fallbackOps = [
        {
          op: "add_exercises",
          count: editIntent.addCount,
          muscleGroup: "legs",
          placement: "end",
        },
      ];
      const opsToApply = opFromModel.length ? opFromModel : fallbackOps;
      const editResult = applyEditOperations({
        currentDraft,
        editOps: opsToApply,
        legCandidates: legEditCandidates,
        exerciseCatalogById,
      });
      if (editResult.valid) {
        resolvedDraft = editResult.draft;
      } else {
        editResolutionError = editResult.error;
      }
    } else if (editContract.mode === "CREATE" && actionDraft) {
      resolvedDraft = actionDraft;
    } else if (actionDraft) {
      resolvedDraft = actionDraft;
    } else {
      editResolutionError = "No editable workout draft update was returned.";
    }

    if (resolvedDraft && editIntent.kind === "add_legs_exercises") {
      const guard = validateAddLegEditResult({
        currentDraft,
        nextDraft: resolvedDraft,
        addCount: editIntent.addCount,
        exerciseCatalogById,
      });
      if (!guard.valid) {
        editResolutionError = guard.error;
        resolvedDraft = null;
      }
    }

    if (resolvedDraft) {
      actionDraft = resolvedDraft;
      debug.editResolution = {
        status: "applied",
        mode: editContract.mode || "AUTO",
      };
    } else {
      actionDraft = currentDraft ?? null;
      assistantText = SAFE_EDIT_FAILURE_MESSAGE;
      debug.editResolution = {
        status: "failed",
        mode: editContract.mode || "AUTO",
        error: editResolutionError ?? "Unable to apply edit.",
      };
    }
  }

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
