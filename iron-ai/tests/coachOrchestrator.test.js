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
    expect(SYSTEM_PROMPT).toMatch(/push workout, include at least one chest press/i);
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

  it("skips workout repair pass and uses deterministic fallback when workout output is invalid", async () => {
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"name":"Leg Day","exercises":[]}
\`\`\``,
      toolCalls: [],
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

    expect(mocks.createChatCompletion).not.toHaveBeenCalled();
    expect(result.responseValidation.status).toBe("repaired");
    expect(result.actionDraft?.payload?.exercises?.length).toBeGreaterThan(0);
  });

  it("bounds prompt history to recent user and assistant messages", async () => {
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Workout ready.",
      toolCalls: [],
    });

    const longHistory = Array.from({ length: 80 }).flatMap((_, index) => [
      { role: "user", content: `User message ${index}` },
      { role: "assistant", content: `Assistant reply ${index}` },
      { role: "tool", tool_call_id: `call_${index}`, content: `Tool payload ${index}` },
    ]);

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: longHistory,
      userMessage: "Need a push workout",
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

    const sentMessages = mocks.streamChatCompletion.mock.calls[0]?.[0]?.messages ?? [];
    const promptHistory = sentMessages.filter((entry) => entry.role !== "system");
    expect(promptHistory.length).toBeLessThanOrEqual(24);
    expect(promptHistory.every((entry) => entry.role !== "tool")).toBe(true);
    expect(promptHistory[promptHistory.length - 1]).toMatchObject({
      role: "user",
      content: "Need a push workout",
    });
    expect(result.debug?.promptWindow?.droppedMessages).toBeGreaterThan(0);
  });

  it("retries once with minimal history when context window overflows", async () => {
    mocks.streamChatCompletion
      .mockRejectedValueOnce({
        status: 400,
        code: "context_length_exceeded",
        message:
          "This model's maximum context length has been exceeded.",
      })
      .mockResolvedValueOnce({
        content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Push workout ready.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Push Day","summary":"Push workout","payload":{"name":"Push Day","exercises":[{"exerciseId":1,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10},{"reps":10},{"reps":10}]},{"exerciseId":3,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":1,"sets":[{"reps":12},{"reps":12},{"reps":12}]},{"exerciseId":2,"sets":[{"reps":10},{"reps":10},{"reps":10}]}]}}}
\`\`\``,
        toolCalls: [],
      });

    const chatHistory = Array.from({ length: 18 }).flatMap((_, index) => [
      { role: "user", content: `Earlier user ${index}` },
      {
        role: "assistant",
        content: `Earlier assistant response ${index}`,
      },
    ]);

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory,
      userMessage: "Need a push workout",
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

    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    const secondAttemptMessages =
      mocks.streamChatCompletion.mock.calls[1]?.[0]?.messages ?? [];
    const secondPromptHistory = secondAttemptMessages.filter(
      (entry) => entry.role !== "system"
    );
    expect(secondPromptHistory).toEqual([
      { role: "user", content: "Need a push workout" },
    ]);
    expect(result.assistant).toBe("Push workout ready.");
    expect(result.debug?.contextWindowRetry).toBe(true);
    expect(result.debug?.promptWindow?.retriedWithMinimalHistory).toBe(true);
  });

  it("applies add-legs edit ops as a deterministic append to the current draft", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 1, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 2, name: "Overhead Press", primaryMuscles: ["shoulders"] },
      { exerciseId: 4, name: "Leg Press", primaryMuscles: ["quads"] },
      { exerciseId: 5, name: "Romanian Deadlift", primaryMuscles: ["hamstrings"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 1, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 2, name: "Overhead Press", primaryMuscles: ["shoulders"], default_sets: 3, default_reps: 10 },
      { id: 4, name: "Leg Press", primaryMuscles: ["quads"], default_sets: 3, default_reps: 12 },
      { id: 5, name: "Romanian Deadlift", primaryMuscles: ["hamstrings"], default_sets: 3, default_reps: 10 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Added 2 legs exercises.","editDraft":{"mode":"EDIT","ops":[{"op":"add_exercises","count":2,"muscleGroup":"legs","placement":"end","exerciseIds":[4,5]}]}}
\`\`\``,
      toolCalls: [],
    });

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

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add 2 legs exercises",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
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

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises.slice(0, 2)).toEqual(currentDraft.payload.exercises);
    expect(updatedExercises.length).toBe(currentDraft.payload.exercises.length + 2);
    expect(updatedExercises.slice(-2).map((entry) => entry.exerciseId)).toEqual([4, 5]);
    expect(result.debug?.editResolution?.status).toBe("applied");
  });

  it("applies add-named edits via deterministic fallback when model ops are missing", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 21, name: "Push Up", primaryMuscles: ["chest"] },
      { exerciseId: 22, name: "Incline Push Up", primaryMuscles: ["chest"] },
      { exerciseId: 24, name: "Plyo Push-up", primaryMuscles: ["chest"] },
      { exerciseId: 23, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 21, name: "Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
      { id: 22, name: "Incline Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
      { id: 24, name: "Plyo Push-up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 10 },
      { id: 23, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add 2 pushup exercises",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "bodyweight",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises.slice(0, 2)).toEqual(currentDraft.payload.exercises);
    expect(updatedExercises.length).toBe(currentDraft.payload.exercises.length + 2);
    expect(updatedExercises.slice(-2).map((entry) => entry.exerciseId)).toEqual([21, 22]);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.debug?.stamp).toEqual({
      model: "gpt-4o-mini",
      provider: "openai",
      route: "openai-direct",
      requestType: "edit",
      hasOps: false,
      opsCount: 0,
      hasDraft: true,
      draftCount: 4,
      applied: false,
    });
  });

  it("fails safely for broad add-edit targets that are not specific exercise names", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 21, name: "Push Up", primaryMuscles: ["chest"] },
      { exerciseId: 22, name: "Incline Push Up", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 21, name: "Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
      { id: 22, name: "Incline Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add 2 push exercises",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "bodyweight",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/couldn'?t safely apply/);
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/exact exercise name/);
  });

  it("applies swap edit requests to the current draft when model ops are missing", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Pull Up", primaryMuscles: ["back"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change back squat to pull up",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "pull-up bar",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises).toHaveLength(2);
    expect(updatedExercises[0]?.exerciseId).toBe(11);
    expect(updatedExercises[1]).toEqual(currentDraft.payload.exercises[1]);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.assistant).toBe("Updated your workout.");
  });

  it("treats same-exercise swap edits as a safe no-op", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "No change needed.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change back squat to back squat",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "barbell",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(String(result.assistant ?? "").toLowerCase()).not.toMatch(/couldn'?t safely apply/);
  });

  it("rejects unknown swap targets safely without mutating the draft", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change back squat to superman pogo deadlift",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "barbell",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/couldn'?t safely apply/);
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/more specific/);
  });

  it("asks for clarification when swap target matches multiple known exercises", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Pull Up", primaryMuscles: ["back"] },
      { exerciseId: 13, name: "Assisted Pull Up", primaryMuscles: ["back"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
      { id: 13, name: "Assisted Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 10 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strength Workout",
      summary: "Current draft",
      payload: {
        name: "Strength Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change back squat to pull up",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "pull-up bar",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/couldn'?t safely apply/);
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/specify the exact exercise name/);
    expect(result.assistant).toContain("Pull Up");
    expect(result.assistant).toContain("Assisted Pull Up");
  });
  it("falls back to deterministic workout draft without a second repair request", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 11, name: "Barbell Bench Press" },
      { exerciseId: 12, name: "Overhead Press" },
      { exerciseId: 13, name: "Triceps Pushdown" },
      { exerciseId: 14, name: "Incline Dumbbell Press" },
      { exerciseId: 15, name: "Cable Fly" },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 11, name: "Barbell Bench Press", default_sets: 4, default_reps: 8 },
      { id: 12, name: "Overhead Press", default_sets: 3, default_reps: 8 },
      { id: 13, name: "Triceps Pushdown", default_sets: 3, default_reps: 12 },
      { id: 14, name: "Incline Dumbbell Press", default_sets: 3, default_reps: 10 },
      { id: 15, name: "Cable Fly", default_sets: 3, default_reps: 12 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Here's a push workout.",
      toolCalls: [],
    });

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "push workout",
      responseMode: "workout",
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

    expect(result.responseValidation?.status).toBe("repaired");
    expect(result.actionDraft).toMatchObject({
      kind: "create_workout",
      title: "Push Workout",
    });
    expect(result.actionDraft?.payload?.exercises?.length).toBe(5);
    expect(
      result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)
    ).toEqual([11, 12, 13, 14, 15]);
    expect(result.assistant).toMatch(/formatting issue/i);
    expect(mocks.createChatCompletion).not.toHaveBeenCalled();
  });
});
