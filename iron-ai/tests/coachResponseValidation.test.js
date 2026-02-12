import { describe, expect, it } from "vitest";

import {
  classifyCoachResponseMode,
  extractWorkoutPlanOutput,
  parseCoachEditIntent,
  validateCoachResponse,
  validateTemplateJsonOutput,
} from "../src/coach/responseValidation";

describe("coach response validation", () => {
  const allowedCandidateIds = new Set([1, 2, 3]);
  const libraryIdSet = new Set([1, 2, 3, 4]);

  it("rejects template JSON without a fenced json block", () => {
    const result = validateTemplateJsonOutput(
      '{"name":"Push Day","exercises":[{"exerciseId":1,"sets":3,"reps":8}]}'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/fenced/i);
  });

  it("accepts strict fenced template JSON", () => {
    const result = validateTemplateJsonOutput(
      `\`\`\`json
{"name":"Push Day","exercises":[{"exerciseId":1,"sets":3,"reps":8}]}
\`\`\``,
      { allowedCandidateIds, libraryIdSet }
    );
    expect(result.valid).toBe(true);
    expect(result.parsed?.name).toBe("Push Day");
  });

  it("rejects template JSON without exerciseId", () => {
    const result = validateTemplateJsonOutput(`\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Goblet Squat","sets":3,"reps":12}]}
\`\`\``);
    expect(result.valid).toBe(false);
  });

  it("rejects template JSON exerciseId outside candidates", () => {
    const result = validateTemplateJsonOutput(
      `\`\`\`json
{"name":"Leg Day","exercises":[{"exerciseId":44,"sets":3,"reps":12}]}
\`\`\``,
      { allowedCandidateIds, libraryIdSet }
    );
    expect(result.valid).toBe(false);
  });

  it("rejects workout replies that do not include actionDraft with exerciseId", () => {
    const result = validateCoachResponse({
      userMessage: "Make a legs workout",
      assistantText: `\`\`\`json
{"name":"Leg Day","exercises":[]}
\`\`\``,
      responseMode: "general",
      contextEnabled: true,
      allowedCandidateIds,
      libraryIdSet,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts plain-text workout lists as fallback when parsable", () => {
    const result = validateCoachResponse({
      userMessage: "make push workout",
      assistantText: `Here's a push workout:
1. Bench Press: 3 sets of 10 reps
2. Incline Push-Up: 3 sets of 12 reps
3. Dumbbell Shoulder Press: 3 x 10
4. Cable Fly: 3 sets of 12 reps
5. Triceps Pushdown: 3 sets of 12 reps`,
      responseMode: "general",
      contextEnabled: true,
      allowedCandidateIds,
      libraryIdSet,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects workout actionDraft IDs outside candidate list", () => {
    const invalid = validateCoachResponse({
      userMessage: "make legs workout",
      assistantText: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Leg day ready.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Leg Day","summary":"Leg workout","payload":{"name":"Leg Day","exercises":[{"exerciseId":99,"sets":[{"reps":10}]}]}}}
\`\`\``,
      responseMode: "general",
      contextEnabled: true,
      allowedCandidateIds,
      libraryIdSet,
    });
    expect(invalid.valid).toBe(false);
  });

  it("accepts workout actionDraft with valid exerciseIds and context-off guidance", () => {
    const valid = validateCoachResponse({
      userMessage: "Make a legs workout for condo gym",
      assistantText: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"I can't see equipment with context off. Enable context or choose a gym for personalization.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Leg Day","summary":"Generic leg workout","payload":{"name":"Leg Day","exercises":[{"exerciseId":1,"sets":[{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10}]},{"exerciseId":3,"sets":[{"reps":12}]},{"exerciseId":1,"sets":[{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10}]}]}}}
\`\`\``,
      responseMode: "general",
      contextEnabled: false,
      allowedCandidateIds,
      libraryIdSet,
    });
    expect(valid.valid).toBe(true);
  });

  it("extracts workout plan from raw JSON", () => {
    const result = extractWorkoutPlanOutput(
      '{"name":"Leg Day","exercises":[{"name":"Split Squat","sets":3,"reps":10}]}'
    );
    expect(result.valid).toBe(true);
    expect(result.source).toBe("raw:json");
  });

  it("validates needsReview suggestions against candidate/library IDs", () => {
    const result = validateCoachResponse({
      userMessage: "make legs workout",
      assistantText: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"I need review.","actionDraft":{"kind":"create_workout","confidence":0.7,"risk":"low","title":"Leg Day","summary":"Needs review","payload":{"name":"Leg Day","needsReview":[{"requestedName":"DB squat","suggestions":[{"exerciseId":1,"name":"Goblet Squat"}]}]}}}
\`\`\``,
      responseMode: "general",
      contextEnabled: true,
      allowedCandidateIds,
      libraryIdSet,
    });
    expect(result.valid).toBe(true);
  });

  it("treats explicit responseMode=workout as workout validation even without workout keywords", () => {
    expect(
      classifyCoachResponseMode({
        userMessage: "add 2 push exercises",
        responseMode: "workout",
      })
    ).toBe("workout");
  });

  it("parses add named exercise intent for pushup phrasing", () => {
    const editIntent = parseCoachEditIntent("add 2 pushup exercises");
    expect(editIntent).toEqual({
      isEditRequest: true,
      kind: "add_named_exercises",
      addCount: 2,
      fromExerciseName: null,
      toExerciseName: "pushup",
    });
  });

  it("parses add named exercise intent for add-in pushup phrasing", () => {
    const editIntent = parseCoachEditIntent("add in 2 pushup exercise");
    expect(editIntent).toEqual({
      isEditRequest: true,
      kind: "add_named_exercises",
      addCount: 2,
      fromExerciseName: null,
      toExerciseName: "pushup",
    });
  });

  it("parses swap edit intent for change X to Y phrasing", () => {
    const editIntent = parseCoachEditIntent("change back squat to pull up");
    expect(editIntent).toMatchObject({
      isEditRequest: true,
      kind: "swap_exercise",
      fromExerciseName: "back squat",
      toExerciseName: "pull up",
    });
  });

  it("parses swap intent for swap X for Y phrasing", () => {
    const editIntent = parseCoachEditIntent("swap pull up for back squat");
    expect(editIntent).toEqual({
      isEditRequest: true,
      kind: "swap_exercise",
      addCount: null,
      fromExerciseName: "pull up",
      toExerciseName: "back squat",
    });
  });

  it("fails safely for ordinal references like first exercise", () => {
    const editIntent = parseCoachEditIntent("change the first exercise to pull up");
    expect(editIntent).toEqual({
      isEditRequest: true,
      kind: "generic_edit",
      addCount: null,
      fromExerciseName: null,
      toExerciseName: null,
    });
  });

  it("fails safely for ambiguous plural replace phrasing", () => {
    const editIntent = parseCoachEditIntent("replace squats with pull ups");
    expect(editIntent).toEqual({
      isEditRequest: true,
      kind: "generic_edit",
      addCount: null,
      fromExerciseName: null,
      toExerciseName: null,
    });
  });

  it("fails add-legs edit validation when the model replaces the existing list", () => {
    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Push Workout",
      summary: "Push day",
      payload: {
        name: "Push Workout",
        exercises: [
          { exerciseId: 1, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 2, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] },
        ],
      },
    };
    const editIntent = parseCoachEditIntent("add 2 legs exercises");
    const exerciseCatalogById = new Map([
      [1, { id: 1, primaryMuscles: ["chest"] }],
      [2, { id: 2, primaryMuscles: ["shoulders"] }],
      [3, { id: 3, primaryMuscles: ["quads"] }],
      [4, { id: 4, primaryMuscles: ["hamstrings"] }],
    ]);

    const result = validateCoachResponse({
      userMessage: "add 2 legs exercises",
      assistantText: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Updated.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Push Workout","summary":"Updated workout","payload":{"name":"Push Workout","exercises":[{"exerciseId":3,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":4,"sets":[{"reps":10},{"reps":10},{"reps":10}]},{"exerciseId":1,"sets":[{"reps":8},{"reps":8},{"reps":8}]},{"exerciseId":2,"sets":[{"reps":10},{"reps":10},{"reps":10}]}]}}}
\`\`\``,
      responseMode: "workout",
      contextEnabled: true,
      allowedCandidateIds: new Set([1, 2, 3, 4]),
      libraryIdSet: new Set([1, 2, 3, 4]),
      currentDraft,
      editIntent,
      exerciseCatalogById,
    });

    expect(result.valid).toBe(false);
    expect(String(result.error ?? "")).toMatch(/unchanged/i);
  });
});
