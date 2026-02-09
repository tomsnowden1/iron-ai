import { describe, expect, it, vi } from "vitest";

import { handleCoachRequest } from "../api/_coachCore.js";

describe("coach server api core", () => {
  it("blocks production traffic when explicitly disabled", async () => {
    const result = await handleCoachRequest({
      payload: { messages: [] },
      env: {
        VERCEL_ENV: "production",
        ALLOW_COACH_PROD: "false",
        OPENAI_API_KEY: "sk-test",
      },
      fetchImpl: vi.fn(),
    });

    expect(result.status).toBe(403);
    expect(result.body.error.message).toMatch(/disabled in production/i);
  });

  it("allows production traffic by default when ALLOW_COACH_PROD is unset", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Coach reply" } }],
      }),
    });

    const result = await handleCoachRequest({
      payload: {
        action: "streamChatCompletion",
        messages: [{ role: "user", content: "Help me plan." }],
      },
      env: {
        VERCEL_ENV: "production",
        OPENAI_API_KEY: "sk-test",
      },
      fetchImpl,
    });

    expect(result.status).toBe(200);
    expect(result.body.content).toBe("Coach reply");
  });

  it("returns config error when OPENAI_API_KEY is missing", async () => {
    const result = await handleCoachRequest({
      payload: { messages: [] },
      env: {},
      fetchImpl: vi.fn(),
    });

    expect(result.status).toBe(500);
    expect(result.body.error.message).toMatch(/missing OPENAI_API_KEY/i);
  });

  it("returns normalized stream payload for coach turn requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Coach reply",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_templates",
                    arguments: '{"limit":5}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await handleCoachRequest({
      payload: {
        action: "streamChatCompletion",
        messages: [{ role: "user", content: "Help me plan." }],
      },
      env: { OPENAI_API_KEY: "sk-test" },
      fetchImpl,
    });

    expect(result.status).toBe(200);
    expect(result.body.content).toBe("Coach reply");
    expect(result.body.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: {
          name: "get_templates",
          arguments: '{"limit":5}',
        },
      },
    ]);
  });

  it("returns a clear upstream connectivity error when OpenAI is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await handleCoachRequest({
      payload: {
        action: "streamChatCompletion",
        messages: [{ role: "user", content: "Help me plan." }],
      },
      env: { OPENAI_API_KEY: "sk-test" },
      fetchImpl,
    });
    expect(result.status).toBe(502);
    expect(result.body.error.message).toMatch(/Unable to reach OpenAI/i);
  });
});
