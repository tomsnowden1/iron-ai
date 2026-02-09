import { describe, expect, it } from "vitest";
import {
  ACTION_DRAFT_CONTRACT_VERSION,
  ActionDraftSchema,
  parseCoachActionDraftMessage,
} from "../src/coach/actionDraftContract.js";
import { buildContextFingerprint } from "../src/coach/fingerprint.js";

const baseDraft = {
  confidence: 0.7,
  risk: "low",
  title: "Starter plan",
  summary: "A simple first step.",
};

const draftByKind = {
  create_workout: {
    ...baseDraft,
    kind: "create_workout",
    payload: {
      name: "Full body",
      exercises: [
        {
          exerciseId: 1,
          sets: [{ reps: 8, weight: 135 }],
        },
      ],
    },
  },
  create_template: {
    ...baseDraft,
    kind: "create_template",
    payload: {
      name: "Push Day",
      exercises: [
        {
          exerciseId: 2,
          sets: [{ reps: 10 }],
        },
      ],
    },
  },
  create_gym: {
    ...baseDraft,
    kind: "create_gym",
    payload: { name: "Downtown Gym", equipmentIds: ["dumbbell"] },
  },
};

describe("action draft contract", () => {
  it("validates minimal payloads for each action kind", () => {
    Object.values(draftByKind).forEach((draft) => {
      const result = ActionDraftSchema.safeParse(draft);
      expect(result.success).toBe(true);
    });
  });

  it("parses a valid JSON code block", () => {
    const contract = {
      contractVersion: ACTION_DRAFT_CONTRACT_VERSION,
      assistantText: "Here is your plan.",
      actionDraft: draftByKind.create_template,
    };
    const message = [
      "Intro text.",
      "",
      "```json",
      JSON.stringify(contract, null, 2),
      "```",
    ].join("\n");
    const parsed = parseCoachActionDraftMessage(message);
    expect(parsed.contractVersion).toBe(ACTION_DRAFT_CONTRACT_VERSION);
    expect(parsed.assistantText).toBe(contract.assistantText);
    expect(parsed.actionDraft).toEqual(contract.actionDraft);
  });

  it("falls back on invalid JSON", () => {
    const message = "Text before.\n```json\n{bad json\n```";
    const parsed = parseCoachActionDraftMessage(message);
    expect(parsed.assistantText).toBe("Text before.");
    expect(parsed.actionDraft).toBeUndefined();
    expect(parsed.parseErrors?.length ?? 0).toBeGreaterThan(0);
  });

  it("handles messages with no JSON", () => {
    const message = "Plain response.";
    const parsed = parseCoachActionDraftMessage(message);
    expect(parsed.assistantText).toBe("Plain response.");
    expect(parsed.actionDraft).toBeUndefined();
  });

  it("ignores extra text around JSON when a block is present", () => {
    const contract = {
      contractVersion: ACTION_DRAFT_CONTRACT_VERSION,
      assistantText: "I can create that for you.",
      actionDraft: draftByKind.create_workout,
    };
    const message = [
      "Note before.",
      "",
      "```json",
      JSON.stringify(contract),
      "```",
      "Extra text.",
    ].join("\n");
    const parsed = parseCoachActionDraftMessage(message);
    expect(parsed.contractVersion).toBe(ACTION_DRAFT_CONTRACT_VERSION);
    expect(parsed.assistantText).toBe(contract.assistantText);
  });
});

describe("coach context fingerprint", () => {
  it("is stable for identical input", async () => {
    const snapshot = { a: 1, list: ["x", 2], nested: { ok: true } };
    const first = await buildContextFingerprint(snapshot);
    const second = await buildContextFingerprint(snapshot);
    expect(first.hash).toBe(second.hash);
    expect(first.algorithm).toBe(second.algorithm);
    expect(first.contextBytes).toBe(second.contextBytes);
  });
});
