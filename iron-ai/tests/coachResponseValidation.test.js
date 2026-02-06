import { describe, expect, it } from "vitest";

import {
  extractWorkoutPlanOutput,
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
});
