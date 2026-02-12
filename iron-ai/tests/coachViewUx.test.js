import { describe, expect, it } from "vitest";

import {
  COACH_ACTION_PREVIEW_MIN_EXERCISES,
  COACH_ACTION_SHOW_ALL_THRESHOLD,
  applyUniformSetCountToExercises,
  buildSwapConfirmationMessage,
  buildCoachWorkoutSummaryFromDraft,
  buildHeuristicWorkoutDraft,
  getVisibleCoachActionExerciseCount,
  getSuggestedActionPrimaryLabel,
  shouldShowSuggestedActionSaveTemplate,
  getCoachWorkoutActionConfig,
  hasWorkoutCardPayload,
  hasWorkoutIntent,
  isStartWorkoutIntentText,
  isTemplateIntentText,
  resolveCoachErrorMessage,
  sanitizeCoachAssistantText,
  resolveCoachDisplayText,
  shouldShowCoachActionShowAllToggle,
  shouldForceWorkoutResponseMode,
} from "../src/features/coach/coachViewUiModel";

describe("coach view UX model", () => {
  it("renders a workout card when payload exercises exist even if text is blank", () => {
    const hasCard = hasWorkoutCardPayload("assistant", [
      { name: "Goblet Squat", sets: 3, reps: 12 },
    ]);
    const displayText = resolveCoachDisplayText({
      role: "assistant",
      displayText: "",
      content: "",
      hasWorkoutCard: hasCard,
    });
    expect(hasCard).toBe(true);
    expect(displayText).toBe("Workout ready.");
  });

  it("uses start-first action hierarchy in production", () => {
    const config = getCoachWorkoutActionConfig({ debugEnabled: false });
    expect(config.primary).toBe("Start workout");
    expect(config.secondaryAdjust).toBe("Adjust");
    expect(config.tertiaryTemplate).toBe("Save as template");
  });

  it("hides copy-json and per-message gym actions in production", () => {
    const config = getCoachWorkoutActionConfig({ debugEnabled: false });
    expect(config.showCopyJson).toBe(false);
    expect(config.showPerMessageChangeGym).toBe(false);
  });

  it("detects workout intent and builds a deterministic fallback draft", () => {
    expect(hasWorkoutIntent("make me a legs workout")).toBe(true);
    const draft = buildHeuristicWorkoutDraft({
      userMessage: "make me a legs workout",
      exercises: [
        { id: 1, name: "Goblet Squat", muscle_group: "legs", default_sets: 3, default_reps: 12 },
        { id: 2, name: "Romanian Deadlift", muscle_group: "hamstrings", default_sets: 3, default_reps: 10 },
        { id: 3, name: "Bench Press", muscle_group: "chest", default_sets: 4, default_reps: 8 },
      ],
      spaceId: 9,
    });
    expect(draft?.name).toMatch(/Leg/);
    expect(draft?.spaceId).toBe(9);
    expect(draft?.exercises?.length).toBeGreaterThan(0);
  });

  it("builds fallback draft even when exercise library is still loading", () => {
    const draft = buildHeuristicWorkoutDraft({
      userMessage: "make me a legs workout",
      exercises: [],
      spaceId: 11,
    });
    expect(draft?.name).toBe("Leg Workout Draft");
    expect(draft?.spaceId).toBe(11);
    expect(Array.isArray(draft?.exercises)).toBe(true);
    expect(draft?.exercises?.length).toBeGreaterThan(0);
  });

  it("surfaces a clear server-key message when OPENAI_API_KEY is missing", () => {
    const message = resolveCoachErrorMessage({
      err: { status: 500, message: "Server is missing OPENAI_API_KEY." },
      accessState: { canChat: true, keyMode: "server" },
    });
    expect(message).toMatch(/missing OPENAI_API_KEY/i);
  });

  it("keeps specific server errors actionable in server-key mode", () => {
    const message = resolveCoachErrorMessage({
      err: { status: 500, message: "OpenAI request failed." },
      accessState: { canChat: true, keyMode: "server" },
    });
    expect(message).toMatch(/Coach server error/i);
  });

  it("removes JSON plumbing text from assistant display", () => {
    const cleaned = sanitizeCoachAssistantText(`Here is the template in JSON format:
\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Squat","sets":3,"reps":8}]}
\`\`\`
Use this template payload.`);
    expect(cleaned).toBe("");
  });

  it("detects quick-action intent text for start/template", () => {
    expect(isTemplateIntentText("make it a template")).toBe(true);
    expect(isStartWorkoutIntentText("start workout")).toBe(true);
    expect(isTemplateIntentText("how are you")).toBe(false);
  });

  it("forces workout response mode for follow-up adjustments when a draft is visible", () => {
    expect(
      shouldForceWorkoutResponseMode({
        userMessage: "more quads and make it 8 exercises",
        hasVisibleWorkoutDraft: true,
      })
    ).toBe(true);
    expect(
      shouldForceWorkoutResponseMode({
        userMessage: "start workout",
        hasVisibleWorkoutDraft: true,
      })
    ).toBe(false);
    expect(
      shouldForceWorkoutResponseMode({
        userMessage: "how are you today",
        hasVisibleWorkoutDraft: true,
      })
    ).toBe(false);
  });

  it("shows exercise preview list by default and enables show-all only for larger drafts", () => {
    expect(shouldShowCoachActionShowAllToggle(COACH_ACTION_SHOW_ALL_THRESHOLD)).toBe(
      false
    );
    expect(shouldShowCoachActionShowAllToggle(9)).toBe(true);
    expect(getVisibleCoachActionExerciseCount(9, false)).toBe(
      COACH_ACTION_PREVIEW_MIN_EXERCISES
    );
    expect(getVisibleCoachActionExerciseCount(9, true)).toBe(9);
    expect(getVisibleCoachActionExerciseCount(6, false)).toBe(6);
  });

  it("uses an open-workout primary CTA for workout suggested actions", () => {
    expect(getSuggestedActionPrimaryLabel("create_workout")).toBe("Open workout");
    expect(getSuggestedActionPrimaryLabel("create_template")).toBe("Apply");
  });

  it("shows save-as-template action only for workout drafts", () => {
    expect(shouldShowSuggestedActionSaveTemplate("create_workout")).toBe(true);
    expect(shouldShowSuggestedActionSaveTemplate("create_template")).toBe(false);
    expect(shouldShowSuggestedActionSaveTemplate("create_gym")).toBe(false);
  });

  it("builds chat workout summaries directly from the draft sets/reps", () => {
    const summary = buildCoachWorkoutSummaryFromDraft(
      {
        title: "Push Workout",
        payload: {
          name: "Push Workout",
          exercises: [
            {
              exerciseId: 10,
              sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }],
            },
            {
              exerciseId: 11,
              sets: [{ reps: 12 }, { reps: 12 }, { reps: 12 }],
            },
          ],
        },
      },
      new Map([
        [10, "Barbell Bench Press"],
        [11, "Triceps Pushdown"],
      ])
    );

    expect(summary).toContain("Barbell Bench Press - 3 sets x 8 reps");
    expect(summary).toContain("Triceps Pushdown - 3 sets x 12 reps");
  });

  it("applies a uniform set count to every exercise while preserving set shape", () => {
    const updated = applyUniformSetCountToExercises(
      [
        {
          exerciseId: 1,
          sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 145 }],
        },
        {
          exerciseId: 2,
          sets: [{ reps: 12 }],
        },
      ],
      4
    );

    expect(updated[0].sets).toHaveLength(4);
    expect(updated[0].sets[2]).toEqual({ reps: 8, weight: 135 });
    expect(updated[1].sets).toHaveLength(4);
    expect(updated[1].sets[3]).toEqual({ reps: 12 });
  });

  it("builds a short swap confirmation message when one exercise is replaced", () => {
    const message = buildSwapConfirmationMessage({
      previousDraft: {
        payload: {
          exercises: [
            { exerciseId: 10, sets: [{ reps: 5 }] },
            { exerciseId: 12, sets: [{ reps: 8 }] },
          ],
        },
      },
      nextDraft: {
        payload: {
          exercises: [
            { exerciseId: 11, sets: [{ reps: 5 }] },
            { exerciseId: 12, sets: [{ reps: 8 }] },
          ],
        },
      },
      exerciseNameById: new Map([
        [10, "Back Squat"],
        [11, "Pull Up"],
      ]),
    });

    expect(message).toBe("Replaced Back Squat -> Pull Up");
  });

  it("does not return swap confirmation for no-op swaps", () => {
    const message = buildSwapConfirmationMessage({
      previousDraft: {
        payload: {
          exercises: [
            { exerciseId: 10, sets: [{ reps: 5 }] },
            { exerciseId: 12, sets: [{ reps: 8 }] },
          ],
        },
      },
      nextDraft: {
        payload: {
          exercises: [
            { exerciseId: 10, sets: [{ reps: 5 }] },
            { exerciseId: 12, sets: [{ reps: 8 }] },
          ],
        },
      },
      exerciseNameById: new Map([[10, "Back Squat"]]),
    });

    expect(message).toBeNull();
  });
});
