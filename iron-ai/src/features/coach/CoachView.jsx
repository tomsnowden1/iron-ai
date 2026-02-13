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
import {
  createWorkoutFromDraft,
  executeActionDraft,
  validateActionDraft,
} from "../../coach/actionDraftExecution";
import { executeWriteToolCall, runCoachTurn } from "../../coach/orchestrator";
import { buildContextFingerprint } from "../../coach/fingerprint";
import { resolveTemplateExercises } from "../../coach/templateExerciseMapping";
import { executeTool, getToolRegistry } from "../../coach/tools";
import { extractWorkoutPlanOutput } from "../../coach/responseValidation";
import { getCoachAccessState } from "./coachAccess";
import { getCoachKeyMode } from "../../config/coachKeyMode";
import {
  applyUniformSetCountToExercises,
  buildCoachDebugTracePanel,
  buildCoachDebugTraceStamp,
  buildSwapConfirmationMessage,
  buildCoachWorkoutSummaryFromDraft,
  buildHeuristicWorkoutDraft,
  getVisibleCoachActionExerciseCount,
  getCoachWorkoutActionConfig,
  hasWorkoutCardPayload,
  hasWorkoutIntent,
  isStartWorkoutIntentText as _isStartWorkoutIntentText,
  isTemplateIntentText,
  isInternalPromptMessage,
  getSuggestedActionPrimaryLabel,
  shouldShowSuggestedActionSaveTemplate,
  resolveCoachErrorMessage,
  sanitizeCoachAssistantText,
  resolveCoachDisplayText,
  shouldShowCoachActionShowAllToggle,
  shouldForceWorkoutResponseMode,
} from "./coachViewUiModel";
import {
  buildTemplateDraftFromWorkoutPlan,
  resolveTemplateDraftInfo,
} from "./templateDraft";
import {
  clearPersistedSuggestedAction,
  readPersistedSuggestedAction,
  writePersistedSuggestedAction,
} from "./suggestedActionStorage";
import {
  getCoachChatState,
  setCoachChatState,
  setOpenAIKeyStatus,
  useCoachMemoryEnabled,
  useSettings,
} from "../../state/settingsStore";
import {
  db,
  getAllExercises,
  listWorkoutSpaces,
  setActiveWorkoutSpace,
} from "../../db";
import { sortSpacesByName } from "../../workoutSpaces/logic";

import BottomSheet from "../../components/ui/BottomSheet";

const COACH_DEBUG_COMMIT_SHA =
  import.meta.env.VITE_COMMIT_SHA ?? import.meta.env.VITE_GIT_SHA ?? "unknown";

function createMessage(id, role, content, meta) {
  return {
    id,
    role,
    content,
    meta: meta ?? null,
    createdAt: Date.now(),
  };
}

function getHighestMessageId(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  return messages.reduce((highest, message) => {
    const value = Number(message?.id);
    if (!Number.isFinite(value)) return highest;
    return Math.max(highest, value);
  }, 0);
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

function toRenderableText(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => toRenderableText(entry, ""))
      .filter(Boolean)
      .join(" ");
    return joined || fallback;
  }
  if (value instanceof Error) {
    return value.message ? String(value.message) : fallback;
  }
  if (typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
    if (typeof value.text === "string" && value.text.trim()) {
      return value.text.trim();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
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

const ADJUSTMENT_CHIPS = [
  "Make it 8 exercises",
  "More quads",
  "Knee-friendly",
  "No barbells",
  "Shorter 30 min",
  "Add warmup sets",
];

function normalizeExerciseName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parsePositiveInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveDraftSetCount(exercises) {
  if (!Array.isArray(exercises) || exercises.length === 0) return 3;
  const first = exercises[0];
  if (Array.isArray(first?.sets) && first.sets.length) return first.sets.length;
  return 3;
}

function resolveFallbackDraftTitle(text) {
  const normalized = String(text ?? "").toLowerCase();
  if (normalized.includes("push")) return "Push Workout";
  if (normalized.includes("pull")) return "Pull Workout";
  if (
    normalized.includes("leg") ||
    normalized.includes("quad") ||
    normalized.includes("hamstring") ||
    normalized.includes("glute") ||
    normalized.includes("calf")
  ) {
    return "Leg Workout";
  }
  return "Coach Workout";
}

function buildLibraryFallbackDraftPayload({ userMessage, exercises, activeGymId }) {
  const list = Array.isArray(exercises) ? exercises : [];
  if (!list.length) return null;
  const selected = list
    .slice(0, 6)
    .map((exercise) => {
      const exerciseId = parsePositiveInt(exercise?.id);
      if (!exerciseId) return null;
      const setCount = parsePositiveInt(exercise?.default_sets, 3) ?? 3;
      const reps = parsePositiveInt(exercise?.default_reps, 10) ?? 10;
      return {
        exerciseId,
        name: String(exercise?.name ?? "").trim() || undefined,
        sets: Array.from({ length: setCount }, () => ({ reps })),
      };
    })
    .filter(Boolean);
  if (!selected.length) return null;
  const title = resolveFallbackDraftTitle(userMessage);
  return {
    name: title,
    title,
    ...(activeGymId != null ? { gymId: activeGymId } : {}),
    exercises: selected,
  };
}

function buildActionDraftFromPayload({
  draftPayload,
  actionKind,
  fallbackTitle,
  fallbackSummary,
  fallbackGymId,
}) {
  if (!draftPayload || typeof draftPayload !== "object") return null;
  const exercises = Array.isArray(draftPayload.exercises) ? draftPayload.exercises : [];
  if (!exercises.length) return null;
  const normalizedExercises = exercises
    .map((entry) => {
      const exerciseId = parsePositiveInt(entry?.exerciseId);
      if (!exerciseId) return null;
      const setCount = parsePositiveInt(entry?.sets, 3) ?? 3;
      const reps = parsePositiveInt(entry?.reps);
      const sets = Array.isArray(entry?.sets)
        ? entry.sets
            .filter((set) => set && typeof set === "object")
            .map((set) => ({ ...set }))
        : Array.from({ length: setCount }, () =>
            reps != null ? { reps } : {}
          );
      const normalized = {
        exerciseId,
      };
      if (entry?.name) normalized.name = entry.name;
      if (sets.length) normalized.sets = sets;
      return normalized;
    })
    .filter(Boolean);
  if (!normalizedExercises.length) return null;
  const rawTitle = String(
    draftPayload.name ?? draftPayload.title ?? fallbackTitle ?? "Coach Draft"
  ).trim();
  const title = rawTitle || "Coach Draft";
  const gymId = parsePositiveInt(draftPayload.gymId ?? draftPayload.spaceId ?? fallbackGymId);
  return {
    kind: actionKind,
    confidence: 0.8,
    risk: "low",
    title,
    summary: fallbackSummary ?? "Coach prepared a draft.",
    payload: {
      ...draftPayload,
      name: title,
      title,
      ...(gymId != null ? { gymId } : {}),
      exercises: normalizedExercises,
    },
  };
}

export default function CoachView({
  launchContext,
  onLaunchContextConsumed,
  onNotify,
  onOpenTemplate,
  onOpenWorkout,
  onNavigateToGyms,
  activeWorkoutId,
}) {
  const coachKeyMode = getCoachKeyMode();
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
  const exerciseNameById = useMemo(
    () =>
      new Map(
        (allExercises ?? []).map((exercise) => [
          exercise.id,
          exercise?.name ?? `Exercise ${exercise.id}`,
        ])
      ),
    [allExercises]
  );
  const exerciseNameLookup = useMemo(
    () =>
      new Map(
        (allExercises ?? [])
          .map((exercise) => [normalizeExerciseName(exercise?.name), exercise?.id])
          .filter(([name, id]) => name && id != null)
      ),
    [allExercises]
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
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
  const [adjustMessageId, setAdjustMessageId] = useState(null);
  const [startingWorkoutMessageId, setStartingWorkoutMessageId] = useState(null);
  const [templateCreatingMessageId, setTemplateCreatingMessageId] = useState(null);
  const [createdTemplateByMessageId, setCreatedTemplateByMessageId] = useState({});
  const [startedWorkoutByMessageId, setStartedWorkoutByMessageId] = useState({});
  const [actionEditMode, setActionEditMode] = useState(false);
  const [actionEditDraft, setActionEditDraft] = useState({
    title: "",
    gymId: "",
    sets: 3,
  });
  const [actionErrors, setActionErrors] = useState([]);
  const [actionWarnings, setActionWarnings] = useState([]);
  const [actionApplying, setActionApplying] = useState(false);
  const [actionConfirmOpen, setActionConfirmOpen] = useState(false);
  const [pendingHighRiskDraft, setPendingHighRiskDraft] = useState(null);
  const [actionExercisesExpanded, setActionExercisesExpanded] = useState(false);
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
  const [chatStateLoaded, setChatStateLoaded] = useState(false);
  const chatHistoryRef = useRef([]);
  const chatPersistTimerRef = useRef(null);
  const messageIdRef = useRef(0);
  const listRef = useRef(null);
  const streamingIdRef = useRef(null);
  const inputRef = useRef(null);
  const actionTrayRef = useRef(null);
  const lastActionScrollMessageIdRef = useRef(null);

  const accessState = useMemo(
    () => getCoachAccessState({ hasKey, keyStatus, keyMode: coachKeyMode }),
    [coachKeyMode, hasKey, keyStatus]
  );
  const canSend = accessState.canChat && input.trim().length > 0 && !sending;
  const activeGymId = settings?.active_space_id ?? null;
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);
  const coachDiagnosticsEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // Debug panel gated by ?debug=1 to avoid accidental exposure in normal UX.
    return params.get("debug") === "1";
  }, []);
  const debugEnabled = coachDiagnosticsEnabled;

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
    let active = true;
    const loadChatState = async () => {
      try {
        const saved = await getCoachChatState();
        if (!active) return;
        if (saved.messages.length) {
          setMessages(saved.messages);
          messageIdRef.current = Math.max(
            messageIdRef.current,
            getHighestMessageId(saved.messages)
          );
        }
        if (saved.chatHistory.length) {
          setChatHistory(saved.chatHistory);
        }
      } finally {
        if (active) {
          setChatStateLoaded(true);
        }
      }
    };
    void loadChatState();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const persisted = readPersistedSuggestedAction();
    if (!persisted?.draft) return;
    actionDispatch({
      type: "SET_FROM_MESSAGE",
      payload: {
        messageId: persisted.sourceMessageId ?? null,
        actionDraft: persisted.draft,
      },
    });
  }, []);

  useEffect(() => {
    if (!chatStateLoaded) return;
    if (chatPersistTimerRef.current) {
      clearTimeout(chatPersistTimerRef.current);
      chatPersistTimerRef.current = null;
    }
    chatPersistTimerRef.current = setTimeout(() => {
      void setCoachChatState({ messages, chatHistory });
    }, 150);
    return () => {
      if (chatPersistTimerRef.current) {
        clearTimeout(chatPersistTimerRef.current);
        chatPersistTimerRef.current = null;
      }
    };
  }, [chatHistory, chatStateLoaded, messages]);

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
  const effectiveContextEnabled = contextEnabled || Boolean(pendingLaunchContext);
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
  const selectedGymEquipmentSummary = useMemo(() => {
    if (!selectedGym) return [];
    const equipmentIds = Array.isArray(selectedGym.equipmentIds)
      ? selectedGym.equipmentIds.filter((id) => id && id !== "bodyweight")
      : [];
    if (!equipmentIds.length) return "No equipment listed for selected gym.";
    return equipmentIds.join(", ");
  }, [selectedGym]);
  const promptContextState = useMemo(
    () => ({
      contextEnabled: effectiveContextEnabled,
      selectedGym: selectedGym
        ? { id: selectedGym.id ?? null, name: selectedGym.name ?? null }
        : null,
      equipmentSummary: effectiveContextEnabled ? selectedGymEquipmentSummary : [],
    }),
    [effectiveContextEnabled, selectedGym, selectedGymEquipmentSummary]
  );
  const trustBadgeEnabled =
    Boolean(contextContract) && effectiveContextEnabled;
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
  const workoutActionConfig = useMemo(
    () => getCoachWorkoutActionConfig({ debugEnabled }),
    [debugEnabled]
  );
  const visibleMessages = useMemo(() => {
    const next = [];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (isInternalPromptMessage(message)) continue;
      const previous = i > 0 ? messages[i - 1] : null;
      const followsInternalPrompt =
        message?.role === "assistant" && isInternalPromptMessage(previous);
      if (
        followsInternalPrompt &&
        !sanitizeCoachAssistantText(message?.content ?? "").trim()
      ) {
        continue;
      }
      next.push(message);
    }
    return next;
  }, [messages]);
  const latestAssistantId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === "assistant") return visibleMessages[i].id;
    }
    return null;
  }, [visibleMessages]);
  const latestAssistantMessage = useMemo(() => {
    if (latestAssistantId == null) return null;
    return visibleMessages.find((message) => message.id === latestAssistantId) ?? null;
  }, [latestAssistantId, visibleMessages]);
  const latestUserMessage = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === "user") return visibleMessages[i];
    }
    return null;
  }, [visibleMessages]);
  const latestUserContent = latestUserMessage?.content ?? "";
  const actionStatus = actionState.status ?? (actionState.draft ? "ready" : "idle");
  const actionStateError = String(actionState.error ?? "").trim();
  const actionDraft = actionState.draft;
  const actionSourceMessageId = actionState.sourceMessageId ?? null;
  const actionPayload = actionDraft?.payload ?? null;
  const actionIsBuilding = actionStatus === "building";
  const actionHasError = actionStatus === "error" && !actionIsBuilding;
  const actionTrayVisible = actionIsBuilding || actionHasError || Boolean(actionDraft);
  const actionDraftTitle =
    actionPayload?.name ?? actionPayload?.title ?? actionDraft?.title ?? "";
  const actionDraftSummary = toRenderableText(actionDraft?.summary ?? "", "");
  const actionDraftExercises = Array.isArray(actionPayload?.exercises)
    ? actionPayload.exercises
    : [];
  const actionDraftGymId = Number.isFinite(Number(actionPayload?.gymId))
    ? Number(actionPayload?.gymId)
    : null;
  const actionDraftGym =
    sortedSpaces.find((space) => space.id === actionDraftGymId) ?? null;
  const actionDraftKind = actionDraft?.kind ?? null;
  const actionPrimaryLabel = getSuggestedActionPrimaryLabel(actionDraftKind);
  const [actionDetailsOpen, setActionDetailsOpen] = useState(true);
  const actionDraftHasGyms =
    actionDraftKind === ActionDraftKinds.create_workout ||
    actionDraftKind === ActionDraftKinds.create_template;
  const actionDraftExerciseRows = useMemo(
    () =>
      actionDraftExercises.map((entry, index) => {
        const exercise = exerciseMap.get(entry.exerciseId);
        const name = exercise?.name ?? `Exercise ${entry.exerciseId ?? index + 1}`;
        const setCount = Array.isArray(entry.sets) ? entry.sets.length : null;
        const repsValue = Array.isArray(entry.sets)
          ? entry.sets
              .map((set) => Number(set?.reps))
              .find((value) => Number.isFinite(value))
          : null;
        const detailParts = [];
        if (setCount) detailParts.push(`${setCount} sets`);
        if (repsValue != null) detailParts.push(`${repsValue} reps`);
        const meta = detailParts.length ? detailParts.join(" · ") : "Sets from draft";
        return {
          key: `${entry.exerciseId}-${index}`,
          name,
          meta,
        };
      }),
    [actionDraftExercises, exerciseMap]
  );
  const visibleActionExerciseCount = getVisibleCoachActionExerciseCount(
    actionDraftExerciseRows.length,
    actionExercisesExpanded
  );
  const visibleActionExerciseRows = actionDraftExerciseRows.slice(
    0,
    visibleActionExerciseCount
  );
  const showActionExerciseToggle = shouldShowCoachActionShowAllToggle(
    actionDraftExerciseRows.length
  );
  const hasDraftDetails = Boolean(
    actionDraftKind === ActionDraftKinds.create_gym ||
      actionPayload?.plannedDurationMins ||
      actionPayload?.frequencyHint
  );
  const canSaveActionAsTemplate = shouldShowSuggestedActionSaveTemplate(actionDraftKind);
  const actionEditTitle = String(actionEditDraft.title ?? "");
  const canSaveActionEdit = actionEditTitle.trim().length > 0;
  const coachDebugTrace = useMemo(
    () =>
      buildCoachDebugTracePanel({
        ...(state.debug?.stamp ?? {}),
        commitSha: state.debug?.stamp?.commitSha ?? COACH_DEBUG_COMMIT_SHA,
      }),
    [state.debug?.stamp]
  );

  useEffect(() => {
    if (!actionDraft) {
      clearPersistedSuggestedAction();
      return;
    }
    writePersistedSuggestedAction({
      sourceMessageId: actionSourceMessageId,
      draft: actionDraft,
    });
  }, [actionDraft, actionSourceMessageId]);

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

  const buildWorkoutDraftForMessage = useCallback(
    ({ actionDraft, text }) => {
      const templateInfo = resolveTemplateDraftInfo({
        actionDraft: actionDraft ?? null,
        text: text ?? "",
        templateTool,
      });
      if (templateInfo.draft) {
        return {
          payload: templateInfo.draft,
          status: "ready",
          source: templateInfo.source ?? null,
          error: null,
          rawJson: templateInfo.rawJson ?? null,
        };
      }
      const workoutPlan = extractWorkoutPlanOutput(text ?? "");
      if (workoutPlan.valid && workoutPlan.parsed) {
        const draft = buildTemplateDraftFromWorkoutPlan(workoutPlan.parsed, {
          fallbackName: workoutPlan.parsed?.name ?? "Coach Workout Draft",
          spaceId: activeGymId,
        });
        if (draft) {
          return {
            payload: draft,
            status: "ready",
            source: workoutPlan.source ?? null,
            error: null,
            rawJson: workoutPlan.rawJson ?? null,
          };
        }
      }
      return {
        payload: null,
        status: templateInfo.found || workoutPlan.rawJson ? "error" : "ready",
        source: templateInfo.source ?? workoutPlan.source ?? null,
        error: templateInfo.error ?? workoutPlan.error ?? null,
        rawJson: templateInfo.rawJson ?? workoutPlan.rawJson ?? null,
      };
    },
    [activeGymId, templateTool]
  );

  useEffect(() => {
    if (!actionDraft) {
      setActionEditMode(false);
      setActionExercisesExpanded(false);
      setActionEditDraft({ title: "", gymId: "", sets: 3 });
      setActionErrors([]);
      setActionWarnings([]);
      setPendingHighRiskDraft(null);
      setActionDetailsOpen(true);
      lastActionScrollMessageIdRef.current = null;
      return;
    }
    setActionEditMode(false);
    setActionEditDraft({
      title: actionDraftTitle,
      gymId: actionDraftGymId ?? "",
      sets: resolveDraftSetCount(actionDraft?.payload?.exercises),
    });
    setActionExercisesExpanded(false);
    setActionErrors([]);
    setPendingHighRiskDraft(null);
  }, [actionDraft, actionDraftGymId, actionDraftTitle]);

  useEffect(() => {
    if (!actionDraft || actionSourceMessageId == null) return;
    const messageKey = String(actionSourceMessageId);
    if (lastActionScrollMessageIdRef.current === messageKey) return;
    lastActionScrollMessageIdRef.current = messageKey;
    setActionDetailsOpen(true);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      actionTrayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [actionDraft, actionSourceMessageId]);

  useEffect(() => {
    if (!actionIsBuilding) return;
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      actionTrayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [actionIsBuilding]);

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

      const {
        clearInput = false,
        responseMode = "general",
        forceContextEnabled = null,
        skipUserMessage = false,
      } = options;

      setError("");
      setRetryMessage("");
      setSending(true);
      if (clearInput) setInput("");

      const userId = skipUserMessage ? null : (messageIdRef.current += 1);
      if (userId != null) {
        setMessages((prev) => [
          ...prev,
          createMessage(userId, "user", trimmed, {
            displayText: trimmed,
            status: "ready",
          }),
        ]);
      }

      let streamedId = null;
      let expectsDraftForRequest = false;
      try {
        const hasEditableWorkoutDraft =
          actionDraft?.kind === ActionDraftKinds.create_workout &&
          Array.isArray(actionDraft?.payload?.exercises) &&
          actionDraft.payload.exercises.length > 0;
        const shouldEditExistingDraft = shouldForceWorkoutResponseMode({
          userMessage: trimmed,
          hasVisibleWorkoutDraft: hasEditableWorkoutDraft,
        });
        const resolvedResponseMode =
          responseMode === "general" && shouldEditExistingDraft
            ? "workout"
            : responseMode;
        const expectsTemplateDraft = isTemplateIntentText(trimmed);
        const expectsWorkoutDraft =
          shouldEditExistingDraft ||
          resolvedResponseMode === "workout" ||
          hasWorkoutIntent(trimmed);
        const expectsDraft = expectsTemplateDraft || expectsWorkoutDraft;
        expectsDraftForRequest = expectsDraft;
        const fallbackActionKind = expectsTemplateDraft
          ? ActionDraftKinds.create_template
          : ActionDraftKinds.create_workout;
        if (expectsDraft) {
          actionDispatch({ type: "BUILD_START", payload: { clearDraft: true } });
          setActionErrors([]);
        }
        const resolvedContextEnabled =
          forceContextEnabled == null
            ? effectiveContextEnabled
            : Boolean(forceContextEnabled);
        const resolvedContextState =
          forceContextEnabled == null
            ? promptContextState
            : {
                ...promptContextState,
                contextEnabled: Boolean(forceContextEnabled),
                equipmentSummary: forceContextEnabled
                  ? selectedGymEquipmentSummary
                  : [],
              };
        const result = await runCoachTurn({
          apiKey,
          keyMode: coachKeyMode,
          chatHistory: chatHistoryRef.current,
          userMessage: trimmed,
          responseMode: resolvedResponseMode,
          draftEditConfig: shouldEditExistingDraft
            ? {
                mode: "edit",
                currentDraft: actionDraft,
              }
            : null,
          contextConfig: {
            enabled: resolvedContextEnabled,
            scopes: contextScopes,
            launchContext: pendingLaunchContext,
            activeGymId,
            contextState: resolvedContextState,
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
        if (import.meta.env.DEV && result.debug?.stamp) {
          console.info("coach_debug_stamp", result.debug.stamp);
        }
        setContextContract(result.contextContract ?? null);
        setPayloadFingerprint(result.payloadFingerprint ?? null);
        setPayloadSummary(result.payloadSummary ?? null);
        if (result.responseValidation?.status === "failed") {
          setError(
            "Coach had trouble formatting that response. Please tap Retry to regenerate."
          );
          setRetryMessage(trimmed);
        } else {
          setRetryMessage("");
        }

        if (userId != null && (result.payloadFingerprint || result.contextContract)) {
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

        if (coachKeyMode === "user" && keyStatus !== "valid") {
          void setOpenAIKeyStatus("valid");
        }

        const assistantMeta = {
          actionDraft: null,
          actionContractVersion: result.actionContractVersion ?? null,
          contextContract: result.contextContract ?? null,
          payloadFingerprint: result.payloadFingerprint ?? null,
          contextSnapshot: {
            gymName:
              result.contextContract?.activeGymName ??
              selectedGym?.name ??
              null,
            equipmentCount:
              result.contextContract?.equipmentCount ??
              gymEquipmentCount ??
              null,
          },
          requestUserMessage: trimmed,
        };
        const draftState = buildWorkoutDraftForMessage({
          actionDraft: result.actionDraft,
          text: result.assistant,
        });
        const heuristicDraftPayload = expectsDraft
          ? buildHeuristicWorkoutDraft({
              userMessage: trimmed,
              exercises: allExercises ?? [],
              spaceId: activeGymId,
            })
          : null;
        const libraryFallbackPayload = expectsDraft
          ? buildLibraryFallbackDraftPayload({
              userMessage: trimmed,
              exercises: allExercises ?? [],
              activeGymId,
            })
          : null;
        const fallbackPayloadCandidates = [
          draftState.payload,
          heuristicDraftPayload,
          libraryFallbackPayload,
        ].filter(Boolean);
        let fallbackActionDraft = null;
        if (expectsDraft) {
          for (let i = 0; i < fallbackPayloadCandidates.length; i += 1) {
            const candidatePayload = fallbackPayloadCandidates[i];
            const candidateDraft = buildActionDraftFromPayload({
              draftPayload: candidatePayload,
              actionKind: fallbackActionKind,
              fallbackTitle: candidatePayload?.name ?? "Coach Draft",
              fallbackSummary: "Coach prepared a workout draft.",
              fallbackGymId: activeGymId,
            });
            if (candidateDraft) {
              fallbackActionDraft = candidateDraft;
              break;
            }
          }
        }
        const resolvedActionDraft = result.actionDraft ?? fallbackActionDraft ?? null;
        const previousExerciseSnapshot = shouldEditExistingDraft
          ? JSON.stringify(actionDraft?.payload?.exercises ?? [])
          : "";
        const nextExerciseSnapshot = JSON.stringify(
          resolvedActionDraft?.payload?.exercises ?? []
        );
        const appliedUpdate = shouldEditExistingDraft
          ? previousExerciseSnapshot !== nextExerciseSnapshot
          : Boolean(resolvedActionDraft);
        const stampedApplyReason = String(result.debug?.stamp?.applyReason ?? "")
          .trim()
          .toUpperCase();
        const applyReason = shouldEditExistingDraft
          ? appliedUpdate
            ? "APPLIED"
            : stampedApplyReason && stampedApplyReason !== "APPLIED"
              ? stampedApplyReason
              : "STATE_NOT_UPDATED"
          : resolvedActionDraft
            ? "APPLIED"
            : "NO_DRAFT_RETURNED";
        const updatedDebugStamp = buildCoachDebugTraceStamp({
          stamp: result.debug?.stamp,
          commitSha: COACH_DEBUG_COMMIT_SHA,
          hasDraft: Boolean(resolvedActionDraft),
          draftCount: Array.isArray(resolvedActionDraft?.payload?.exercises)
            ? resolvedActionDraft.payload.exercises.length
            : 0,
          applied: appliedUpdate,
          applyReason,
        });
        dispatch({
          type: "SET_DEBUG",
          payload: {
            ...(result.debug ?? {}),
            stamp: updatedDebugStamp,
          },
        });
        if (import.meta.env.DEV) {
          console.info("coach_debug_trace", buildCoachDebugTracePanel(updatedDebugStamp));
        }
        const swapConfirmationMessage =
          shouldEditExistingDraft &&
          result.debug?.editResolution?.status === "applied" &&
          resolvedActionDraft
            ? buildSwapConfirmationMessage({
                previousDraft: actionDraft,
                nextDraft: resolvedActionDraft,
                exerciseNameById,
              })
            : null;
        if (swapConfirmationMessage) {
          onNotify?.(swapConfirmationMessage, { tone: "info" });
        }
        const actionErrorSource = [
          draftState.error,
          result.responseValidation?.error,
          Array.isArray(result.actionParseErrors)
            ? result.actionParseErrors.filter(Boolean).join("; ")
            : "",
        ]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join(" ");
        const actionErrorMessage =
          actionErrorSource ||
          "Coach couldn't build a complete workout draft. Please tap Retry.";
        const draftSummaryText = resolvedActionDraft
          ? buildCoachWorkoutSummaryFromDraft(resolvedActionDraft, exerciseNameById)
          : "";
        assistantMeta.actionDraft = resolvedActionDraft;
        assistantMeta.displayText =
          draftSummaryText || sanitizeCoachAssistantText(result.assistant);
        assistantMeta.workoutDraftPayload =
          resolvedActionDraft?.payload ?? draftState.payload;
        assistantMeta.workoutDraftSource = draftState.source;
        assistantMeta.workoutDraftRawJson = draftState.rawJson;
        assistantMeta.workoutDraftError = draftState.error;
        assistantMeta.status = draftState.status;

        if (!streamedId) {
          const assistantId = (messageIdRef.current += 1);
          setMessages((prev) => [
            ...prev,
            createMessage(assistantId, "assistant", result.assistant, assistantMeta),
          ]);
          if (resolvedActionDraft) {
            actionDispatch({
              type: "SET_FROM_MESSAGE",
              payload: {
                messageId: assistantId,
                actionDraft: resolvedActionDraft,
                contractVersion: result.actionContractVersion ?? null,
                contextContract: result.contextContract ?? null,
                payloadFingerprint: result.payloadFingerprint ?? null,
              },
            });
          } else if (expectsDraft) {
            actionDispatch({
              type: "SET_ERROR",
              payload: { error: actionErrorMessage },
            });
          }
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === streamedId
                ? { ...msg, content: result.assistant, meta: assistantMeta }
                : msg
            )
          );
          if (resolvedActionDraft) {
            actionDispatch({
              type: "SET_FROM_MESSAGE",
              payload: {
                messageId: streamedId,
                actionDraft: resolvedActionDraft,
                contractVersion: result.actionContractVersion ?? null,
                contextContract: result.contextContract ?? null,
                payloadFingerprint: result.payloadFingerprint ?? null,
              },
            });
          } else if (expectsDraft) {
            actionDispatch({
              type: "SET_ERROR",
              payload: { error: actionErrorMessage },
            });
          }
        }
        if (pendingLaunchContext) {
          setPendingLaunchContext(null);
          onLaunchContextConsumed?.();
        }
      } catch (err) {
        if (coachKeyMode === "user" && (err?.status === 401 || err?.status === 403)) {
          void setOpenAIKeyStatus("invalid");
        }
        setError(resolveCoachErrorMessage({ err, accessState }));
        setRetryMessage(trimmed);
        if (expectsDraftForRequest) {
          actionDispatch({
            type: "SET_ERROR",
            payload: {
              error:
                err?.message ??
                "Coach couldn't finish building this workout draft. Please retry.",
            },
          });
        }
        if (streamedId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== streamedId));
        }
      } finally {
        setSending(false);
      }
    },
    [
      accessState,
      activeGymId,
      apiKey,
      actionDraft,
      actionDispatch,
      allExercises,
      buildWorkoutDraftForMessage,
      contextScopes,
      effectiveContextEnabled,
      exerciseNameById,
      gymEquipmentCount,
      coachKeyMode,
      keyStatus,
      memory,
      memoryEnabled,
      onNotify,
      onLaunchContextConsumed,
      pendingLaunchContext,
      promptContextState,
      selectedGym,
      selectedGymEquipmentSummary,
      sending,
    ]
  );

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendCoachMessage(input, { clearInput: true });
  };

  const handleRetry = useCallback(async () => {
    const nextMessage = retryMessage || latestUserContent;
    if (!nextMessage || sending) return;
    await sendCoachMessage(nextMessage, { skipUserMessage: true });
  }, [latestUserContent, retryMessage, sendCoachMessage, sending]);

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) {
      void handleSend();
    }
  };

  const resolveDraftInfoForMessage = useCallback(
    (message) => {
      const metaDraft = message?.meta?.workoutDraftPayload;
      if (metaDraft && Array.isArray(metaDraft.exercises) && metaDraft.exercises.length) {
        return {
          draft: metaDraft,
          found: true,
          valid: true,
          error: null,
          source: message?.meta?.workoutDraftSource ?? "messageMeta",
          rawJson: message?.meta?.workoutDraftRawJson ?? null,
        };
      }
      return resolveTemplateDraftInfo({
        actionDraft: message?.meta?.actionDraft ?? null,
        text: message?.content ?? "",
        templateTool,
      });
    },
    [templateTool]
  );

  const resolveTemplateDraftForMessage = useCallback(
    (message) => {
      const templateInfo = resolveDraftInfoForMessage(message);
      if (templateInfo.draft) return templateInfo.draft;
      const workoutPlan = extractWorkoutPlanOutput(message?.content ?? "");
      if (!workoutPlan.valid || !workoutPlan.parsed) return null;
      return buildTemplateDraftFromWorkoutPlan(workoutPlan.parsed, {
        fallbackName: workoutPlan.parsed?.name ?? "Coach Template",
        spaceId: activeGymId,
      });
    },
    [activeGymId, resolveDraftInfoForMessage]
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
      rawJson: latestTemplateDraftInfo?.rawJson ?? null,
      messageId: latestAssistantMessage?.id ?? null,
      messageCreatedAt: latestAssistantMessage?.createdAt ?? null,
    }),
    [latestAssistantMessage, latestTemplateDraftInfo]
  );

  const getDraftMappingStatus = useCallback(
    (draft) => {
      const entries = Array.isArray(draft?.exercises) ? draft.exercises : [];
      const total = entries.length;
      if (!total) {
        return { matched: 0, total: 0, label: "Needs mapping" };
      }
      let matched = 0;
      entries.forEach((entry) => {
        const entryId = Number.parseInt(entry?.exerciseId, 10);
        if (Number.isFinite(entryId) && exerciseMap.has(entryId)) {
          matched += 1;
          return;
        }
        const entryName = normalizeExerciseName(entry?.name ?? entry?.exerciseName);
        if (entryName && exerciseNameLookup.has(entryName)) {
          matched += 1;
        }
      });
      const label = matched === 0 ? "Needs mapping" : `Matched ${matched}/${total} to library`;
      return { matched, total, label };
    },
    [exerciseMap, exerciseNameLookup]
  );

  const copyTextToClipboard = useCallback(
    async (value, { successMessage, failureMessage }) => {
      const text = String(value ?? "");
      if (!text) {
        onNotify?.(failureMessage ?? "Nothing to copy right now.", { tone: "warning" });
        return;
      }
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "true");
          textarea.style.position = "absolute";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        onNotify?.(successMessage ?? "Copied to clipboard.", { tone: "success" });
      } catch {
        onNotify?.(failureMessage ?? "Unable to copy right now.", { tone: "warning" });
      }
    },
    [onNotify]
  );

  const _handleAdjustChip = useCallback((messageId, chipText) => {
    setAdjustMessageId(messageId);
    if (chipText) {
      setInput(chipText);
    }
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        inputRef.current.value.length,
        inputRef.current.value.length
      );
    }
  }, []);

  const _handleStartWorkoutFromMessage = useCallback(
    async (message) => {
      if (!message || message.role !== "assistant") return;
      const existing = startedWorkoutByMessageId[message.id];
      if (existing?.id != null) {
        onOpenWorkout?.(existing.id);
        return;
      }
      const draft = resolveTemplateDraftForMessage(message);
      if (!draft || !Array.isArray(draft.exercises) || draft.exercises.length === 0) {
        onNotify?.("Workout draft is not ready yet.", { tone: "warning" });
        return;
      }

      setStartingWorkoutMessageId(message.id);
      try {
        const mapped = await resolveTemplateExercises(draft.exercises, {
          createMissing: true,
        });
        if (mapped.mappedCount !== draft.exercises.length) {
          throw new Error("Unable to map all exercises for workout start.");
        }
        const workoutPayloadExercises = mapped.resolvedExercises.map((entry) => {
          const reps = Number.parseInt(entry?.reps, 10);
          const setCount = Number.parseInt(entry?.sets, 10);
          const safeSetCount = Number.isFinite(setCount) && setCount > 0 ? setCount : 3;
          const setTemplate = Number.isFinite(reps) && reps > 0 ? { reps } : {};
          return {
            exerciseId: entry.exerciseId,
            sets: Array.from({ length: safeSetCount }, () => ({ ...setTemplate })),
          };
        });
        const workoutId = await createWorkoutFromDraft({
          kind: ActionDraftKinds.create_workout,
          confidence: 0.9,
          risk: "low",
          title: draft.name ?? "Coach Workout",
          summary: "Coach workout draft",
          payload: {
            name: draft.name ?? "Coach Workout",
            gymId: activeGymId ?? draft.spaceId ?? null,
            exercises: workoutPayloadExercises,
          },
        });
        setStartedWorkoutByMessageId((prev) => ({
          ...prev,
          [message.id]: { id: workoutId },
        }));
        onNotify?.("Workout started ✅", {
          tone: "success",
          ...(onOpenWorkout
            ? {
                actionLabel: "Open workout",
                onAction: () => onOpenWorkout(workoutId),
              }
            : {}),
        });
        onOpenWorkout?.(workoutId);
      } catch (err) {
        onNotify?.(`Unable to start workout: ${err?.message ?? "Unknown error"}`, {
          tone: "warning",
        });
      } finally {
        setStartingWorkoutMessageId(null);
      }
    },
    [
      activeGymId,
      onNotify,
      onOpenWorkout,
      resolveTemplateDraftForMessage,
      startedWorkoutByMessageId,
    ]
  );

  const _handleCreateTemplateFromMessage = useCallback(
    async (message) => {
      if (!message || message.role !== "assistant") return;
      const existing = createdTemplateByMessageId[message.id];
      if (existing?.id != null) {
        onOpenTemplate?.(existing.id);
        return;
      }
      const draft = resolveTemplateDraftForMessage(message);
      if (!draft) {
        onNotify?.("Workout draft is not visible yet. Adjust or regenerate first.", {
          tone: "warning",
        });
        return;
      }
      setTemplateCreatingMessageId(message.id);
      try {
        const result = await executeTool("create_template", draft);
        const createdTemplateId = result?.templateId ?? result?.id ?? null;
        setCreatedTemplateByMessageId((prev) => ({
          ...prev,
          [message.id]: {
            id: createdTemplateId,
            name: draft.name ?? "",
          },
        }));
        onNotify?.(
          `Template created${draft.name ? `: ${draft.name}` : "."}`,
          {
            tone: "success",
            ...(createdTemplateId != null && onOpenTemplate
              ? {
                  actionLabel: "Open template",
                  onAction: () => onOpenTemplate(createdTemplateId),
                }
              : {}),
          }
        );
      } catch (err) {
        onNotify?.(`Unable to create template: ${err?.message ?? "Unknown error"}`, {
          tone: "warning",
        });
      } finally {
        setTemplateCreatingMessageId(null);
      }
    },
    [
      createdTemplateByMessageId,
      onNotify,
      onOpenTemplate,
      resolveTemplateDraftForMessage,
    ]
  );

  const handleCopyJsonRecovery = useCallback(
    async (rawJson) => {
      await copyTextToClipboard(rawJson, {
        successMessage: "JSON copied. You can paste this into a template manually.",
        failureMessage: "Unable to copy JSON right now.",
      });
    },
    [copyTextToClipboard]
  );

  const handleDiscardActionDraft = useCallback(() => {
    clearPersistedSuggestedAction();
    actionDispatch({ type: "DISCARD" });
    setActionEditMode(false);
    setActionErrors([]);
  }, [actionDispatch]);

  const handleCancelActionEdit = useCallback(() => {
    setActionEditMode(false);
    setActionEditDraft({
      title: actionDraftTitle,
      gymId: actionDraftGymId ?? "",
      sets: resolveDraftSetCount(actionDraft?.payload?.exercises),
    });
  }, [actionDraft, actionDraftGymId, actionDraftTitle]);

  const handleSaveActionEdit = useCallback(() => {
    if (!actionDraft) return;
    const nextTitle = String(actionEditDraft.title ?? "").trim();
    const nextSetCount = parsePositiveInt(actionEditDraft.sets, 3) ?? 3;
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
    if (Array.isArray(payload.exercises) && payload.exercises.length) {
      payload.exercises = applyUniformSetCountToExercises(
        payload.exercises,
        nextSetCount
      );
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

        clearPersistedSuggestedAction();
        onNotify?.(label, {
          tone: "success",
          ...(canOpen ? { actionLabel: "Open", onAction: openAction } : {}),
        });
        if (result.kind === ActionDraftKinds.create_workout && result.id != null) {
          onOpenWorkout?.(result.id);
        }
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

  const handleSaveActionAsTemplate = useCallback(async () => {
    if (!actionDraft || actionApplying) return;
    if (actionDraft.kind !== ActionDraftKinds.create_workout) return;

    setActionApplying(true);
    setActionErrors([]);
    try {
      const payload = { ...(actionDraft.payload ?? {}) };
      const templateName =
        String(
          payload.name ??
            payload.title ??
            actionDraftTitle ??
            actionDraft.title ??
            "Coach Template"
        ).trim() || "Coach Template";
      const templateDraft = {
        ...actionDraft,
        kind: ActionDraftKinds.create_template,
        title: templateName,
        payload: {
          ...payload,
          name: templateName,
          title: templateName,
          gymId:
            Number.isFinite(Number(payload.gymId)) &&
            Number.parseInt(String(payload.gymId), 10) > 0
              ? Number.parseInt(String(payload.gymId), 10)
              : activeGymId ?? null,
          exercises: Array.isArray(payload.exercises) ? payload.exercises : [],
        },
      };
      const validation = await validateActionDraft(templateDraft, {
        defaultGymId: activeGymId,
      });
      setActionWarnings(validation.warnings ?? []);
      if (!validation.valid || !validation.normalizedDraft) {
        setActionErrors(
          validation.errors?.length
            ? validation.errors
            : ["Unable to save template from draft."]
        );
        return;
      }
      const result = await executeActionDraft(validation.normalizedDraft);
      onNotify?.("Created template.", {
        tone: "success",
        ...(onOpenTemplate && result.id != null
          ? {
              actionLabel: "Open",
              onAction: () => onOpenTemplate(result.id),
            }
          : {}),
      });
      if (result.id != null) {
        onOpenTemplate?.(result.id);
      }
      clearPersistedSuggestedAction();
      actionDispatch({ type: "DISCARD" });
    } catch (err) {
      setActionErrors([err?.message ?? "Unable to save template from draft."]);
    } finally {
      setActionApplying(false);
    }
  }, [
    actionApplying,
    actionDispatch,
    actionDraft,
    actionDraftTitle,
    activeGymId,
    onNotify,
    onOpenTemplate,
  ]);

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
          summary: toRenderableText(proposal.summary, "Action updated."),
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
          summary: toRenderableText(proposal.summary, "Action cancelled."),
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

  return (
    <div className="page">
      <PageHeader title="AI Coach" subtitle="Tool-enabled coaching with your data." />

      <div className="coach-gym-bar">
        <div className="coach-gym-bar__inner">
          <div className="coach-gym-pill">
            <span className="coach-gym-pill__label">
              {effectiveContextEnabled ? "Context On" : "Context Off"}
            </span>
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
        {!effectiveContextEnabled ? (
          <div className="coach-context-warning">
            <span>Context is off. Coach will generate generic workouts.</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setContextEnabled(true);
                setContextScopes((prev) => ({ ...prev, spaces: true }));
              }}
              disabled={sending}
            >
              Enable
            </Button>
          </div>
        ) : null}
      </div>

      {activeWorkoutId != null ? (
        <div className="workout-resume-banner" role="status">
          <div>
            <div className="ui-strong">Workout is open</div>
            <div className="template-meta">Resume your active session any time.</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenWorkout?.(activeWorkoutId)}
          >
            Resume workout
          </Button>
        </div>
      ) : null}

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
            {visibleMessages.length === 0 && !sending ? (
              <div className="chat-empty">Ask a question to get started.</div>
            ) : null}
            {visibleMessages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isLatestAssistant = isAssistant && message.id === latestAssistantId;
              const templateDraftInfo = isAssistant
                ? resolveDraftInfoForMessage(message)
                : null;
              const workoutPlanInfo = isAssistant
                ? extractWorkoutPlanOutput(message.content ?? "")
                : null;
              const inferredTemplateDraft =
                isAssistant && !templateDraftInfo?.draft && workoutPlanInfo?.valid
                  ? buildTemplateDraftFromWorkoutPlan(workoutPlanInfo.parsed, {
                      fallbackName: workoutPlanInfo.parsed?.name ?? "Coach Template",
                      spaceId: activeGymId,
                    })
                  : null;
              const fallbackDraft =
                isAssistant && !templateDraftInfo?.draft && !workoutPlanInfo?.valid
                  ? buildHeuristicWorkoutDraft({
                      userMessage:
                        message?.meta?.requestUserMessage ||
                        (isLatestAssistant ? latestUserContent : "") ||
                        message?.content ||
                        "",
                      exercises: allExercises ?? [],
                      spaceId: activeGymId,
                    })
                  : null;
              const templateDraft =
                templateDraftInfo?.draft ?? inferredTemplateDraft ?? fallbackDraft ?? null;
              const _createdTemplate = createdTemplateByMessageId[message.id] ?? null;
              const _startedWorkout = startedWorkoutByMessageId[message.id] ?? null;
              const _isCreatingTemplate = templateCreatingMessageId === message.id;
              const _isStartingWorkout = startingWorkoutMessageId === message.id;
              const templateError =
                isAssistant && templateDraftInfo?.found && !templateDraftInfo?.valid
                  ? templateDraftInfo.error
                  : null;
              const recoveryJson =
                templateDraftInfo?.rawJson ?? workoutPlanInfo?.rawJson ?? message.content ?? "";
              const workoutPayload = workoutPlanInfo?.valid ? workoutPlanInfo.parsed : null;
              const _workoutName =
                workoutPayload?.name ??
                templateDraft?.name ??
                "Workout Draft";
              const workoutExercises = workoutPayload?.exercises?.length
                ? workoutPayload.exercises.map((entry, index) => ({
                    key: `${message.id}-workout-${index}`,
                    name: String(entry?.name ?? "").trim() || `Exercise ${index + 1}`,
                    sets: entry?.sets ?? "—",
                    reps: entry?.reps ?? "—",
                  }))
                : Array.isArray(templateDraft?.exercises)
                  ? templateDraft.exercises.map((entry, index) => {
                      const fallback =
                        entry?.exerciseId != null
                          ? exerciseMap.get(entry.exerciseId)?.name
                          : "";
                      const name =
                        String(
                          entry?.name ?? entry?.exerciseName ?? fallback ?? ""
                        ).trim() || `Exercise ${index + 1}`;
                      return {
                        key: `${message.id}-template-${index}`,
                        name,
                        sets: entry?.sets ?? "—",
                        reps: entry?.reps ?? "—",
                      };
                    })
                  : [];
              const hasWorkoutCard = hasWorkoutCardPayload(message.role, workoutExercises);
              const _mappingStatus = getDraftMappingStatus(templateDraft);
              const _draftReady =
                Boolean(templateDraft) &&
                hasWorkoutCard &&
                !templateError &&
                (templateDraftInfo?.valid ||
                  hasWorkoutIntent(
                    message?.meta?.requestUserMessage ||
                      latestUserContent ||
                      message?.content ||
                      ""
                  ));
              const _cardGymName =
                message?.meta?.contextSnapshot?.gymName ??
                selectedGym?.name ??
                "None";
              const _cardEquipmentCount =
                message?.meta?.contextSnapshot?.equipmentCount ??
                gymEquipmentCount;
              const cleanedAssistantText = isAssistant
                ? sanitizeCoachAssistantText(message?.meta?.displayText ?? message.content)
                : message.content;
              const displayText = resolveCoachDisplayText({
                role: message.role,
                displayText: cleanedAssistantText,
                content: message.content,
                hasWorkoutCard,
              });
              const _isAdjustOpen = adjustMessageId === message.id;
              const trustContext = message?.meta?.contextContract ?? null;
              const trustFingerprint = message?.meta?.payloadFingerprint ?? null;
              const showTrustLine =
                Boolean(message?.meta?.actionDraft) && hasCoachContextCounts(trustContext);
              const trustGymLabel = trustContext?.activeGymName ?? "None";
              const trustWorkoutsLabel = formatCount(trustContext?.recentWorkoutsCount);
              const trustLastDate = formatDateLabel(trustContext?.lastWorkoutDate);
              const trustLibraryLabel = formatCount(trustContext?.exerciseLibraryCount);
              const trustFingerprintLabel = trustFingerprint?.hash ?? "—";
              const showRequesting = sending && isLatestAssistant;

              return (
                <div key={message.id} className="chat-message" data-role={message.role}>
                  <div className="chat-message__stack">
                    <div className="chat-bubble">{toRenderableText(displayText, "")}</div>
                    {isAssistant ? (
                      <div className="chat-actions">
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
                        ) : (
                          <div className="ui-row ui-row--wrap">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleRetry()}
                              disabled={!isLatestAssistant || sending}
                            >
                              Regenerate
                            </Button>
                          </div>
                        )}
                        {templateError ? (
                          <div className="coach-template-error" role="status">
                            <span>{toRenderableText(templateError, "Unable to prepare template.")}</span>
                            {workoutActionConfig.showCopyJson ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleCopyJsonRecovery(recoveryJson)}
                                disabled={!recoveryJson}
                              >
                                Copy JSON
                              </Button>
                            ) : null}
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
              <div>{toRenderableText(error, "Something went wrong.")}</div>
              {retryMessage || latestUserContent ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleRetry()}
                  disabled={sending}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="chat-input">
            <textarea
              ref={inputRef}
              className="ui-input ui-textarea chat-input__field"
              rows={3}
              placeholder="Ask your coach..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) {
                  setError("");
                  setRetryMessage("");
                }
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
          <div className="template-meta">Chat history is saved on this device.</div>
        </CardFooter>
      </Card>

      {actionTrayVisible ? (
        <div ref={actionTrayRef}>
          <Card className={`coach-action-tray${actionIsBuilding ? " coach-action--building" : ""}`}>
            <CardHeader>
              <div className="ui-row ui-row--between ui-row--wrap">
                <div>
                  <div className="ui-section-title">Suggested Action</div>
                  <div className="template-meta">
                    {actionIsBuilding
                      ? "Building workout..."
                      : actionHasError && !actionDraft
                        ? "Coach couldn't finalize this draft."
                        : actionDraftSummary || "Coach has a ready action draft."}
                  </div>
                </div>
                {actionDraft ? (
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
                ) : null}
              </div>
            </CardHeader>
            <CardBody className="coach-action-body ui-stack">
              {actionIsBuilding ? (
                <div className="coach-action-skeleton" role="status" aria-live="polite">
                  <div className="coach-action-title">Building workout...</div>
                  <div className="coach-action-skeleton__row" />
                  <div className="coach-action-skeleton__row" />
                  <div className="coach-action-skeleton__row" />
                  <div className="coach-action-skeleton__row" />
                  <div className="coach-action-skeleton__row" />
                </div>
              ) : null}

              {!actionIsBuilding && actionHasError && !actionDraft ? (
                <div className="coach-action-alert coach-action-alert--error">
                  <div>
                    {actionStateError ||
                      "Coach couldn't build this workout draft. Please retry."}
                  </div>
                </div>
              ) : null}

              {!actionIsBuilding && actionDraft ? (
                <>
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
                      <div>
                        <Label htmlFor="action-draft-sets">Sets (all exercises)</Label>
                        <Input
                          id="action-draft-sets"
                          type="number"
                          min={1}
                          max={8}
                          step={1}
                          value={String(actionEditDraft.sets ?? 3)}
                          onChange={(event) =>
                            setActionEditDraft((prev) => ({
                              ...prev,
                              sets: parsePositiveInt(event.target.value, 3) ?? 3,
                            }))
                          }
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

                  {actionDraftKind === ActionDraftKinds.create_workout ||
                  actionDraftKind === ActionDraftKinds.create_template ? (
                    <div className="coach-action-exercises">
                      {visibleActionExerciseRows.length ? (
                        visibleActionExerciseRows.map((entry) => (
                          <div key={entry.key} className="coach-action-exercise">
                            <div className="coach-action-exercise__name">{entry.name}</div>
                            <div className="coach-action-exercise__meta">{entry.meta}</div>
                          </div>
                        ))
                      ) : (
                        <div className="template-meta">Exercises: (from draft)</div>
                      )}
                      {showActionExerciseToggle ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setActionExercisesExpanded((prev) => !prev)}
                        >
                          {actionExercisesExpanded
                            ? "Show less"
                            : `Show all (${actionDraftExerciseRows.length})`}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {hasDraftDetails ? (
                    <details
                      className="coach-action-details"
                      open={actionEditMode || actionDetailsOpen}
                      onToggle={(event) => {
                        if (actionEditMode) return;
                        setActionDetailsOpen(event.currentTarget.open);
                      }}
                    >
                      <summary>Draft details</summary>
                      <div className="coach-action-details__body">
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
                  ) : null}

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
                  {actionHasError && actionStateError ? (
                    <div className="coach-action-alert coach-action-alert--error">
                      <div>{actionStateError}</div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardBody>
            <CardFooter className="coach-action-footer ui-row ui-row--wrap">
              {actionIsBuilding ? (
                <>
                  <Button variant="primary" size="sm" disabled>
                    Building...
                  </Button>
                  <Button variant="secondary" size="sm" disabled>
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" disabled>
                    Save as template
                  </Button>
                  <Button variant="secondary" size="sm" disabled>
                    Discard
                  </Button>
                </>
              ) : actionDraft ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleApplyActionDraft()}
                    loading={actionApplying}
                    disabled={actionApplying || actionEditMode}
                  >
                    {actionPrimaryLabel}
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
                  {canSaveActionAsTemplate && !actionEditMode ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSaveActionAsTemplate}
                      disabled={actionApplying}
                    >
                      Save as template
                    </Button>
                  ) : null}
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
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleRetry()}
                  disabled={sending}
                >
                  Retry
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
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
                  <div className="proposal-card__summary">
                    {toRenderableText(proposal.summary, "Pending action")}
                  </div>
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
                      {toRenderableText(event.summary, "Action update")} ·{" "}
                      {toRenderableText(event.status, "pending")}
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
            <div className="ui-section-title">Coach Debug Trace</div>
          </CardHeader>
          <CardBody>
            <pre className="coach-debug__payload">
              {JSON.stringify(coachDebugTrace, null, 2)}
            </pre>
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
              <span className="ui-muted">Debug stamp:</span>{" "}
              {state.debug?.stamp
                ? JSON.stringify(state.debug.stamp)
                : "—"}
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
