import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  createChatCompletion: vi.fn(),
  getCoachRequestContext: vi.fn(),
  getCoachContextSnapshot: vi.fn(),
  buildContextFingerprint: vi.fn(),
}));

vi.mock("../src/services/openai", () => ({
  DEFAULT_COACH_MODEL: "gpt-4o-mini",
  streamChatCompletion: mocks.streamChatCompletion,
  createChatCompletion: mocks.createChatCompletion,
}));

vi.mock("../src/coach/tools", () => ({
  executeTool: vi.fn(),
  getOpenAITools: vi.fn(() => []),
  getToolRegistry: vi.fn(() => new Map()),
  summarizeToolCall: vi.fn(() => "summary"),
  validateToolInput: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock("../src/coach/context", () => ({
  getCoachRequestContext: mocks.getCoachRequestContext,
  getCoachContextSnapshot: mocks.getCoachContextSnapshot,
}));

vi.mock("../src/coach/memory", () => ({
  summarizeCoachMemory: vi.fn(() => null),
}));

vi.mock("../src/coach/fingerprint", () => ({
  buildContextFingerprint: mocks.buildContextFingerprint,
}));

vi.mock("../src/coach/telemetry", () => ({
  recordCoachPayloadTelemetry: vi.fn(),
}));

import {
  SYSTEM_PROMPT,
  buildSystemMessages,
  runCoachTurn,
} from "../src/coach/orchestrator";

const BASE_REQUEST_CONTEXT = {
  activeGymId: 1,
  gymName: "Condo",
  equipmentIds: ["dumbbell"],
  equipmentCount: 1,
  exerciseLibraryCount: 10,
  customExercisesCount: 0,
  templatesCount: 1,
  recentWorkoutsCount: 2,
  lastWorkoutDate: null,
  contextBytes: 42,
  contextBuildMs: 1,
};

describe("coach orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoachRequestContext.mockResolvedValue({
      context: BASE_REQUEST_CONTEXT,
      meta: { contextBytes: 42, contextBuildMs: 1 },
    });
    mocks.getCoachContextSnapshot.mockResolvedValue({
      snapshot: {
        activeGymId: 1,
        activeGymName: "Condo",
      },
      meta: { truncated: false, omitted: [] },
      contract: {
        activeGymId: 1,
        activeGymName: "Condo",
        equipmentCount: 1,
        contextBytes: 42,
        buildMs: 1,
      },
    });
    mocks.buildContextFingerprint.mockResolvedValue({
      algorithm: "sha256",
      hash: "abc123",
      contextBytes: 42,
    });
  });

  it("includes contextEnabled and equipmentSummary rules in prompt payload", () => {
    const messages = buildSystemMessages({
      contextSnapshot: null,
      memorySummary: null,
      requestContext: BASE_REQUEST_CONTEXT,
      contextState: {
        contextEnabled: false,
        selectedGym: null,
        equipmentSummary: [],
      },
    });
    expect(SYSTEM_PROMPT).toMatch(/contextEnabled is false/i);
    const contextMessage = messages.find((entry) =>
      entry.content.startsWith("Context availability (authoritative JSON):")
    );
    expect(contextMessage?.content).toContain('"contextEnabled":false');
    expect(contextMessage?.content).toContain('"equipmentSummary":[]');
  });

  it("retries once with repair prompt when workout output is invalid", async () => {
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"name":"Leg Day","exercises":[]}
\`\`\``,
      toolCalls: [],
    });
    mocks.createChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{"name":"Leg Day","exercises":[{"name":"Goblet Squat","sets":3,"reps":12}]}
\`\`\``,
          },
        },
      ],
    });

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "Make a legs workout for condo gym",
      responseMode: "general",
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "dumbbell",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.responseValidation.status).toBe("repaired");
    expect(result.assistant).toMatch(/Goblet Squat/);
  });
});
