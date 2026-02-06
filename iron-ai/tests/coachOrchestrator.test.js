import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  createChatCompletion: vi.fn(),
  getCoachRequestContext: vi.fn(),
  getCoachContextSnapshot: vi.fn(),
  getCoachExerciseCandidates: vi.fn(),
  getAllExercises: vi.fn(),
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
  getCoachExerciseCandidates: mocks.getCoachExerciseCandidates,
}));

vi.mock("../src/db", () => ({
  getAllExercises: mocks.getAllExercises,
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
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 1, name: "Goblet Squat" },
      { exerciseId: 2, name: "Leg Press" },
      { exerciseId: 3, name: "Lunge" },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 1, name: "Goblet Squat" },
      { id: 2, name: "Leg Press" },
      { id: 3, name: "Lunge" },
    ]);
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
      exerciseCandidates: [{ exerciseId: 1, name: "Goblet Squat" }],
    });
    expect(SYSTEM_PROMPT).toMatch(/contextEnabled is false/i);
    const contextMessage = messages.find((entry) =>
      entry.content.startsWith("Context availability (authoritative JSON):")
    );
    expect(contextMessage?.content).toContain('"contextEnabled":false');
    expect(contextMessage?.content).toContain('"equipmentSummary":[]');
    const candidateMessage = messages.find((entry) =>
      entry.content.startsWith("Exercise candidates (authoritative JSON")
    );
    expect(candidateMessage?.content).toContain('"exerciseId":1');
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
{"contractVersion":"coach_action_v1","assistantText":"Leg day is ready.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Leg Day","summary":"Leg workout","payload":{"name":"Leg Day","exercises":[{"exerciseId":1,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10},{"reps":10},{"reps":10}]},{"exerciseId":3,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":1,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10},{"reps":10},{"reps":10}]}]}}}
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
    const repairMessages = mocks.createChatCompletion.mock.calls[0]?.[0]?.messages ?? [];
    const repairPrompt = repairMessages[repairMessages.length - 1]?.content ?? "";
    expect(repairPrompt).toMatch(/candidate/i);
    expect(result.responseValidation.status).toBe("repaired");
    expect(result.actionDraft?.payload?.exercises?.length).toBeGreaterThan(0);
  });
});
