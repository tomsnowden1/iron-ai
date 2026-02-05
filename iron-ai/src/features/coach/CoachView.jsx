import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
  Label,
  PageHeader,
  Select,
} from "../../components/ui";
import { getCoachContextSnapshot } from "../../coach/context";
import { normalizeCoachMemory } from "../../coach/memory";
import { coachReducer, initialCoachState } from "../../coach/state";
import { actionDraftReducer, initialActionDraftState } from "../../coach/actionDraftState";
import { ActionDraftKinds } from "../../coach/actionDraftContract";
import { executeActionDraft, validateActionDraft } from "../../coach/actionDraftExecution";
import { executeWriteToolCall, runCoachTurn } from "../../coach/orchestrator";
import { buildContextFingerprint } from "../../coach/fingerprint";
import { resolveTemplateExercises } from "../../coach/templateExerciseMapping";
import { executeTool, getToolRegistry } from "../../coach/tools";
import { getCoachAccessState } from "./coachAccess";
import { resolveTemplateDraftInfo } from "./templateDraft";
import { setOpenAIKeyStatus, useCoachMemoryEnabled, useSettings } from "../../state/settingsStore";
import {
  db,
  getAllExercises,
  listWorkoutSpaces,
  setActiveWorkoutSpace,
} from "../../db";
import { sortSpacesByName } from "../../workoutSpaces/logic";

import BottomSheet from "../../components/ui/BottomSheet";

function createMessage(id, role, content, meta) {
  return {
    id,
    role,
    content,
    meta: meta ?? null,
    createdAt: Date.now(),
  };
}

function resolveErrorMessage(err, accessState) {
  if (!accessState?.canChat) return accessState?.message ?? "";
  if (err?.status === 401 || err?.status === 403) {
    return "That API key was rejected. Update it in Settings.";
  }
  if (err?.status === 429) {
    return "OpenAI rate limit hit. Please wait and try again.";
  }
  if (err?.status >= 500) {
    return "OpenAI is having trouble right now. Please try again soon.";
  }
  if (!err?.status) {
    return "Network error. Check your connection and try again.";
  }
  return "Couldn't reach the coach. Check your connection and try again.";
}

function summarizeProposalResult(result) {
  if (!result) return "Proposal complete.";
  if (result.status === "success") return "Proposal completed.";
  if (result.status === "error") return "Proposal failed.";
  return "Proposal updated.";
}

function equipmentCount(equipmentIds) {
  if (!Array.isArray(equipmentIds)) return null;
  return equipmentIds.filter((id) => id !== "bodyweight").length;
}

function formatEquipmentCount(space) {
  const count = equipmentCount(space?.equipmentIds);
  if (count == null) return "— equipment";
  return `${count} equipment`;
}

function formatCount(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return value;
}

function formatDateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function formatIdList(values, limit = 8) {
  if (!Array.isArray(values) || values.length === 0) return "—";
  const safe = values.map((value) => String(value)).filter((value) => value.length > 0);
  if (!safe.length) return "—";
  const truncated = safe.slice(0, limit);
  const suffix = safe.length > limit ? ` ...+${safe.length - limit}` : "";
  return `${truncated.join(", ")}${suffix}`;
}

function formatTemplateMappingPreview(mapping, limit = 5) {
  const list = Array.isArray(mapping) ? mapping : [];
  const trimmed = list.slice(0, limit);
  const remainder = Math.max(0, list.length - trimmed.length);
  const lines = trimmed.map((entry) => {
    const draftLabel =
      entry.draftName || (entry.draftId != null ? `ID ${entry.draftId}` : "Unknown");
    if (!entry.resolvedId) {
      return `${draftLabel} → create custom`;
    }
    const resolvedLabel = entry.resolvedName ?? "Unknown";
    return `${draftLabel} → ${resolvedLabel} (#${entry.resolvedId})`;
  });
  if (remainder) lines.push(`… +${remainder} more`);
  return lines;
}

function summarizeIdList(ids, limit = 6) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { items: [], omitted: 0 };
  }
  const items = ids.slice(0, limit);
  const omitted = Math.max(0, ids.length - items.length);
  return { items, omitted };
}

function formatConfidence(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toFixed(2);
}

function hasCoachContextCounts(contract) {
  if (!contract) return false;
  const counts = [
    contract.recentWorkoutsCount,
    contract.templatesCount,
    contract.customExercisesCount,
    contract.exerciseLibraryCount,
  ];
  return counts.some((value) => Number(value) > 0);
}

const TEMPLATE_REQUEST_PROMPT =
  "Convert your last plan into the IronAI template JSON format. " +
  "Reply with a fenced ```json``` block containing { name, exercises: [{ exerciseId, sets, reps, warmupSets? }] }.";
export default function CoachView({
  launchContext,
  onLaunchContextConsumed,
  onNotify,
  onOpenTemplate,
  onOpenWorkout,
  onNavigateToGyms,
  diagnosticsEnabled,
}) {
  const { settings, apiKey, hasKey, keyStatus } = useSettings();
  const { coachMemoryEnabled } = useCoachMemoryEnabled();
  const memoryEnabled = coachMemoryEnabled ?? false;
  const memory = useMemo(
    () => normalizeCoachMemory(settings?.coach_memory),
    [settings?.coach_memory]
  );
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[coachMemory] Coach value ->", coachMemoryEnabled);
  }, [coachMemoryEnabled]);

  const templateTool = useMemo(() => getToolRegistry().get("create_template"), []);
  const [state, dispatch] = useReducer(coachReducer, initialCoachState);
  const [actionState, actionDispatch] = useReducer(
    actionDraftReducer,
    initialActionDraftState
  );
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const sortedSpaces = useMemo(
    () => (workoutSpaces ? sortSpacesByName(workoutSpaces) : []),
    [workoutSpaces]
  );
  const exerciseMap = useMemo(
    () => new Map((allExercises ?? []).map((exercise) => [exercise.id, exercise])),
    [allExercises]
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [contextPreview, setContextPreview] = useState(null);
  const [contextMeta, setContextMeta] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextContract, setContextContract] = useState(null);
  const [payloadFingerprint, setPayloadFingerprint] = useState(null);
  const [payloadSummary, setPayloadSummary] = useState(null);
  const [debugContextContract, setDebugContextContract] = useState(null);
  const [debugContextFingerprint, setDebugContextFingerprint] = useState(null);
  const [templateMappingPreview, setTemplateMappingPreview] = useState({});
  const [gymPickerOpen, setGymPickerOpen] = useState(false);
  const [pendingLaunchContext, setPendingLaunchContext] = useState(
    () => launchContext ?? null
  );
  const [pendingTemplateRequest, setPendingTemplateRequest] = useState(false);
  const [templateConfirmDraft, setTemplateConfirmDraft] = useState(null);
  const [templateConfirmOpen, setTemplateConfirmOpen] = useState(false);
  const [templateCreating, setTemplateCreating] = useState(false);
  const [actionEditMode, setActionEditMode] = useState(false);
  const [actionEditDraft, setActionEditDraft] = useState({ title: "", gymId: "" });
  const [actionErrors, setActionErrors] = useState([]);
  const [actionWarnings, setActionWarnings] = useState([]);
  const [actionApplying, setActionApplying] = useState(false);
  const [actionConfirmOpen, setActionConfirmOpen] = useState(false);
  const [pendingHighRiskDraft, setPendingHighRiskDraft] = useState(null);
  const [contextScopes, setContextScopes] = useState({
    sessions: true,
    templates: true,
    exerciseHistory: true,
    notes: true,
    settings: true,
    spaces: true,
  });
  const [messages, setMessages] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const chatHistoryRef = useRef([]);
  const messageIdRef = useRef(0);
  const listRef = useRef(null);
  const streamingIdRef = useRef(null);

  const accessState = useMemo(
    () => getCoachAccessState({ hasKey, keyStatus }),
    [hasKey, keyStatus]
  );
  const canSend = accessState.canChat && input.trim().length > 0 && !sending;
  const debugEnabled = import.meta.env.DEV || diagnosticsEnabled;
  const activeGymId = settings?.active_space_id ?? null;
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);
  const coachDiagnosticsEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // Debug panel gated by ?debug=1 to avoid accidental exposure in normal UX.
    return params.get("debug") === "1";
  }, []);

  useEffect(() => {
    if (!launchContext) return;
    setPendingLaunchContext(launchContext);
    setContextEnabled(true);
    setContextScopes((prev) => ({ ...prev, spaces: true }));
  }, [launchContext]);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (!contextEnabled && contextPreviewOpen) {
      setContextPreviewOpen(false);
    }
  }, [contextEnabled, contextPreviewOpen]);

  useEffect(() => {
    if (!contextEnabled) {
      setContextPreview(null);
      setContextMeta(null);
      setContextContract(null);
      setPayloadFingerprint(null);
    }
  }, [contextEnabled]);

  useEffect(() => {
    let cancelled = false;
    if (!coachDiagnosticsEnabled) {
      setDebugContextContract(null);
      setDebugContextFingerprint(null);
      setTemplateMappingPreview({});
      return () => {
        cancelled = true;
      };
    }
    const buildDiagnosticsContext = async () => {
      try {
        const { snapshot, contract } = await getCoachContextSnapshot({
          scopes: contextScopes,
          memorySummary: memoryEnabled ? memory : null,
          activeGymId,
        });
        if (cancelled) return;
        const fingerprint = await buildContextFingerprint(
          snapshot,
          contract?.contextBytes ?? null
        );
        if (cancelled) return;
        setDebugContextContract(contract ?? null);
        setDebugContextFingerprint(fingerprint);
      } catch {
        if (cancelled) return;
        setDebugContextContract(null);
        setDebugContextFingerprint(null);
      }
    };
    void buildDiagnosticsContext();
    return () => {
      cancelled = true;
    };
  }, [coachDiagnosticsEnabled, contextScopes, memory, memoryEnabled, activeGymId]);

  useEffect(() => {
    let cancelled = false;
    if (!coachDiagnosticsEnabled) {
      setTemplateMappingPreview({});
      return () => {
        cancelled = true;
      };
    }
    const buildPreview = async () => {
      const previews = {};
      const templateProposals = state.proposals.filter(
        (proposal) => proposal.name === "create_template"
      );
      for (const proposal of templateProposals) {
        const draftExercises = Array.isArray(proposal.input?.exercises)
          ? proposal.input.exercises
          : [];
        if (!draftExercises.length) continue;
        try {
          const preview = await resolveTemplateExercises(draftExercises, {
            createMissing: false,
          });
          previews[proposal.id] = preview;
        } catch {
          // Ignore preview failures in debug-only UI.
        }
      }
      if (!cancelled) {
        setTemplateMappingPreview(previews);
      }
    };
    void buildPreview();
    return () => {
      cancelled = true;
    };
  }, [coachDiagnosticsEnabled, state.proposals]);

  const hasGyms = sortedSpaces.length > 0;
  const selectedGym = useMemo(
    () => sortedSpaces.find((space) => space.id === activeGymId) ?? null,
    [sortedSpaces, activeGymId]
  );
  const gymNameLabel = selectedGym ? selectedGym.name ?? "Untitled Gym" : "No gym selected";
  const gymEquipmentCount = equipmentCount(selectedGym?.equipmentIds) ?? 0;
  const gymEquipmentLabel = `${gymEquipmentCount} equipment`;
  const exerciseCountLabel = `${formatCount(exerciseCount)} exercises`;
  const contextPillLabel = selectedGym
    ? `${gymNameLabel} · ${gymEquipmentLabel} · ${exerciseCountLabel}`
    : `No gym selected · ${exerciseCountLabel}`;
  const trustBadgeEnabled =
    Boolean(contextContract) && (contextEnabled || Boolean(pendingLaunchContext));
  const trustSummary = trustBadgeEnabled
    ? `${formatCount(contextContract.recentWorkoutsCount)} workouts, ${formatCount(
        contextContract.templatesCount
      )} templates`
    : "";
  const lastWorkoutLabel = trustBadgeEnabled
    ? formatDateLabel(contextContract.lastWorkoutDate)
    : "—";
  const debugContract =
    contextContract ?? debugContextContract ?? state.debug?.contextContract ?? null;
  const debugRequestContext = state.debug?.requestContext ?? null;
  const debugPayloadFingerprint =
    payloadFingerprint ??
    state.debug?.requestFingerprint ??
    state.debug?.payloadFingerprint ??
    debugContextFingerprint ??
    null;
  const actionContractVersion = state.debug?.actionContractVersion ?? null;
  const equipmentIdSummary = summarizeIdList(debugRequestContext?.equipmentIds);
  const equipmentIdLabel = equipmentIdSummary.items.length
    ? `${equipmentIdSummary.items.join(", ")}${
        equipmentIdSummary.omitted ? ` +${equipmentIdSummary.omitted} more` : ""
      }`
    : "—";
  const payloadFingerprintLabel = debugPayloadFingerprint
    ? `${debugPayloadFingerprint.hash}${
        debugPayloadFingerprint.algorithm
          ? ` (${debugPayloadFingerprint.algorithm})`
          : ""
      }`
    : "—";
  const payloadGymId = payloadSummary?.activeGymId ?? debugContract?.activeGymId ?? null;
  const payloadGymName =
    payloadSummary?.activeGymName ?? debugContract?.activeGymName ?? null;
  const payloadEquipmentCount =
    payloadSummary?.equipmentCount ?? debugContract?.equipmentCount ?? null;
  const payloadEquipmentIds = payloadSummary?.equipmentIds ?? [];
  const payloadEquipmentIdsLabel = formatIdList(payloadEquipmentIds);
  const payloadExerciseLibraryCount =
    payloadSummary?.exerciseLibraryCount ?? debugContract?.exerciseLibraryCount ?? null;
  const payloadCustomExercisesCount =
    payloadSummary?.customExercisesCount ?? debugContract?.customExercisesCount ?? null;
  const payloadTemplatesCount = payloadSummary?.summaryOnly
    ? null
    : payloadSummary?.templatesCount ?? debugContract?.templatesCount ?? null;
  const payloadRecentWorkoutsCount = payloadSummary?.summaryOnly
    ? null
    : payloadSummary?.recentWorkoutsCount ?? debugContract?.recentWorkoutsCount ?? null;
  const payloadContextBytes =
    payloadSummary?.contextBytes ?? debugContract?.contextBytes ?? null;
  const payloadBuildMs = payloadSummary?.buildMs ?? debugContract?.buildMs ?? null;
  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);
  const latestAssistantMessage = useMemo(() => {
    if (latestAssistantId == null) return null;
    return messages.find((message) => message.id === latestAssistantId) ?? null;
  }, [latestAssistantId, messages]);
  const actionDraft = actionState.draft;
  const actionPayload = actionDraft?.payload ?? null;
  const actionDraftTitle =
    actionPayload?.name ?? actionPayload?.title ?? actionDraft?.title ?? "";
  const actionDraftSummary = actionDraft?.summary ?? "";
  const actionDraftExercises = Array.isArray(actionPayload?.exercises)
    ? actionPayload.exercises
    : [];
  const actionDraftGymId = Number.isFinite(Number(actionPayload?.gymId))
    ? Number(actionPayload?.gymId)
    : null;
  const actionDraftGym =
    sortedSpaces.find((space) => space.id === actionDraftGymId) ?? null;
  const actionDraftKind = actionDraft?.kind ?? null;
  const actionDraftHasGyms =
    actionDraftKind === ActionDraftKinds.create_workout ||
    actionDraftKind === ActionDraftKinds.create_template;
  const actionEditTitle = String(actionEditDraft.title ?? "");
  const canSaveActionEdit = actionEditTitle.trim().length > 0;

  const buildContextPreview = useCallback(async () => {
    if (!contextEnabled || !contextPreviewOpen) return;
    setContextLoading(true);
    try {
      const { snapshot, meta, contract } = await getCoachContextSnapshot({
        scopes: contextScopes,
        memorySummary: memoryEnabled ? memory : null,
        activeGymId,
      });
      setContextPreview(snapshot);
      setContextMeta(meta);
      setContextContract(contract ?? null);
    } catch {
      setContextPreview({ error: "Unable to build preview right now." });
      setContextMeta(null);
      setContextContract(null);
    } finally {
      setContextLoading(false);
    }
  }, [contextEnabled, contextPreviewOpen, contextScopes, memory, memoryEnabled, activeGymId]);

  useEffect(() => {
    void buildContextPreview();
  }, [buildContextPreview]);

  const updateContextScope = (key) => {
    setContextScopes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const scopeLabels = {
    sessions: "Sessions",
    templates: "Templates",
    exerciseHistory: "Exercise history",
    notes: "Notes",
    settings: "Settings",
    spaces: "Workout spaces",
  };

  useEffect(() => {
    if (!actionDraft) {
      setActionEditMode(false);
      setActionEditDraft({ title: "", gymId: "" });
      setActionErrors([]);
      setActionWarnings([]);
      setPendingHighRiskDraft(null);
      return;
    }
    setActionEditMode(false);
    setActionEditDraft({
      title: actionDraftTitle,
      gymId: actionDraftGymId ?? "",
    });
    setActionErrors([]);
    setPendingHighRiskDraft(null);
  }, [actionDraft, actionDraftTitle, actionDraftGymId]);

  useEffect(() => {
    let active = true;
    const validateDraft = async () => {
      if (!actionDraft) {
        setActionWarnings([]);
        return;
      }
      const result = await validateActionDraft(actionDraft, {
        defaultGymId: activeGymId,
      });
      if (!active) return;
      setActionWarnings(result.warnings ?? []);
    };
    void validateDraft();
    return () => {
      active = false;
    };
  }, [actionDraft, activeGymId]);

  const sendCoachMessage = useCallback(
    async (messageText, options = {}) => {
      const trimmed = String(messageText ?? "").trim();
      if (!trimmed || sending) return;
      if (!accessState.canChat) {
        setError(accessState.message);
        return;
      }

      const { clearInput = false, autoTemplateRequest = false } = options;

      setError("");
      setSending(true);
      if (clearInput) setInput("");
      if (autoTemplateRequest) setPendingTemplateRequest(true);

      const userId = (messageIdRef.current += 1);
      setMessages((prev) => [
        ...prev,
        createMessage(userId, "user", trimmed, {
          ...(autoTemplateRequest ? { autoTemplateRequest: true } : {}),
        }),
      ]);

      const effectiveContextEnabled = contextEnabled || Boolean(pendingLaunchContext);
      let streamedId = null;
      try {
        const result = await runCoachTurn({
          apiKey,
          chatHistory: chatHistoryRef.current,
          userMessage: trimmed,
          contextConfig: {
            enabled: effectiveContextEnabled,
            scopes: contextScopes,
            launchContext: pendingLaunchContext,
            activeGymId,
          },
          memoryEnabled,
          memorySummary: memory,
          onStreamStart: () => {
            streamedId = (messageIdRef.current += 1);
            streamingIdRef.current = streamedId;
            setMessages((prev) => [
              ...prev,
              createMessage(streamedId, "assistant", ""),
            ]);
          },
          onStreamDelta: (delta) => {
            if (!streamedId) return;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === streamedId
                  ? { ...msg, content: `${msg.content}${delta}` }
                  : msg
              )
            );
          },
          onStreamEnd: () => {
            streamingIdRef.current = null;
          },
        });

        setChatHistory(result.conversation);
        dispatch({ type: "ADD_TOOL_EVENTS", payload: result.toolEvents });
        dispatch({ type: "QUEUE_PROPOSALS", payload: result.proposals });
        dispatch({ type: "SET_DEBUG", payload: result.debug });
        setContextContract(result.contextContract ?? null);
        setPayloadFingerprint(result.payloadFingerprint ?? null);
        setPayloadSummary(result.payloadSummary ?? null);

        if (result.payloadFingerprint || result.contextContract) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === userId
                ? {
                    ...msg,
                    meta: {
                      ...(msg.meta ?? {}),
                      payloadFingerprint: result.payloadFingerprint ?? null,
                      contextContract: result.contextContract ?? null,
                    },
                  }
                : msg
            )
          );
        }

        if (keyStatus !== "valid") {
          void setOpenAIKeyStatus("valid");
        }

        const assistantMeta = {
          actionDraft: result.actionDraft ?? null,
          actionContractVersion: result.actionContractVersion ?? null,
          contextContract: result.contextContract ?? null,
          payloadFingerprint: result.payloadFingerprint ?? null,
        };

        if (!streamedId) {
          const assistantId = (messageIdRef.current += 1);
          setMessages((prev) => [
            ...prev,
            createMessage(assistantId, "assistant", result.assistant, assistantMeta),
          ]);
          actionDispatch({
            type: "SET_FROM_MESSAGE",
            payload: {
              messageId: assistantId,
              actionDraft: result.actionDraft ?? null,
              contractVersion: result.actionContractVersion ?? null,
              contextContract: result.contextContract ?? null,
              payloadFingerprint: result.payloadFingerprint ?? null,
            },
          });
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === streamedId
                ? { ...msg, content: result.assistant, meta: assistantMeta }
                : msg
            )
          );
          actionDispatch({
            type: "SET_FROM_MESSAGE",
            payload: {
              messageId: streamedId,
              actionDraft: result.actionDraft ?? null,
              contractVersion: result.actionContractVersion ?? null,
              contextContract: result.contextContract ?? null,
              payloadFingerprint: result.payloadFingerprint ?? null,
            },
          });
        }
        if (pendingLaunchContext) {
          setPendingLaunchContext(null);
          onLaunchContextConsumed?.();
        }
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          void setOpenAIKeyStatus("invalid");
        }
        setError(resolveErrorMessage(err, accessState));
        if (streamedId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== streamedId));
        }
      } finally {
        setSending(false);
        if (autoTemplateRequest) setPendingTemplateRequest(false);
      }
    },
    [
      accessState,
      activeGymId,
      apiKey,
      contextEnabled,
      contextScopes,
      keyStatus,
      memory,
      memoryEnabled,
      onLaunchContextConsumed,
      pendingLaunchContext,
      sending,
    ]
  );

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendCoachMessage(input, { clearInput: true });
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) {
      void handleSend();
    }
  };

  const resolveDraftInfoForMessage = useCallback(
    (message) =>
      resolveTemplateDraftInfo({
        actionDraft: message?.meta?.actionDraft ?? null,
        text: message?.content ?? "",
        templateTool,
      }),
    [templateTool]
  );

  const resolveDraftForMessage = useCallback(
    (message) =>
      resolveDraftInfoForMessage(message).draft ?? null,
    [resolveDraftInfoForMessage]
  );

  const latestTemplateDraftInfo = useMemo(() => {
    if (!latestAssistantMessage) return null;
    return resolveDraftInfoForMessage(latestAssistantMessage);
  }, [latestAssistantMessage, resolveDraftInfoForMessage]);

  const templateDraftDebug = useMemo(
    () => ({
      draftFound: latestTemplateDraftInfo?.found ?? false,
      draftValid: latestTemplateDraftInfo?.valid ?? false,
      validationError: latestTemplateDraftInfo?.error ?? null,
      source: latestTemplateDraftInfo?.source ?? null,
      messageId: latestAssistantMessage?.id ?? null,
      messageCreatedAt: latestAssistantMessage?.createdAt ?? null,
    }),
    [latestAssistantMessage, latestTemplateDraftInfo]
  );

  const handleMakeTemplate = useCallback(
    async (message) => {
      if (!message || message.role !== "assistant") return;
      if (message.id !== latestAssistantId) return;
      const draft = resolveDraftForMessage(message);
      if (draft) {
        setTemplateConfirmDraft(draft);
        setTemplateConfirmOpen(true);
        return;
      }
      if (pendingTemplateRequest || templateCreating) return;
      await sendCoachMessage(TEMPLATE_REQUEST_PROMPT, { autoTemplateRequest: true });
    },
    [
      latestAssistantId,
      pendingTemplateRequest,
      resolveDraftForMessage,
      sendCoachMessage,
      templateCreating,
    ]
  );

  const handleConfirmTemplate = useCallback(async () => {
    if (!templateConfirmDraft || templateCreating) return;
    setTemplateCreating(true);
    try {
      await executeTool("create_template", templateConfirmDraft);
      onNotify?.(
        `Template created${templateConfirmDraft.name ? `: ${templateConfirmDraft.name}` : "."}`,
        { tone: "success" }
      );
      setTemplateConfirmOpen(false);
      setTemplateConfirmDraft(null);
    } catch (err) {
      onNotify?.(`Unable to create template: ${err?.message ?? "Unknown error"}`, {
        tone: "warning",
      });
    } finally {
      setTemplateCreating(false);
    }
  }, [onNotify, templateConfirmDraft, templateCreating]);

  const handleCloseTemplateConfirm = useCallback(() => {
    if (templateCreating) return;
    setTemplateConfirmOpen(false);
    setTemplateConfirmDraft(null);
  }, [templateCreating]);

  const handleDiscardActionDraft = useCallback(() => {
    actionDispatch({ type: "DISCARD" });
    setActionEditMode(false);
    setActionErrors([]);
  }, [actionDispatch]);

  const handleCancelActionEdit = useCallback(() => {
    setActionEditMode(false);
    setActionEditDraft({
      title: actionDraftTitle,
      gymId: actionDraftGymId ?? "",
    });
  }, [actionDraftGymId, actionDraftTitle]);

  const handleSaveActionEdit = useCallback(() => {
    if (!actionDraft) return;
    const nextTitle = String(actionEditDraft.title ?? "").trim();
    const nextGymId = actionDraftHasGyms
      ? Number.parseInt(String(actionEditDraft.gymId ?? ""), 10)
      : null;
    const payload = { ...(actionDraft.payload ?? {}) };
    if (nextTitle) {
      payload.name = nextTitle;
      payload.title = nextTitle;
    }
    if (actionDraftHasGyms) {
      payload.gymId =
        Number.isFinite(nextGymId) && nextGymId > 0 ? nextGymId : null;
    }
    const updated = {
      ...actionDraft,
      title: nextTitle || actionDraft.title,
      payload,
    };
    actionDispatch({ type: "UPDATE_DRAFT", payload: { draft: updated } });
    setActionEditMode(false);
  }, [actionDispatch, actionDraft, actionDraftHasGyms, actionEditDraft]);

  const handleApplyActionDraft = useCallback(
    async (options = {}) => {
      if (!actionDraft || actionApplying) return;
      const { skipConfirm = false } = options;
      setActionApplying(true);
      setActionErrors([]);
      try {
        const validation = await validateActionDraft(actionDraft, {
          defaultGymId: activeGymId,
        });
        setActionWarnings(validation.warnings ?? []);
        if (!validation.valid || !validation.normalizedDraft) {
          setActionErrors(
            validation.errors?.length ? validation.errors : ["Unable to apply draft."]
          );
          return;
        }
        if (validation.normalizedDraft.risk === "high" && !skipConfirm) {
          setPendingHighRiskDraft(validation.normalizedDraft);
          setActionConfirmOpen(true);
          return;
        }

        const result = await executeActionDraft(validation.normalizedDraft);
        const label =
          result.kind === ActionDraftKinds.create_workout
            ? "Created workout."
            : result.kind === ActionDraftKinds.create_template
              ? "Created template."
              : "Created gym.";
        const openAction =
          result.kind === ActionDraftKinds.create_workout
            ? () => onOpenWorkout?.(result.id)
            : result.kind === ActionDraftKinds.create_template
              ? () => onOpenTemplate?.(result.id)
              : () => onNavigateToGyms?.({ spaceId: result.id });
        const canOpen =
          (result.kind === ActionDraftKinds.create_workout && onOpenWorkout) ||
          (result.kind === ActionDraftKinds.create_template && onOpenTemplate) ||
          (result.kind === ActionDraftKinds.create_gym && onNavigateToGyms);

        onNotify?.(label, {
          tone: "success",
          ...(canOpen ? { actionLabel: "Open", onAction: openAction } : {}),
        });
        actionDispatch({ type: "DISCARD" });
      } catch (err) {
        setActionErrors([err?.message ?? "Unable to apply draft."]);
      } finally {
        setActionApplying(false);
      }
    },
    [
      actionApplying,
      actionDispatch,
      actionDraft,
      activeGymId,
      onNavigateToGyms,
      onNotify,
      onOpenTemplate,
      onOpenWorkout,
    ]
  );

  const handleConfirmActionDraft = useCallback(() => {
    if (!pendingHighRiskDraft) {
      setActionConfirmOpen(false);
      return;
    }
    setPendingHighRiskDraft(null);
    setActionConfirmOpen(false);
    void handleApplyActionDraft({ skipConfirm: true });
  }, [handleApplyActionDraft, pendingHighRiskDraft]);

  const handleCancelActionConfirm = useCallback(() => {
    setPendingHighRiskDraft(null);
    setActionConfirmOpen(false);
  }, []);

  const confirmProposal = async (proposal) => {
    dispatch({
      type: "UPDATE_PROPOSAL_STATUS",
      payload: { id: proposal.id, status: "confirming" },
    });
    const result = await executeWriteToolCall({
      proposal,
      context: { activeGymId },
      onResult: (res) => {
        dispatch({
          type: "UPDATE_PROPOSAL_STATUS",
          payload: { id: proposal.id, status: res.status, result: res },
        });
      },
    });

    const assistantId = (messageIdRef.current += 1);
    const assistantContent = `${summarizeProposalResult(
      result
    )} You can keep chatting when ready.`;
    setMessages((prev) => [...prev, createMessage(assistantId, "assistant", assistantContent)]);
    setChatHistory((prev) => [
      ...prev.map((msg) =>
        msg.role === "tool" && msg.tool_call_id === proposal.id
          ? { ...msg, content: JSON.stringify(result) }
          : msg
      ),
      { role: "assistant", content: assistantContent },
    ]);
    dispatch({
      type: "ADD_TOOL_EVENTS",
      payload: [
        {
          name: proposal.name,
          status: result.status,
          summary: proposal.summary,
        },
      ],
    });
  };

  const cancelProposal = (proposal) => {
    dispatch({
      type: "UPDATE_PROPOSAL_STATUS",
      payload: { id: proposal.id, status: "cancelled" },
    });
    const assistantId = (messageIdRef.current += 1);
    const assistantContent = "No problem. The action was cancelled.";
    setMessages((prev) => [...prev, createMessage(assistantId, "assistant", assistantContent)]);
    setChatHistory((prev) => [...prev, { role: "assistant", content: assistantContent }]);
    dispatch({
      type: "ADD_TOOL_EVENTS",
      payload: [
        {
          name: proposal.name,
          status: "cancelled",
          summary: proposal.summary,
        },
      ],
    });
  };

  const handleSelectGym = (spaceId) => {
    const nextId = spaceId ?? null;
    if (nextId === activeGymId) {
      setGymPickerOpen(false);
      return;
    }
    const previousId = activeGymId;
    void setActiveWorkoutSpace(nextId);
    setGymPickerOpen(false);
    if (!onNotify) return;
    const nextGym = sortedSpaces.find((space) => space.id === nextId);
    const nextLabel = nextGym?.name ?? "No gym selected";
    onNotify(`Gym changed to ${nextLabel}`, {
      tone: "info",
      duration: 5000,
      actionLabel: "Undo",
      onAction: () => setActiveWorkoutSpace(previousId ?? null),
    });
  };

  const coachDiagnosticsReport = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      coachRequestContext: {
        activeGymId: debugRequestContext?.activeGymId ?? null,
        gymName: debugRequestContext?.gymName ?? null,
        equipmentCount: debugRequestContext?.equipmentCount ?? null,
        equipmentIds: equipmentIdSummary.items,
        equipmentIdsOmitted: equipmentIdSummary.omitted,
        recentWorkoutsCount: debugRequestContext?.recentWorkoutsCount ?? null,
        lastWorkoutDate: debugRequestContext?.lastWorkoutDate ?? null,
        templatesCount: debugRequestContext?.templatesCount ?? null,
        customExercisesCount: debugRequestContext?.customExercisesCount ?? null,
        exerciseLibraryCount: debugRequestContext?.exerciseLibraryCount ?? null,
        contextBytes: debugRequestContext?.contextBytes ?? null,
        contextBuildMs: debugRequestContext?.contextBuildMs ?? null,
      },
      actionContractVersion: actionContractVersion ?? null,
      payloadFingerprint: debugPayloadFingerprint
        ? {
            algorithm: debugPayloadFingerprint.algorithm ?? null,
            hash: debugPayloadFingerprint.hash ?? null,
            contextBytes: debugPayloadFingerprint.contextBytes ?? null,
          }
        : null,
    }),
    [actionContractVersion, debugPayloadFingerprint, debugRequestContext, equipmentIdSummary]
  );

  const handleCopyCoachDiagnostics = useCallback(async () => {
    const payload = JSON.stringify(coachDiagnosticsReport, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      onNotify?.("Diagnostics copied to clipboard.", { tone: "success" });
    } catch {
      onNotify?.("Unable to copy diagnostics right now.", { tone: "warning" });
    }
  }, [coachDiagnosticsReport, onNotify]);

  const handleExportCoachDiagnostics = useCallback(() => {
    const payload = JSON.stringify(coachDiagnosticsReport, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `coach-diagnostics-${timestamp}.json`;
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotify?.("Diagnostics exported.", { tone: "success" });
  }, [coachDiagnosticsReport, onNotify]);

  const templateConfirmSummary = templateConfirmDraft?.name
    ? `Template: ${templateConfirmDraft.name}.`
    : "Template ready.";

  return (
    <div className="page">
      <PageHeader title="AI Coach" subtitle="Tool-enabled coaching with your data." />

      <div className="coach-gym-bar">
        <div className="coach-gym-bar__inner">
          <div className="coach-gym-pill">
            <span className="coach-gym-pill__label">Context</span>
            <span className="coach-gym-pill__text">{contextPillLabel}</span>
          </div>
          <div className="coach-gym-bar__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGymPickerOpen(true)}
              disabled={!hasGyms}
            >
              {activeGymId != null ? "Change gym" : "Select gym"}
            </Button>
            {!hasGyms ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onNavigateToGyms?.({ create: true })}
              >
                Create a gym
              </Button>
            ) : null}
          </div>
        </div>
        {!contextEnabled ? (
          <div className="coach-context-warning">
            Context is off. The coach cannot see your equipment.
          </div>
        ) : null}
      </div>

      <Card className="coach-card">
        <CardHeader>
          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-section-title">Coach chat</div>
              <div className="template-meta">
                {accessState.message}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setContextPanelOpen((prev) => !prev)}
            >
              {contextPanelOpen ? "Hide context" : "Context"}
            </Button>
          </div>
          {trustBadgeEnabled ? (
            <details className="coach-trust">
              <summary className="coach-trust__summary">
                <span className="coach-trust__label">Coach is using your data</span>
                <span className="coach-trust__counts">{trustSummary}</span>
              </summary>
              <div className="coach-trust__details">
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Gym</div>
                  <div className="coach-trust__item-value">
                    {contextContract.activeGymName ?? "None"}
                  </div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Equipment</div>
                  <div className="coach-trust__item-value">
                    {formatCount(contextContract.equipmentCount)}
                  </div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Recent workouts</div>
                  <div className="coach-trust__item-value">
                    {formatCount(contextContract.recentWorkoutsCount)}
                  </div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Last workout</div>
                  <div className="coach-trust__item-value">{lastWorkoutLabel}</div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Templates</div>
                  <div className="coach-trust__item-value">
                    {formatCount(contextContract.templatesCount)}
                  </div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Custom exercises</div>
                  <div className="coach-trust__item-value">
                    {formatCount(contextContract.customExercisesCount)}
                  </div>
                </div>
                <div className="coach-trust__item">
                  <div className="coach-trust__item-label">Library exercises</div>
                  <div className="coach-trust__item-value">
                    {formatCount(contextContract.exerciseLibraryCount)}
                  </div>
                </div>
              </div>
            </details>
          ) : null}
        </CardHeader>

        {contextPanelOpen ? (
          <CardBody className="coach-context">
            <div className="ui-row ui-row--between ui-row--wrap">
              <div>
                <div className="ui-strong">Share workout data</div>
                <div className="template-meta">Choose what the coach can access.</div>
              </div>
              <Button
                variant={contextEnabled ? "primary" : "secondary"}
                size="sm"
                onClick={() => setContextEnabled((prev) => !prev)}
              >
                {contextEnabled ? "On" : "Off"}
              </Button>
            </div>

            <div className="coach-context__grid">
              {Object.entries(contextScopes).map(([key, value]) => (
                <label key={key} className="coach-context__option">
                  <input
                    type="checkbox"
                    checked={value}
                    disabled={!contextEnabled}
                    onChange={() => updateContextScope(key)}
                  />
                  <span>{scopeLabels[key] ?? key}</span>
                </label>
              ))}
            </div>
            <div className="template-meta">
              Coach Memory is controlled in Settings and shared only when enabled there.
            </div>

            <div className="ui-row ui-row--between ui-row--wrap">
              <div>
                <div className="ui-strong">Preview shared data</div>
                <div className="template-meta">Read-only snapshot before sending.</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setContextPreviewOpen((prev) => !prev)}
                disabled={!contextEnabled}
              >
                {contextPreviewOpen ? "Hide preview" : "Preview"}
              </Button>
            </div>

            {contextPreviewOpen ? (
              <div className="coach-preview">
                {contextLoading ? (
                  <div className="template-meta">Building snapshot…</div>
                ) : (
                  <>
                    {contextMeta?.truncated ? (
                      <div className="coach-preview__warning">
                        Snapshot truncated to stay within size limits.
                        {contextMeta?.omitted?.length
                          ? ` Omitted: ${contextMeta.omitted.join(", ")}.`
                          : ""}
                      </div>
                    ) : null}
                    {contextPreview?.sessions?.length === 0 && contextScopes.sessions ? (
                      <div className="template-meta">No sessions yet.</div>
                    ) : null}
                    {contextPreview?.templates?.length === 0 && contextScopes.templates ? (
                      <div className="template-meta">No templates yet.</div>
                    ) : null}
                    <pre>{JSON.stringify(contextPreview ?? { notice: "No preview yet." }, null, 2)}</pre>
                  </>
                )}
              </div>
            ) : null}
          </CardBody>
        ) : null}

        <CardBody className="coach-body">
          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && !sending ? (
              <div className="chat-empty">Ask a question to get started.</div>
            ) : null}
            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isLatestAssistant = isAssistant && message.id === latestAssistantId;
              const templateDraft = isLatestAssistant
                ? latestTemplateDraftInfo?.draft ?? null
                : null;
              const waitingOnTemplate =
                isLatestAssistant && pendingTemplateRequest && !templateDraft;
              const makeTemplateDisabled =
                !isLatestAssistant || waitingOnTemplate || templateCreating || sending;
              const changeGymDisabled = !isLatestAssistant || !hasGyms;
              const showRequesting =
                isLatestAssistant && pendingTemplateRequest && !templateDraft;
              const showStaleHint = isAssistant && !isLatestAssistant;
              const trustContext = message?.meta?.contextContract ?? null;
              const trustFingerprint = message?.meta?.payloadFingerprint ?? null;
              const showTrustLine =
                Boolean(message?.meta?.actionDraft) && hasCoachContextCounts(trustContext);
              const trustGymLabel = trustContext?.activeGymName ?? "None";
              const trustWorkoutsLabel = formatCount(trustContext?.recentWorkoutsCount);
              const trustLastDate = formatDateLabel(trustContext?.lastWorkoutDate);
              const trustLibraryLabel = formatCount(trustContext?.exerciseLibraryCount);
              const trustFingerprintLabel = trustFingerprint?.hash ?? "—";

              return (
                <div key={message.id} className="chat-message" data-role={message.role}>
                  <div className="chat-message__stack">
                    <div className="chat-bubble">{message.content}</div>
                    {isAssistant ? (
                      <div
                        className="chat-actions"
                        data-stale={showStaleHint ? "true" : "false"}
                      >
                        {showTrustLine ? (
                          <div className="coach-trust-line">
                            <span className="coach-trust-line__label">
                              Using your data
                            </span>
                            <span>Gym: {trustGymLabel}</span>
                            <span>Library: {trustLibraryLabel}</span>
                            <span>
                              Workouts: {trustWorkoutsLabel} (last {trustLastDate})
                            </span>
                            <span>Fingerprint: {trustFingerprintLabel}</span>
                          </div>
                        ) : null}
                        {showRequesting ? (
                          <div className="chat-actions__status">
                            Requesting template JSON…
                          </div>
                        ) : showStaleHint ? (
                          <div className="chat-actions__status">
                            Actions apply to the latest reply.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {sending && !streamingIdRef.current ? (
              <div className="chat-message" data-role="assistant" data-loading="true">
                <div className="chat-bubble">Coach is thinking...</div>
              </div>
            ) : null}
          </div>
        </CardBody>

        <CardFooter className="coach-footer">
          {error ? (
            <div className="chat-error" role="status">
              {error}
            </div>
          ) : null}
          <div className="chat-input">
            <textarea
              className="ui-input ui-textarea chat-input__field"
              rows={3}
              placeholder="Ask your coach..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={handleKeyDown}
              disabled={!accessState.canChat}
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleSend}
              disabled={!canSend}
              loading={sending}
            >
              Send
            </Button>
          </div>
          <div className="template-meta">Chat history is not saved yet.</div>
        </CardFooter>
      </Card>

      {actionDraft ? (
        <Card className="coach-action-tray">
          <CardHeader>
            <div className="ui-row ui-row--between ui-row--wrap">
              <div>
                <div className="ui-section-title">Suggested Action</div>
                <div className="template-meta">
                  {actionDraftSummary || "Coach has a ready action draft."}
                </div>
              </div>
              <div className="coach-action-badges">
                <span className="pill pill--muted">
                  Confidence {formatConfidence(actionDraft.confidence)}
                </span>
                <span
                  className={`pill ${
                    actionDraft.risk === "high"
                      ? "pill--danger"
                      : actionDraft.risk === "medium"
                        ? "pill--muted"
                        : ""
                  }`}
                >
                  Risk {actionDraft.risk ?? "low"}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardBody className="coach-action-body ui-stack">
            <div className="coach-action-title">
              {actionDraftTitle || "Untitled action"}
            </div>
            {actionDraftSummary ? (
              <div className="template-meta">{actionDraftSummary}</div>
            ) : null}

            {actionEditMode ? (
              <div className="coach-action-edit ui-stack">
                <div>
                  <Label htmlFor="action-draft-title">Title</Label>
                  <Input
                    id="action-draft-title"
                    value={actionEditDraft.title}
                    onChange={(event) =>
                      setActionEditDraft((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Draft title"
                  />
                </div>
                {actionDraftHasGyms ? (
                  hasGyms ? (
                    <div>
                      <Label htmlFor="action-draft-gym">Gym</Label>
                      <Select
                        id="action-draft-gym"
                        value={String(actionEditDraft.gymId ?? "")}
                        onChange={(event) =>
                          setActionEditDraft((prev) => ({
                            ...prev,
                            gymId: event.target.value,
                          }))
                        }
                      >
                        <option value="">No gym</option>
                        {sortedSpaces.map((space) => (
                          <option key={space.id} value={space.id}>
                            {space.name ?? "Untitled Gym"}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <div className="template-meta">No gyms available yet.</div>
                  )
                ) : null}
              </div>
            ) : (
              <div className="coach-action-summary">
                {actionDraftHasGyms ? (
                  <div className="template-meta">
                    Gym: {actionDraftGym ? actionDraftGym.name ?? "Untitled Gym" : "None"}
                  </div>
                ) : null}
              </div>
            )}

            <details className="coach-action-details">
              <summary>Draft details</summary>
              <div className="coach-action-details__body">
                {actionDraftKind === ActionDraftKinds.create_workout ||
                actionDraftKind === ActionDraftKinds.create_template ? (
                  <div className="coach-action-exercises">
                    {actionDraftExercises.length ? (
                      actionDraftExercises.map((entry, index) => {
                        const exercise = exerciseMap.get(entry.exerciseId);
                        const name =
                          exercise?.name ?? `Exercise ${entry.exerciseId ?? index + 1}`;
                        const setCount = Array.isArray(entry.sets)
                          ? entry.sets.length
                          : null;
                        const repsValue = Array.isArray(entry.sets)
                          ? entry.sets
                              .map((set) => Number(set?.reps))
                              .find((value) => Number.isFinite(value))
                          : null;
                        const detailParts = [];
                        if (setCount) detailParts.push(`${setCount} sets`);
                        if (repsValue != null) detailParts.push(`${repsValue} reps`);
                        const meta =
                          detailParts.length > 0
                            ? detailParts.join(" · ")
                            : "Sets from draft";
                        return (
                          <div key={`${entry.exerciseId}-${index}`} className="coach-action-exercise">
                            <div className="coach-action-exercise__name">{name}</div>
                            <div className="coach-action-exercise__meta">{meta}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="template-meta">Exercises: (from draft)</div>
                    )}
                  </div>
                ) : null}

                {actionDraftKind === ActionDraftKinds.create_gym ? (
                  <div className="template-meta">
                    Equipment IDs:{" "}
                    {Array.isArray(actionPayload?.equipmentIds) &&
                    actionPayload.equipmentIds.length
                      ? actionPayload.equipmentIds.join(", ")
                      : "None specified"}
                  </div>
                ) : null}

                {actionPayload?.plannedDurationMins ? (
                  <div className="template-meta">
                    Planned duration: {actionPayload.plannedDurationMins} mins
                  </div>
                ) : null}
                {actionPayload?.frequencyHint ? (
                  <div className="template-meta">
                    Frequency: {actionPayload.frequencyHint}
                  </div>
                ) : null}
              </div>
            </details>

            {actionWarnings.length ? (
              <div className="coach-action-alert coach-action-alert--warning">
                {actionWarnings.map((warning, index) => (
                  <div key={`warning-${index}`}>{warning}</div>
                ))}
              </div>
            ) : null}
            {actionErrors.length ? (
              <div className="coach-action-alert coach-action-alert--error">
                {actionErrors.map((err, index) => (
                  <div key={`error-${index}`}>{err}</div>
                ))}
              </div>
            ) : null}
          </CardBody>
          <CardFooter className="coach-action-footer ui-row ui-row--wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleApplyActionDraft()}
              loading={actionApplying}
              disabled={actionApplying || actionEditMode}
            >
              Apply
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (actionEditMode) {
                  handleSaveActionEdit();
                  return;
                }
                setActionEditMode(true);
              }}
              disabled={actionApplying || (actionEditMode && !canSaveActionEdit)}
            >
              {actionEditMode ? "Save" : "Edit"}
            </Button>
            {actionEditMode ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelActionEdit}
                disabled={actionApplying}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDiscardActionDraft}
              disabled={actionApplying}
            >
              Discard
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {state.proposals.length ? (
        <Card>
          <CardHeader>
            <div className="ui-section-title">Pending actions</div>
          </CardHeader>
          <CardBody className="ui-stack">
            {state.proposals.map((proposal) => {
              const preview = templateMappingPreview[proposal.id];
              const previewLines =
                coachDiagnosticsEnabled && proposal.name === "create_template"
                  ? formatTemplateMappingPreview(preview?.mapping)
                  : [];
              return (
                <div key={proposal.id} className="proposal-card">
                  <div className="proposal-card__summary">{proposal.summary}</div>
                  <div className="proposal-card__meta">
                    Status: {proposal.status ?? "pending"}
                  </div>
                  {previewLines.length ? (
                    <div className="proposal-card__debug">
                      <div className="template-meta">Mapping preview</div>
                      {previewLines.map((line) => (
                        <div key={line} className="template-meta">
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {proposal.status === "pending" ? (
                    <div className="ui-row ui-row--wrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => cancelProposal(proposal)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => confirmProposal(proposal)}
                      >
                        Confirm
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      {state.toolEvents.length ? (
        <Card>
          <CardBody>
            <details className="coach-tools">
              <summary>Coach checked your data</summary>
              <div className="ui-stack">
                {state.toolEvents.map((event, index) => (
                  <div key={`${event.name}-${index}`} className="tool-event">
                    <div className="tool-event__name">{event.name}</div>
                    <div className="tool-event__meta">
                      {event.summary} · {event.status}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </CardBody>
        </Card>
      ) : null}

      {coachDiagnosticsEnabled ? (
        <Card className="dev-panel">
          <CardBody>
            <details className="coach-debug-panel">
              <summary className="coach-debug-panel__summary">Coach context debug</summary>
              <div className="coach-debug-panel__body ui-stack">
                <div className="coach-trust__details">
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Active gym ID</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.activeGymId)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Gym name</div>
                    <div className="coach-trust__item-value">
                      {debugRequestContext?.gymName ?? "—"}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Equipment count</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.equipmentCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Equipment IDs</div>
                    <div className="coach-trust__item-value">{equipmentIdLabel}</div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Recent workouts</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.recentWorkoutsCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Last workout</div>
                    <div className="coach-trust__item-value">
                      {formatDateLabel(debugRequestContext?.lastWorkoutDate)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Templates</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.templatesCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Custom exercises</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.customExercisesCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Library exercises</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.exerciseLibraryCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Context bytes</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.contextBytes)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Context build ms</div>
                    <div className="coach-trust__item-value">
                      {formatCount(debugRequestContext?.contextBuildMs)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Payload fingerprint</div>
                    <div className="coach-trust__item-value">{payloadFingerprintLabel}</div>
                  </div>
                </div>
                <div className="ui-strong">Payload summary</div>
                <div className="coach-trust__details">
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Active gym ID</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadGymId)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Gym name</div>
                    <div className="coach-trust__item-value">{payloadGymName ?? "—"}</div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Equipment count</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadEquipmentCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Equipment IDs</div>
                    <div className="coach-trust__item-value">
                      {payloadEquipmentIdsLabel}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Library exercises</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadExerciseLibraryCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Custom exercises</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadCustomExercisesCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Templates</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadTemplatesCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Recent workouts</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadRecentWorkoutsCount)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Context bytes</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadContextBytes)}
                    </div>
                  </div>
                  <div className="coach-trust__item">
                    <div className="coach-trust__item-label">Context build ms</div>
                    <div className="coach-trust__item-value">
                      {formatCount(payloadBuildMs)}
                    </div>
                  </div>
                </div>
                <div className="ui-row ui-row--wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyCoachDiagnostics}
                  >
                    Copy diagnostics report
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportCoachDiagnostics}
                  >
                    Export diagnostics report
                  </Button>
                </div>
              </div>
            </details>
          </CardBody>
        </Card>
      ) : null}

      {debugEnabled ? (
        <Card className="dev-panel">
          <CardHeader>
            <div className="ui-section-title">Coach debug</div>
          </CardHeader>
          <CardBody className="ui-stack">
            <div>
              <span className="ui-muted">Model:</span> {state.debug?.model ?? "—"}
            </div>
            <div>
              <span className="ui-muted">Context truncated:</span>{" "}
              {state.debug?.contextMeta?.truncated ? "yes" : "no"}
            </div>
            <div>
              <span className="ui-muted">Estimated tokens:</span>{" "}
              {state.debug?.estimatedTokens ?? "—"}
            </div>
            <div>
              <span className="ui-muted">Tools:</span>{" "}
              {(state.debug?.toolCalls?.length ?? 0) || "—"}
            </div>
            <div>
              <span className="ui-muted">Pending proposals:</span>{" "}
              {state.proposals.filter((p) => p.status === "pending").length}
            </div>
            <div>
              <span className="ui-muted">Tool events:</span>{" "}
              {state.toolEvents.length
                ? state.toolEvents.map((event) => event.name).join(", ")
                : "—"}
            </div>
            <div>
              <span className="ui-muted">Allowed tools:</span>{" "}
              {state.debug?.allowedTools?.length ? state.debug.allowedTools.join(", ") : "—"}
            </div>
            <div>
              <span className="ui-muted">Payload fingerprint:</span>{" "}
              {debugPayloadFingerprint
                ? `${debugPayloadFingerprint.hash} (${formatCount(
                    debugPayloadFingerprint.contextBytes
                  )} bytes)`
                : "—"}
            </div>
            <div className="coach-debug__block">
              <div className="ui-muted">Template draft</div>
              <pre className="coach-debug__payload">
                {JSON.stringify(templateDraftDebug, null, 2)}
              </pre>
            </div>
            <div className="coach-debug__block">
              <div className="ui-muted">Context contract</div>
              <pre className="coach-debug__payload">
                {JSON.stringify(debugContract ?? { notice: "No contract yet." }, null, 2)}
              </pre>
            </div>
            <div className="coach-debug__block">
              <div className="ui-muted">Fingerprint details</div>
              <pre className="coach-debug__payload">
                {JSON.stringify(
                  debugPayloadFingerprint ?? { notice: "No fingerprint yet." },
                  null,
                  2
                )}
              </pre>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {templateConfirmOpen ? (
        <div className="coach-modal" role="dialog" aria-modal="true">
          <div
            className="coach-modal__backdrop"
            onClick={handleCloseTemplateConfirm}
          />
          <div className="coach-modal__content" role="document">
            <div className="ui-section-title">Create template?</div>
            <div className="template-meta">
              {templateConfirmSummary} This will save a template from the coach plan.
            </div>
            <div className="ui-row ui-row--wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCloseTemplateConfirm}
                disabled={templateCreating}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmTemplate}
                loading={templateCreating}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {actionConfirmOpen ? (
        <div className="coach-modal" role="dialog" aria-modal="true">
          <div
            className="coach-modal__backdrop"
            onClick={handleCancelActionConfirm}
          />
          <div className="coach-modal__content" role="document">
            <div className="ui-section-title">High-risk action</div>
            <div className="template-meta">
              This will overwrite existing data. Continue?
            </div>
            <div className="ui-row ui-row--wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCancelActionConfirm}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmActionDraft}
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <BottomSheet
        open={gymPickerOpen}
        onClose={() => setGymPickerOpen(false)}
        title="Select gym"
        ariaLabel="Select a gym"
      >
        {sortedSpaces.length ? (
          <>
            <div className="coach-gym-list">
              {sortedSpaces.map((space) => {
                const selected = space.id === activeGymId;
                return (
                  <button
                    key={space.id}
                    type="button"
                    className={`coach-gym-option${selected ? " is-selected" : ""}`}
                    onClick={() => handleSelectGym(space.id)}
                  >
                    <div>
                      <div className="ui-strong">{space.name ?? "Untitled Gym"}</div>
                      <div className="template-meta">{formatEquipmentCount(space)}</div>
                    </div>
                    {selected ? <span className="pill">Selected</span> : null}
                  </button>
                );
              })}
            </div>
            {onNavigateToGyms ? (
              <div className="ui-row ui-row--wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setGymPickerOpen(false);
                    onNavigateToGyms({ create: true });
                  }}
                >
                  Create gym
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="ui-stack">
            <div className="template-meta">No gyms saved yet.</div>
            {onNavigateToGyms ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setGymPickerOpen(false);
                  onNavigateToGyms({ create: true });
                }}
              >
                Create gym
              </Button>
            ) : null}
          </div>
        )}
        <div className="coach-gym-footer">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigateToGyms?.({ create: true })}
          >
            Create gym
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
