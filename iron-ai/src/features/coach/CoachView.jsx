import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { getCoachAccessState } from "./coachAccess";
import { setOpenAIKeyStatus, useSettings } from "../../state/settingsStore";

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

export default function CoachView({ launchContext, onLaunchContextConsumed }) {
  const { settings, apiKey, hasKey, keyStatus, coachMemoryEnabled } = useSettings();
  const memoryEnabled = coachMemoryEnabled;
  const memory = useMemo(
    () => normalizeCoachMemory(settings?.coach_memory),
    [settings?.coach_memory]
  );

  const [state, dispatch] = useReducer(coachReducer, initialCoachState);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [contextPreview, setContextPreview] = useState(null);
  const [contextMeta, setContextMeta] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
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
    }
  }, [contextEnabled]);

  const buildContextPreview = useCallback(async () => {
    if (!contextEnabled || !contextPreviewOpen) return;
    setContextLoading(true);
    try {
      const { snapshot, meta } = await getCoachContextSnapshot({
        scopes: contextScopes,
        memorySummary: memoryEnabled ? memory : null,
      });
      setContextPreview(snapshot);
      setContextMeta(meta);
    } catch {
      setContextPreview({ error: "Unable to build preview right now." });
      setContextMeta(null);
    } finally {
      setContextLoading(false);
    }
  }, [contextEnabled, contextPreviewOpen, contextScopes, memory, memoryEnabled]);

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

  return (
    <div className="page">
      <PageHeader title="AI Coach" subtitle="Tool-enabled coaching with your data." />

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
            {state.proposals.map((proposal) => (
              <div key={proposal.id} className="proposal-card">
                <div className="proposal-card__summary">{proposal.summary}</div>
                <div className="proposal-card__meta">
                  Status: {proposal.status ?? "pending"}
                </div>
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
            ))}
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

      {import.meta.env.DEV ? (
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
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
