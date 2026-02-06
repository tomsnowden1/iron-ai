import { describe, expect, it } from "vitest";

import {
  buildHeuristicWorkoutDraft,
  getCoachWorkoutActionConfig,
  hasWorkoutCardPayload,
  hasWorkoutIntent,
  resolveCoachDisplayText,
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
});
