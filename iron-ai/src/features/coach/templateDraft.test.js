import { describe, expect, it } from "vitest";
import { getToolRegistry } from "../../coach/tools";
import { resolveTemplateDraftInfo } from "./templateDraft";

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
});
