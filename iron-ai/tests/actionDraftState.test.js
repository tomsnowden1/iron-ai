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
  });

  it("clears the draft when discarded", () => {
    const withDraft = actionDraftReducer(initialActionDraftState, {
      type: "SET_FROM_MESSAGE",
      payload: { messageId: 1, actionDraft: sampleDraft },
    });
    const cleared = actionDraftReducer(withDraft, { type: "DISCARD" });
    expect(cleared.draft).toBeNull();
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
  });
});
