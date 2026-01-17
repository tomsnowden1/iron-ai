import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  PageHeader,
} from "../../components/ui";
import { getCoachContextSnapshot } from "../../coach/context";
import { normalizeCoachMemory } from "../../coach/memory";
import { coachReducer, initialCoachState } from "../../coach/state";
import { executeWriteToolCall, runCoachTurn } from "../../coach/orchestrator";
import { buildContextFingerprint } from "../../coach/fingerprint";
import { resolveTemplateExercises } from "../../coach/templateExerciseMapping";
import { getCoachAccessState } from "./coachAccess";
import { setOpenAIKeyStatus, useSettings } from "../../state/settingsStore";
import { getCoachActiveGymMeta, listWorkoutSpaces, setCoachActiveGymMeta } from "../../db";
import { sortSpacesByName, resolveActiveSpace } from "../../workoutSpaces/logic";
import BottomSheet from "../../components/ui/BottomSheet";

function createMessage(id, role, content) {
  return {
    id,
    role,
    content,
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

function formatTemplateMappingPreview(mapping, limit = 5) {
  const list = Array.isArray(mapping) ? mapping : [];
  const trimmed = list.slice(0, limit);
  const remainder = Math.max(0, list.length - trimmed.length);
  const lines = trimmed.map((entry) => {
    const draftLabel = entry.draftName || (entry.draftId != null ? `ID ${entry.draftId}` : "Unknown");
    if (!entry.resolvedId) {
      return `${draftLabel} → create custom`;
    }
    const resolvedLabel = entry.resolvedName ?? "Unknown";
    return `${draftLabel} → ${resolvedLabel} (#${entry.resolvedId})`;
  });
  if (remainder) lines.push(`… +${remainder} more`);
  return lines;
}

export default function CoachView({
  launchContext,
  onLaunchContextConsumed,
  onNotify,
  onNavigateToGyms,
  diagnosticsEnabled,
}) {
  const { settings, apiKey, hasKey, keyStatus, coachMemoryEnabled } = useSettings();
  const memoryEnabled = coachMemoryEnabled;
  const memory = useMemo(
    () => normalizeCoachMemory(settings?.coach_memory),
    [settings?.coach_memory]
  );

  const [state, dispatch] = useReducer(coachReducer, initialCoachState);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const sortedSpaces = useMemo(
    () => (workoutSpaces ? sortSpacesByName(workoutSpaces) : []),
    [workoutSpaces]
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
  const [debugContextContract, setDebugContextContract] = useState(null);
  const [debugContextFingerprint, setDebugContextFingerprint] = useState(null);
  const [templateMappingPreview, setTemplateMappingPreview] = useState({});
  const [gymPickerOpen, setGymPickerOpen] = useState(false);
  const [activeGymId, setActiveGymId] = useState(null);
  const [coachGymLoaded, setCoachGymLoaded] = useState(false);
  const [coachGymHasStored, setCoachGymHasStored] = useState(false);
  const [pendingLaunchContext, setPendingLaunchContext] = useState(
    () => launchContext ?? null
  );
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
  const coachDiagnosticsEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("debug") === "1" ||
      window.localStorage.getItem("debugCoach") === "1"
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCoachGym = async () => {
      const result = await getCoachActiveGymMeta();
      if (cancelled) return;
      setActiveGymId(result.value ?? null);
      setCoachGymLoaded(true);
      setCoachGymHasStored(result.exists);
    };
    void loadCoachGym();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!coachGymLoaded || coachGymHasStored) return;
    if (!sortedSpaces.length) return;
    const defaultSpace = resolveActiveSpace(
      sortedSpaces,
      settings?.active_space_id ?? null
    );
    if (!defaultSpace) return;
    setActiveGymId(defaultSpace.id ?? null);
    setCoachGymHasStored(true);
  }, [coachGymLoaded, coachGymHasStored, sortedSpaces, settings?.active_space_id]);

  useEffect(() => {
    if (!coachGymLoaded) return;
    if (activeGymId == null) return;
    if (!sortedSpaces.length) return;
    const exists = sortedSpaces.some((space) => space.id === activeGymId);
    if (!exists) {
      setActiveGymId(null);
      setCoachGymHasStored(true);
    }
  }, [activeGymId, coachGymLoaded, sortedSpaces]);

  useEffect(() => {
    if (!coachGymLoaded) return;
    void setCoachActiveGymMeta(activeGymId);
  }, [activeGymId, coachGymLoaded]);

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
  const gymNameLabel = hasGyms
    ? selectedGym
      ? selectedGym.name ?? "Untitled Gym"
      : "No gym selected"
    : "None";
  const gymEquipmentLabel = selectedGym ? formatEquipmentCount(selectedGym) : "— equipment";
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
  const debugPayloadFingerprint =
    payloadFingerprint ??
    debugContextFingerprint ??
    state.debug?.payloadFingerprint ??
    null;
  const actionContractVersion = state.debug?.actionContractVersion ?? null;
  const payloadFingerprintLabel = debugPayloadFingerprint
    ? `${debugPayloadFingerprint.hash}${
        debugPayloadFingerprint.algorithm
          ? ` (${debugPayloadFingerprint.algorithm})`
          : ""
      }`
    : "—";

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

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    if (!accessState.canChat) {
      setError(accessState.message);
      return;
    }

    setError("");
    setSending(true);
    setInput("");

    const userId = (messageIdRef.current += 1);
    setMessages((prev) => [...prev, createMessage(userId, "user", trimmed)]);

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
          setMessages((prev) => [...prev, createMessage(streamedId, "assistant", "")]);
        },
        onStreamDelta: (delta) => {
          if (!streamedId) return;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === streamedId ? { ...msg, content: `${msg.content}${delta}` } : msg
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

      if (!streamedId) {
        const assistantId = (messageIdRef.current += 1);
        setMessages((prev) => [
          ...prev,
          createMessage(assistantId, "assistant", result.assistant),
        ]);
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamedId ? { ...msg, content: result.assistant } : msg
          )
        );
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
    }
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) {
      void handleSend();
    }
  };

  const confirmProposal = async (proposal) => {
    dispatch({
      type: "UPDATE_PROPOSAL_STATUS",
      payload: { id: proposal.id, status: "confirming" },
    });
    const result = await executeWriteToolCall({
      proposal,
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
    setActiveGymId(nextId);
    setGymPickerOpen(false);
    if (!onNotify) return;
    const nextGym = sortedSpaces.find((space) => space.id === nextId);
    const nextLabel = nextGym?.name ?? "No gym selected";
    onNotify(`Gym changed to ${nextLabel}`, {
      tone: "info",
      duration: 5000,
      actionLabel: "Undo",
      onAction: () => setActiveGymId(previousId ?? null),
    });
  };

  const coachDiagnosticsReport = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      coachContext: {
        activeGymId: debugContract?.activeGymId ?? null,
        gymName: debugContract?.activeGymName ?? null,
        equipmentCount: debugContract?.equipmentCount ?? null,
        recentWorkoutsCount: debugContract?.recentWorkoutsCount ?? null,
        lastWorkoutDate: debugContract?.lastWorkoutDate ?? null,
        templatesCount: debugContract?.templatesCount ?? null,
        customExercisesCount: debugContract?.customExercisesCount ?? null,
        exerciseLibraryCount: debugContract?.exerciseLibraryCount ?? null,
        contextBytes: debugContract?.contextBytes ?? null,
        contextBuildMs: debugContract?.buildMs ?? null,
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
    [actionContractVersion, debugContract, debugPayloadFingerprint]
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
            <span className="coach-gym-pill__label">Gym</span>
            <span className="coach-gym-pill__name">{gymNameLabel}</span>
            <span className="coach-gym-pill__count">({gymEquipmentLabel})</span>
          </div>
          <div className="coach-gym-bar__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGymPickerOpen(true)}
              disabled={!hasGyms}
            >
              Change
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
            {messages.map((message) => (
              <div key={message.id} className="chat-message" data-role={message.role}>
                <div className="chat-bubble">{message.content}</div>
              </div>
            ))}
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
          <CardHeader>
            <div className="ui-section-title">Coach context debug</div>
          </CardHeader>
          <CardBody className="ui-stack">
            <div className="coach-trust__details">
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Active gym ID</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.activeGymId)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Gym name</div>
                <div className="coach-trust__item-value">
                  {debugContract?.activeGymName ?? "—"}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Equipment</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.equipmentCount)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Recent workouts</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.recentWorkoutsCount)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Last workout</div>
                <div className="coach-trust__item-value">
                  {formatDateLabel(debugContract?.lastWorkoutDate)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Templates</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.templatesCount)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Custom exercises</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.customExercisesCount)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Library exercises</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.exerciseLibraryCount)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Contract version</div>
                <div className="coach-trust__item-value">
                  {actionContractVersion ?? "—"}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Context bytes</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.contextBytes)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Context build ms</div>
                <div className="coach-trust__item-value">
                  {formatCount(debugContract?.buildMs)}
                </div>
              </div>
              <div className="coach-trust__item">
                <div className="coach-trust__item-label">Payload fingerprint</div>
                <div className="coach-trust__item-value">{payloadFingerprintLabel}</div>
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

      <BottomSheet
        open={gymPickerOpen}
        onClose={() => setGymPickerOpen(false)}
        title="Select gym"
        ariaLabel="Select a gym"
      >
        {sortedSpaces.length ? (
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
        ) : (
          <div className="template-meta">No gyms saved yet.</div>
        )}
      </BottomSheet>
    </div>
  );
}
