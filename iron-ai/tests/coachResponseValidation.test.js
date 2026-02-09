import { describe, expect, it } from "vitest";

import {
  extractWorkoutPlanOutput,
  validateCoachResponse,
  validateTemplateJsonOutput,
} from "../src/coach/responseValidation";

describe("coach response validation", () => {
  it("rejects template JSON without a fenced json block", () => {
    const result = validateTemplateJsonOutput(
      '{"name":"Push Day","exercises":[{"exerciseId":1,"sets":3,"reps":8}]}'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/fenced/i);
  });

  it("accepts strict fenced template JSON", () => {
    const result = validateTemplateJsonOutput(`\`\`\`json
{"name":"Push Day","exercises":[{"exerciseId":1,"sets":3,"reps":8}]}
\`\`\``);
    expect(result.valid).toBe(true);
    expect(result.parsed?.name).toBe("Push Day");
  });

  it("accepts strict fenced template JSON with names instead of ids", () => {
    const result = validateTemplateJsonOutput(`\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Goblet Squat","sets":3,"reps":12}]}
\`\`\``);
    expect(result.valid).toBe(true);
    expect(result.parsed?.exercises?.[0]?.name).toBe("Goblet Squat");
  });

  it("rejects empty workout exercises when context is enabled", () => {
    const result = validateCoachResponse({
      userMessage: "Make a legs workout",
      assistantText: `\`\`\`json
{"name":"Leg Day","exercises":[]}
\`\`\``,
      responseMode: "general",
      contextEnabled: true,
    });
    expect(result.valid).toBe(false);
  });

  it("requires generic workout JSON plus enable-context guidance when context is disabled", () => {
    const invalid = validateCoachResponse({
      userMessage: "Make a legs workout for condo gym",
      assistantText: "I'll use your available equipment and build a workout now.",
      responseMode: "general",
      contextEnabled: false,
    });
    expect(invalid.valid).toBe(false);

    const valid = validateCoachResponse({
      userMessage: "Make a legs workout for condo gym",
      assistantText: `I can't see equipment with context off. Enable context or choose a gym for personalization.
\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Goblet Squat","sets":3,"reps":12}]}
\`\`\``,
      responseMode: "general",
      contextEnabled: false,
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
});
