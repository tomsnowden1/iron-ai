import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  normalizeExerciseString,
  resolveExerciseId,
} from "../src/coach/exerciseResolver";

const EXERCISES = [
  { id: 1, name: "Bench Press", aliases: ["Barbell Bench Press"] },
  { id: 2, name: "Dumbbell Bench Press", aliases: ["DB Bench Press"] },
  { id: 3, name: "Barbell Curl", aliases: [] },
  { id: 4, name: "Dumbbell Curl", aliases: [] },
];

describe("exercise resolver", () => {
  it("normalizes abbreviations", () => {
    expect(normalizeExerciseString("DB bench")).toBe("dumbbell bench");
  });

  it("normalizes plural and pushup variants", () => {
    expect(normalizeExerciseString("Pushups")).toBe("push up");
    expect(normalizeExerciseString("Squats")).toBe("squat");
  });

  it("builds index for canonical names and aliases", () => {
    const index = buildSearchIndex(EXERCISES);
    expect(index.byId.has(1)).toBe(true);
    expect(index.normalizedNameIndex.has("dumbbell bench press")).toBe(true);
  });

  it("resolves exact canonical match", () => {
    const result = resolveExerciseId("Bench Press", { allExercises: EXERCISES });
    expect(result.status).toBe("resolved");
    expect(result.exerciseId).toBe(1);
  });

  it("resolves alias to canonical exerciseId", () => {
    const result = resolveExerciseId("DB bench press", { allExercises: EXERCISES });
    expect(result.status).toBe("resolved");
    expect(result.exerciseId).toBe(2);
  });

  it("returns needsReview for ambiguous terms", () => {
    const result = resolveExerciseId("curl", { allExercises: EXERCISES });
    expect(result.status).toBe("needsReview");
    expect(result.suggestions.length).toBeGreaterThan(1);
  });

  it("returns needsReview when no match exists", () => {
    const result = resolveExerciseId("moon walk squat", { allExercises: EXERCISES });
    expect(result.status).toBe("needsReview");
  });
});
