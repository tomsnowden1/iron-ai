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

  it("prefers generic leg exercises over alphabetical oddball leg candidates", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 13, name: "Alternate Leg Diagonal Bound", primaryMuscles: ["quads"] },
      { exerciseId: 29, name: "Atlas Stones", primaryMuscles: ["hamstrings"] },
      { exerciseId: 31, name: "Goblet Squat", primaryMuscles: ["quads"] },
      { exerciseId: 32, name: "Walking Lunge", primaryMuscles: ["quads", "glutes"] },
      { exerciseId: 33, name: "Leg Press", primaryMuscles: ["quads"] },
      { exerciseId: 99, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 13, name: "Alternate Leg Diagonal Bound", primaryMuscles: ["quads"], default_sets: 3, default_reps: 10 },
      { id: 29, name: "Atlas Stones", primaryMuscles: ["hamstrings"], default_sets: 3, default_reps: 8 },
      { id: 31, name: "Goblet Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 10 },
      { id: 32, name: "Walking Lunge", primaryMuscles: ["quads", "glutes"], default_sets: 3, default_reps: 10 },
      { id: 33, name: "Leg Press", primaryMuscles: ["quads"], default_sets: 3, default_reps: 12 },
      { id: 99, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Push Workout",
      summary: "Current draft",
      payload: {
        name: "Push Workout",
        exercises: [
          { exerciseId: 99, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add in 2 leg exercises",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: false,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: false,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: [],
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises.length).toBe(currentDraft.payload.exercises.length + 2);
    expect(updatedExercises.slice(0, 1)).toEqual(currentDraft.payload.exercises);
    expect(updatedExercises.slice(-2).map((entry) => entry.exerciseId)).toEqual([31, 32]);
    expect(result.debug?.stamp).toMatchObject({
      modeChosen: "edit",
      intent: "add_legs_exercises",
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      opsProduced: 1,
    });
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
    expect(result.debug?.stamp).toMatchObject({
      model: "gpt-4o-mini",
      provider: "openai",
      route: "openai-direct",
      requestType: "edit",
      hasOps: false,
      opsCount: 0,
      hasDraft: true,
      draftCount: 4,
      applied: true,
      applyReason: "APPLIED",
    });
  });

  it("applies single add edits from plain exercise text when model ops are empty", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 31, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 32, name: "Incline Dumbbell Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      {
        id: 31,
        name: "Barbell Bench Press",
        primaryMuscles: ["chest"],
        default_sets: 4,
        default_reps: 8,
      },
      {
        id: 32,
        name: "Incline Dumbbell Press",
        primaryMuscles: ["chest"],
        default_sets: 3,
        default_reps: 10,
      },
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
        exercises: [{ exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add barbell bench press",
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

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises).toHaveLength(2);
    expect(updatedExercises[0]).toEqual(currentDraft.payload.exercises[0]);
    expect(updatedExercises[1]?.exerciseId).toBe(31);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.debug?.stamp).toMatchObject({
      requestType: "edit",
      hasOps: false,
      opsCount: 0,
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      fallbackOpsCount: 1,
      applied: true,
      applyReason: "APPLIED",
    });
  });

  it("adds the best tricep pulldown match when model ops are empty", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 41, name: "Triceps Pulldown", primaryMuscles: ["triceps"] },
      { exerciseId: 42, name: "Triceps Pushdown", primaryMuscles: ["triceps"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      {
        id: 41,
        name: "Triceps Pulldown",
        primaryMuscles: ["triceps"],
        default_sets: 3,
        default_reps: 12,
      },
      {
        id: 42,
        name: "Triceps Pushdown",
        primaryMuscles: ["triceps"],
        default_sets: 3,
        default_reps: 12,
      },
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
        exercises: [{ exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "now add tricep pulldown",
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
          equipmentSummary: "cable",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises).toHaveLength(2);
    expect(updatedExercises[1]?.exerciseId).toBe(41);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      fallbackOpsCount: 1,
    });
  });

  it("asks for clarification and keeps the draft unchanged for ambiguous add names", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 51, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 52, name: "Dumbbell Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      {
        id: 51,
        name: "Barbell Bench Press",
        primaryMuscles: ["chest"],
        default_sets: 4,
        default_reps: 8,
      },
      {
        id: 52,
        name: "Dumbbell Bench Press",
        primaryMuscles: ["chest"],
        default_sets: 3,
        default_reps: 10,
      },
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
        exercises: [{ exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add bench press",
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
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      fallbackOpsCount: 1,
      applyReason: "APPLY_SKIPPED",
    });
    expect(result.assistant).toContain("matches multiple options");
    expect(result.assistant).toContain("Barbell Bench Press");
    expect(result.assistant).toContain("Dumbbell Bench Press");
  });

  it("routes take-out phrasing to edit mode and removes atlas stones from the active draft", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 61, name: "Atlas Stones", primaryMuscles: ["full body"] },
      { exerciseId: 62, name: "Barbell Row", primaryMuscles: ["back"] },
      { exerciseId: 63, name: "Front Squat", primaryMuscles: ["quads"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      {
        id: 61,
        name: "Atlas Stones",
        primaryMuscles: ["full body"],
        default_sets: 3,
        default_reps: 5,
      },
      { id: 62, name: "Barbell Row", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
      { id: 63, name: "Front Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 6 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Strongman Workout",
      summary: "Current draft",
      payload: {
        name: "Strongman Workout",
        exercises: [
          { exerciseId: 61, name: "Atlas Stones", sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 62, name: "Barbell Row", sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "take out the atlas stones",
      responseMode: "workout",
      draftEditConfig: {
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

    const updatedExercises = result.actionDraft?.payload?.exercises ?? [];
    expect(updatedExercises).toHaveLength(1);
    expect(updatedExercises[0]?.exerciseId).toBe(62);
    expect(result.debug?.stamp).toMatchObject({
      requestType: "edit",
      modeReason: "EDIT_INTENT_DETECTED",
      hasOps: false,
      opsCount: 0,
      hasDraft: true,
      draftCount: 1,
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      fallbackOpsCount: 1,
      applied: true,
      applyReason: "APPLIED",
    });
  });

  it("asks for clarification and keeps the draft unchanged for ambiguous take-out names", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 71, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 72, name: "Dumbbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 73, name: "Back Squat", primaryMuscles: ["quads"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      {
        id: 71,
        name: "Barbell Bench Press",
        primaryMuscles: ["chest"],
        default_sets: 4,
        default_reps: 8,
      },
      {
        id: 72,
        name: "Dumbbell Bench Press",
        primaryMuscles: ["chest"],
        default_sets: 3,
        default_reps: 10,
      },
      { id: 73, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Push Workout",
      summary: "Current draft",
      payload: {
        name: "Push Workout",
        exercises: [
          {
            exerciseId: 71,
            name: "Barbell Bench Press",
            sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }],
          },
          {
            exerciseId: 72,
            name: "Dumbbell Bench Press",
            sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
          },
          { exerciseId: 73, name: "Back Squat", sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "take out bench",
      responseMode: "workout",
      draftEditConfig: {
        currentDraft,
      },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "barbell,dumbbell",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(result.debug?.stamp).toMatchObject({
      requestType: "edit",
      modeReason: "EDIT_INTENT_DETECTED",
      hasDraft: true,
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      fallbackOpsCount: 1,
      applied: false,
      applyReason: "APPLY_SKIPPED",
    });
    expect(result.assistant).toContain("matches multiple options");
    expect(result.assistant).toContain("Barbell Bench Press");
    expect(result.assistant).toContain("Dumbbell Bench Press");
  });

  it("applies add-named fallback for add-in phrasing with runtime-shaped response", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 21, name: "Push Up", primaryMuscles: ["chest"] },
      { exerciseId: 22, name: "Incline Push Up", primaryMuscles: ["chest"] },
      { exerciseId: 23, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 21, name: "Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
      { id: 22, name: "Incline Push Up", primaryMuscles: ["chest"], default_sets: 3, default_reps: 12 },
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
      title: "Leg Workout",
      summary: "Current draft",
      payload: {
        name: "Leg Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add in 2 pushup exercise",
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
    expect(result.debug?.stamp).toMatchObject({
      requestType: "edit",
      hasOps: false,
      opsCount: 0,
      hasDraft: true,
      draftCount: 4,
      applied: true,
      applyReason: "APPLIED",
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
    expect(result.debug?.stamp).toMatchObject({
      modeChosen: "edit",
      modeReason: "ACTIVE_DRAFT_EDIT_MODE",
      candidateCount: 4,
    });
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(
      /do you want chest, shoulders, or triceps exercises/
    );
  });

  it("applies a clarified push follow-up to the same draft using recent add count", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 12, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 31, name: "Incline Dumbbell Press", primaryMuscles: ["chest"] },
      { exerciseId: 32, name: "Seated Dumbbell Shoulder Press", primaryMuscles: ["shoulders"] },
      { exerciseId: 33, name: "Triceps Pushdown", primaryMuscles: ["triceps"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 12, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      {
        id: 31,
        name: "Incline Dumbbell Press",
        primaryMuscles: ["chest"],
        default_sets: 3,
        default_reps: 10,
      },
      {
        id: 32,
        name: "Seated Dumbbell Shoulder Press",
        primaryMuscles: ["shoulders"],
        default_sets: 3,
        default_reps: 10,
      },
      {
        id: 33,
        name: "Triceps Pushdown",
        primaryMuscles: ["triceps"],
        default_sets: 3,
        default_reps: 12,
      },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Got it.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Leg Workout",
      summary: "Current draft",
      payload: {
        name: "Leg Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [
        { role: "user", content: "add 2 push exercises to it" },
        {
          role: "assistant",
          content: "Do you want chest, shoulders, or triceps exercises added to this workout?",
        },
      ],
      userMessage: "I meant chest push exercises",
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
    expect(updatedExercises.slice(-2).map((entry) => entry.exerciseId)).toEqual([31, 32]);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.debug?.stamp).toMatchObject({
      modeChosen: "edit",
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_EDIT_FALLBACK_OPS",
      opsProduced: 1,
    });
  });

  it("keeps edit requests safe when candidate pool is empty and avoids alphabetical fallback", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 1, name: "90/90 Breathing", default_sets: 3, default_reps: 8 },
      { id: 2, name: "Ab Adductor Machine", default_sets: 3, default_reps: 12 },
      { id: 3, name: "Sit-Up", default_sets: 3, default_reps: 12 },
      { id: 4, name: "Bench Press", default_sets: 3, default_reps: 8 },
      { id: 5, name: "Dumbbell Shoulder Press", default_sets: 3, default_reps: 10 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Leg Workout",
      summary: "Current draft",
      payload: {
        name: "Leg Workout",
        exercises: [
          { exerciseId: 10, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "add 2 push exercises to it",
      responseMode: "workout",
      draftEditConfig: {
        mode: "edit",
        currentDraft,
      },
      contextConfig: {
        enabled: false,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: false,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: [],
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(result.debug?.stamp).toMatchObject({
      modeChosen: "edit",
      candidateCount: 0,
    });
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(
      /do you want chest, shoulders, or triceps exercises/
    );
    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      10,
      12,
    ]);
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

  it("applies deterministic dumbbell-only conversion when edit ops are missing", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 101, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 102, name: "Barbell Row", primaryMuscles: ["back"] },
      { exerciseId: 201, name: "Dumbbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 202, name: "Dumbbell Row", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      {
        id: 101,
        name: "Barbell Bench Press",
        primaryMuscles: ["chest"],
        requiredEquipmentIds: ["barbell", "bench"],
      },
      {
        id: 102,
        name: "Barbell Row",
        primaryMuscles: ["back"],
        requiredEquipmentIds: ["barbell"],
      },
      {
        id: 201,
        name: "Dumbbell Bench Press",
        primaryMuscles: ["chest"],
        requiredEquipmentIds: ["dumbbell", "bench"],
      },
      {
        id: 202,
        name: "Dumbbell Row",
        primaryMuscles: ["back"],
        requiredEquipmentIds: ["dumbbell"],
      },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Push Pull",
      summary: "Current draft",
      payload: {
        name: "Push Pull",
        exercises: [
          { exerciseId: 101, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 102, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "only do it with dumbbell exercises",
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
          equipmentSummary: "dumbbell,bench",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      201,
      202,
    ]);
    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.sets)).toEqual(
      currentDraft.payload.exercises.map((entry) => entry.sets)
    );
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.debug?.stamp).toMatchObject({
      requestType: "edit",
      hasOps: false,
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_CONSTRAINT_CONVERSION",
      applyReason: "CONSTRAINT_APPLIED",
    });
  });

  it("applies deterministic no-barbell conversion", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 101, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 201, name: "Dumbbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 301, name: "Push Up", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 101, name: "Barbell Bench Press", primaryMuscles: ["chest"], requiredEquipmentIds: ["barbell"] },
      { id: 201, name: "Dumbbell Bench Press", primaryMuscles: ["chest"], requiredEquipmentIds: ["dumbbell"] },
      { id: 301, name: "Push Up", primaryMuscles: ["chest"], requiredEquipmentIds: ["bodyweight"] },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Push",
      summary: "Current draft",
      payload: {
        name: "Push",
        exercises: [{ exerciseId: 101, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "no barbell exercises",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
      contextConfig: {
        enabled: true,
        scopes: { spaces: true },
        activeGymId: 1,
        contextState: {
          contextEnabled: true,
          selectedGym: { id: 1, name: "Condo" },
          equipmentSummary: "dumbbell,bodyweight",
        },
      },
      memoryEnabled: false,
      memorySummary: null,
    });

    expect(result.actionDraft?.payload?.exercises?.[0]?.exerciseId).toBe(201);
    expect(result.debug?.stamp?.applyReason).toBe("CONSTRAINT_APPLIED");
  });

  it("applies deterministic bodyweight-only conversion", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 401, name: "Dumbbell Squat", primaryMuscles: ["quads"] },
      { exerciseId: 402, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 501, name: "Air Squat", primaryMuscles: ["quads"] },
      { exerciseId: 502, name: "Push Up", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 401, name: "Dumbbell Squat", primaryMuscles: ["quads"], requiredEquipmentIds: ["dumbbell"] },
      { id: 402, name: "Barbell Bench Press", primaryMuscles: ["chest"], requiredEquipmentIds: ["barbell"] },
      { id: 501, name: "Air Squat", primaryMuscles: ["quads"], requiredEquipmentIds: ["bodyweight"] },
      { id: 502, name: "Push Up", primaryMuscles: ["chest"], requiredEquipmentIds: ["bodyweight"] },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Mixed",
      summary: "Current draft",
      payload: {
        name: "Mixed",
        exercises: [
          { exerciseId: 401, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] },
          { exerciseId: 402, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "bodyweight only",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      501,
      502,
    ]);
    expect(result.debug?.stamp?.applyReason).toBe("CONSTRAINT_APPLIED");
  });

  it("fails atomically when deterministic constraint mapping cannot be completed", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 601, name: "Barbell Curl", primaryMuscles: ["biceps"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 601, name: "Barbell Curl", primaryMuscles: ["biceps"], requiredEquipmentIds: ["barbell"] },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_workout",
      confidence: 0.9,
      risk: "low",
      title: "Arms",
      summary: "Current draft",
      payload: {
        name: "Arms",
        exercises: [{ exerciseId: 601, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "only do it with dumbbell exercises",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(result.actionDraft).toEqual(currentDraft);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "DETERMINISTIC_CONSTRAINT_CONVERSION",
      applyReason: "CONSTRAINT_ATOMIC_FAIL",
    });
    expect(String(result.assistant ?? "").toLowerCase()).toMatch(/couldn'?t safely apply/);
  });

  it("retries strict edit schema once and applies valid edit ops", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 12, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 12, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });
    mocks.createChatCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Updated.","actionDraft":{"kind":"create_workout","confidence":0.8,"risk":"low","title":"Workout","summary":"Updated","payload":{"name":"Workout","exercises":[{"exerciseId":10,"sets":[{"reps":5}]}]}}}
\`\`\``,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `{"contractVersion":"coach_action_v1","assistantText":"Removed pull up.","editDraft":{"mode":"EDIT","ops":[{"op":"remove_exercise","exerciseId":12}]}}`,
            },
          },
        ],
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
          { exerciseId: 11, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change this workout",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.debug?.editResolution?.status).toBe("applied");
    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      10,
      11,
    ]);
    expect(result.debug?.stamp).toMatchObject({
      schemaUsed: "coach_edit_ops_v1",
      retryCount: 1,
      applyReason: "APPLIED",
    });
    expect(String(result.debug?.stamp?.finalOutcomeReason ?? "")).toContain("SCHEMA_RETRY_APPLIED");
    expect(result.debug?.stamp?.fallbackReason).not.toBe("REGENERATE_FULL_DRAFT");
  });

  it("returns clarification without regeneration when strict edit schema retry still fails", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 12, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 12, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your workout.",
      toolCalls: [],
    });
    mocks.createChatCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `{"contractVersion":"coach_action_v1","assistantText":"Updated.","actionDraft":{"kind":"create_workout"}}`,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `{"assistantText":"Updated.","editDraft":{"mode":"AUTO","ops":[]}}`,
            },
          },
        ],
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
          { exerciseId: 11, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "change this workout",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.actionDraft).toEqual(currentDraft);
    expect(String(result.assistant ?? "")).toMatch(/couldn't parse a safe edit operation/i);
    expect(result.debug?.editResolution?.status).toBe("failed");
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "EDIT_SCHEMA_RETRY_FAILED",
      applyReason: "EDIT_SCHEMA_CLARIFICATION_REQUIRED",
      schemaUsed: "coach_edit_ops_v1",
      retryCount: 1,
      opsProduced: 0,
    });
    expect(result.debug?.stamp?.fallbackReason).not.toBe("REGENERATE_FULL_DRAFT");
  });

  it("uses regenerate-full-draft fallback when provided edit ops cannot be applied", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 12, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 12, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Updated your workout.","editDraft":{"mode":"EDIT","ops":[{"op":"unsupported_edit"}]}}
\`\`\``,
      toolCalls: [],
    });
    mocks.createChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Shortened it.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Short Draft","summary":"Shorter workout","payload":{"name":"Short Draft","exercises":[{"exerciseId":10,"sets":[{"reps":5},{"reps":5},{"reps":5}]},{"exerciseId":11,"sets":[{"reps":8},{"reps":8},{"reps":8}]}]}}}
\`\`\``,
          },
        },
      ],
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
          { exerciseId: 11, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "shorter please",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      10,
      11,
    ]);
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "REGENERATE_FULL_DRAFT",
      applyReason: "REGENERATE_FULL_DRAFT_APPLIED",
    });
  });

  it("wraps plain regenerated draft JSON into an action draft and applies it", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 12, name: "Pull Up", primaryMuscles: ["back"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
      { id: 12, name: "Pull Up", primaryMuscles: ["back"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Updated your workout.","editDraft":{"mode":"EDIT","ops":[{"op":"unsupported_edit"}]}}
\`\`\``,
      toolCalls: [],
    });
    mocks.createChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{"name":"Short Draft","gymId":1,"exercises":[{"exerciseId":10,"sets":[{"reps":5},{"reps":5},{"reps":5}]},{"exerciseId":11,"sets":[{"reps":8},{"reps":8},{"reps":8}]}]}
\`\`\``,
          },
        },
      ],
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
          { exerciseId: 11, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
          { exerciseId: 12, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "shorter please",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.actionDraft?.payload?.name).toBe("Short Draft");
    expect(result.actionDraft?.payload?.exercises?.map((entry) => entry.exerciseId)).toEqual([
      10,
      11,
    ]);
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "REGENERATE_FULL_DRAFT_WRAPPED_PLAIN_DRAFT",
      applyReason: "REGENERATE_FULL_DRAFT_APPLIED",
    });
    expect(result.debug?.stamp?.validationErrors).toBeNull();
  });

  it("keeps the original draft when regenerated fallback returns invalid exercise ids", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 10, name: "Back Squat", primaryMuscles: ["quads"] },
      { exerciseId: 11, name: "Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 10, name: "Back Squat", primaryMuscles: ["quads"], default_sets: 3, default_reps: 5 },
      { id: 11, name: "Bench Press", primaryMuscles: ["chest"], default_sets: 3, default_reps: 8 },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Updated your workout.","editDraft":{"mode":"EDIT","ops":[{"op":"unsupported_edit"}]}}
\`\`\``,
      toolCalls: [],
    });
    mocks.createChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{"contractVersion":"coach_action_v1","assistantText":"Shortened it.","actionDraft":{"kind":"create_workout","confidence":0.9,"risk":"low","title":"Short Draft","summary":"Shorter workout","payload":{"name":"Short Draft","exercises":[{"exerciseId":999,"sets":[{"reps":5},{"reps":5},{"reps":5}]}]}}}
\`\`\``,
          },
        },
      ],
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
          { exerciseId: 11, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
        ],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "shorter please",
      responseMode: "workout",
      draftEditConfig: { mode: "edit", currentDraft },
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
    expect(result.debug?.stamp).toMatchObject({
      fallbackUsed: true,
      fallbackReason: "REGENERATE_FULL_DRAFT",
      applyReason: "REGENERATE_FULL_DRAFT_FAILED",
    });
  });

  it("supports deterministic constraint edits for template drafts", async () => {
    mocks.getCoachExerciseCandidates.mockResolvedValue([
      { exerciseId: 101, name: "Barbell Bench Press", primaryMuscles: ["chest"] },
      { exerciseId: 201, name: "Dumbbell Bench Press", primaryMuscles: ["chest"] },
    ]);
    mocks.getAllExercises.mockResolvedValue([
      { id: 101, name: "Barbell Bench Press", primaryMuscles: ["chest"], requiredEquipmentIds: ["barbell"] },
      { id: 201, name: "Dumbbell Bench Press", primaryMuscles: ["chest"], requiredEquipmentIds: ["dumbbell"] },
    ]);
    mocks.streamChatCompletion.mockResolvedValue({
      content: "Updated your template.",
      toolCalls: [],
    });

    const currentDraft = {
      kind: "create_template",
      confidence: 0.9,
      risk: "low",
      title: "Push Template",
      summary: "Current draft",
      payload: {
        name: "Push Template",
        exercises: [{ exerciseId: 101, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] }],
      },
    };

    const result = await runCoachTurn({
      apiKey: "test-key",
      chatHistory: [],
      userMessage: "only dumbbells",
      responseMode: "general",
      draftEditConfig: { mode: "edit", currentDraft },
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

    expect(result.actionDraft?.kind).toBe("create_template");
    expect(result.actionDraft?.payload?.exercises?.[0]?.exerciseId).toBe(201);
    expect(result.debug?.stamp?.requestType).toBe("edit");
    expect(result.debug?.stamp?.applyReason).toBe("CONSTRAINT_APPLIED");
  });
});
