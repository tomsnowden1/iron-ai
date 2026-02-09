import { describe, expect, it } from "vitest";
import { getToolRegistry } from "../../coach/tools";
import {
  buildTemplateDraftFromWorkoutPlan,
  resolveTemplateDraftInfo,
} from "./templateDraft";

const templateTool = getToolRegistry().get("create_template");

describe("resolveTemplateDraftInfo", () => {
  it("detects fenced JSON with surrounding text", () => {
    const text = `Here you go:
\`\`\`json
{"name":"Push Day","exercises":[{"exerciseId":1,"sets":3,"reps":8}]}
\`\`\`
All set.`;
    const result = resolveTemplateDraftInfo({
      actionDraft: null,
      text,
      templateTool,
    });
    expect(result.found).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.draft?.name).toBe("Push Day");
  });

  it("uses the first valid draft across multiple code blocks", () => {
    const text = `Drafts:
\`\`\`json
{"name":"Bad","exercises":[{"exerciseId":1}]}
\`\`\`
\`\`\`json
{"name":"Better","exercises":[{"exerciseId":2,"sets":"4","reps":"10"}]}
\`\`\``;
    const result = resolveTemplateDraftInfo({
      actionDraft: null,
      text,
      templateTool,
    });
    expect(result.valid).toBe(true);
    expect(result.draft?.name).toBe("Better");
    expect(result.draft?.exercises?.[0]?.exerciseId).toBe(2);
  });

  it("returns invalid when fenced JSON cannot be parsed", () => {
    const text = `\`\`\`json
{name:"Oops", "exercises":[{"exerciseId":1,"sets":3,"reps":8}]}
\`\`\``;
    const result = resolveTemplateDraftInfo({
      actionDraft: null,
      text,
      templateTool,
    });
    expect(result.valid).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("accepts template JSON using exercise names without numeric ids", () => {
    const text = `\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Goblet Squat","sets":3,"reps":12}]}
\`\`\``;
    const result = resolveTemplateDraftInfo({
      actionDraft: null,
      text,
      templateTool,
    });
    expect(result.valid).toBe(true);
    expect(result.draft?.exercises?.[0]?.exerciseId).toBeUndefined();
    expect(result.draft?.exercises?.[0]?.name).toBe("Goblet Squat");
  });

  it("accepts raw JSON without fenced blocks", () => {
    const text =
      '{"name":"Leg Day","exercises":[{"name":"Romanian Deadlift","sets":4,"reps":8}]}';
    const result = resolveTemplateDraftInfo({
      actionDraft: null,
      text,
      templateTool,
    });
    expect(result.valid).toBe(true);
    expect(result.source).toBe("raw:json");
  });

  it("accepts empty text when action draft payload exists", () => {
    const result = resolveTemplateDraftInfo({
      actionDraft: {
        kind: "create_template",
        title: "Leg Draft",
        payload: {
          name: "Leg Draft",
          exercises: [{ name: "Leg Press", sets: 3, reps: 12 }],
        },
      },
      text: "",
      templateTool,
    });
    expect(result.valid).toBe(true);
    expect(result.draft?.name).toBe("Leg Draft");
  });
});

describe("buildTemplateDraftFromWorkoutPlan", () => {
  it("builds template draft entries from workout plan names", () => {
    const draft = buildTemplateDraftFromWorkoutPlan(
      {
        name: "Push Day",
        exercises: [{ name: "Bench Press", sets: 4, reps: 8 }],
      },
      { spaceId: 2 }
    );
    expect(draft?.name).toBe("Push Day");
    expect(draft?.spaceId).toBe(2);
    expect(draft?.exercises?.[0]?.name).toBe("Bench Press");
  });
});
