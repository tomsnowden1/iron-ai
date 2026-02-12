import { describe, expect, it } from "vitest";
import {
  actionDraftReducer,
  initialActionDraftState,
} from "../src/coach/actionDraftState.js";

const sampleDraft = {
  kind: "create_template",
  confidence: 0.6,
  risk: "low",
  title: "Draft",
  summary: "Draft summary.",
  payload: {
    name: "Draft",
    exercises: [{ exerciseId: 1 }],
  },
};

describe("action draft state", () => {
  it("moves to building immediately when a draft request starts", () => {
    const withDraft = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: {
        messageId: 11,
        actionDraft: sampleDraft,
      },
    });
    const next = actionDraftReducer(withDraft, {
      type: "BUILD_START",
      payload: { clearDraft: true },
    });
    expect(next.status).toBe("building");
    expect(next.draft).toBeNull();
  });

  it("stores a draft when a message provides one", () => {
    const next = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: {
        messageId: 42,
        actionDraft: sampleDraft,
        contractVersion: "coach_action_v1",
      },
    });
    expect(next.draft).toEqual(sampleDraft);
    expect(next.sourceMessageId).toBe(42);
    expect(next.status).toBe("ready");
  });

  it("clears the draft when discarded", () => {
    const withDraft = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: { messageId: 1, actionDraft: sampleDraft },
    });
    const cleared = actionDraftReducer(withDraft, { type: "DISCARD" });
    expect(cleared.draft).toBeNull();
    expect(cleared.status).toBe("idle");
  });

  it("updates the draft payload when edited", () => {
    const withDraft = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: { messageId: 1, actionDraft: sampleDraft },
    });
    const updated = actionDraftReducer(withDraft, {
      type: "UPDATE_DRAFT",
      payload: { draft: { ...sampleDraft, title: "Updated" } },
    });
    expect(updated.draft.title).toBe("Updated");
    expect(updated.status).toBe("ready");
  });

  it("stores an actionable error while preserving the last draft", () => {
    const withDraft = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: { messageId: 3, actionDraft: sampleDraft },
    });
    const errored = actionDraftReducer(withDraft, {
      type: "SET_ERROR",
      payload: { error: "payload.exercises[0].exerciseId: Required" },
    });
    expect(errored.status).toBe("error");
    expect(errored.error).toMatch(/payload\.exercises\[0\]\.exerciseId/i);
    expect(errored.draft).toEqual(sampleDraft);
  });
});
