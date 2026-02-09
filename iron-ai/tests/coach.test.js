import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addExerciseToWorkout,
  createEmptyWorkout,
  createTemplate,
  createWorkoutSpace,
  db,
  getAllExercises,
  listEquipment,
} from "../src/db.js";
import { getCoachContextSnapshot, getCoachExerciseCandidates } from "../src/coach/context.js";
import { coachReducer, initialCoachState } from "../src/coach/state.js";
import { executeTool, getToolRegistry, validateToolInput } from "../src/coach/tools.js";
import { normalizeGymName } from "../src/workoutSpaces/logic.js";
import { seedTestExercises } from "./seedTestData.js";

describe.sequential("coach platform", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedTestExercises();
  });

  afterAll(async () => {
    await db.delete();
    db.close();
  });

  it("builds a bounded context snapshot with stable ordering", async () => {
    const exercises = await getAllExercises();
    const exercise = exercises[0];

    const firstId = await createEmptyWorkout();
    await addExerciseToWorkout(firstId, exercise.id);
    await db.table("workoutSessions").update(firstId, {
      startedAt: "2024-01-01T08:00:00.000Z",
      finishedAt: "2024-01-01T08:30:00.000Z",
    });
    await db.table("workouts").update(firstId, {
      startedAt: "2024-01-01T08:00:00.000Z",
      finishedAt: "2024-01-01T08:30:00.000Z",
    });

    const secondId = await createEmptyWorkout();
    await addExerciseToWorkout(secondId, exercise.id);
    await db.table("workoutSessions").update(secondId, {
      startedAt: "2024-02-01T08:00:00.000Z",
      finishedAt: "2024-02-01T08:45:00.000Z",
    });
    await db.table("workouts").update(secondId, {
      startedAt: "2024-02-01T08:00:00.000Z",
      finishedAt: "2024-02-01T08:45:00.000Z",
    });

    await createTemplate({ name: "Test Template" });

    const { snapshot, meta } = await getCoachContextSnapshot({
      scopes: {
        sessions: true,
        templates: true,
        exerciseHistory: true,
        notes: true,
        settings: true,
      },
      sessionLimit: 5,
      templateLimit: 10,
      maxBytes: 200,
    });

    expect(snapshot.sessions[0].startedAt).toBe("2024-02-01T08:00:00.000Z");
    expect(meta.truncated).toBe(true);
  });

  it("validates tool inputs", () => {
    const registry = getToolRegistry();
    const tool = registry.get("get_session_detail");
    const result = validateToolInput(tool, { sessionId: "bad" });
    expect(result.valid).toBe(false);
  });

  it("returns template summaries from read tools", async () => {
    await createTemplate({ name: "Push Day" });
    const response = await executeTool("get_templates", { limit: 5 });
    expect(response.templates?.length).toBeGreaterThan(0);
    expect(response.templates[0].name).toBe("Push Day");
  });

  it("updates proposal status in reducer", () => {
    const queued = coachReducer(initialCoachState, {
      type: "QUEUE_PROPOSALS",
      payload: [{ id: "1", summary: "Create template", status: "pending" }],
    });
    const confirmed = coachReducer(queued, {
      type: "UPDATE_PROPOSAL_STATUS",
      payload: { id: "1", status: "confirmed" },
    });
    expect(confirmed.proposals[0].status).toBe("confirmed");
  });

  it("includes active gym equipment in context snapshot", async () => {
    const equipment = await listEquipment();
    const selectable = equipment.filter((item) => item.id !== "bodyweight").slice(0, 2);
    const equipmentIds = selectable.map((item) => item.id);
    const spaceId = await createWorkoutSpace({ name: "Condo", equipmentIds });

    const { snapshot } = await getCoachContextSnapshot({
      scopes: { spaces: true },
      activeGymId: spaceId,
    });

    expect(snapshot.activeGymId).toBe(spaceId);
    expect(snapshot.activeGymName).toBe("Condo");
    expect(snapshot.equipmentCount).toBe(equipmentIds.length);
    expect(snapshot.equipment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: equipmentIds[0], name: expect.any(String) }),
      ])
    );
  });

  it("filters coach candidates by selected gym equipment even when context is off", async () => {
    const now = Date.now();
    await db.table("exercises").bulkAdd([
      {
        name: "Close-Grip Front Lat Pulldown",
        slug: "close-grip-front-lat-pulldown",
        default_sets: 3,
        default_reps: 10,
        muscle_group: "back",
        is_custom: false,
        status: "extended",
        aliases: ["lat pulldown"],
        primaryMuscles: ["back"],
        secondaryMuscles: ["biceps"],
        equipment: ["lat_pulldown_machine"],
        requiredEquipmentIds: ["lat_pulldown_machine"],
        optionalEquipmentIds: [],
        source: "test",
        stableId: "lat-pulldown-test",
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Inverted Row",
        slug: "inverted-row",
        default_sets: 3,
        default_reps: 10,
        muscle_group: "back",
        is_custom: false,
        status: "extended",
        aliases: ["bodyweight row"],
        primaryMuscles: ["back"],
        secondaryMuscles: ["biceps"],
        equipment: ["bodyweight"],
        requiredEquipmentIds: ["bodyweight"],
        optionalEquipmentIds: [],
        source: "test",
        stableId: "inverted-row-test",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const spaceId = await createWorkoutSpace({
      name: "Condo",
      equipmentIds: ["dumbbell", "bench"],
    });

    const candidates = await getCoachExerciseCandidates({
      activeGymId: spaceId,
      contextEnabled: false,
      userMessage: "make me a pull workout",
      maxCandidates: 20,
    });

    expect(
      candidates.some((entry) => /lat pulldown/i.test(String(entry?.name ?? "")))
    ).toBe(false);
    expect(
      candidates.some((entry) => /inverted row/i.test(String(entry?.name ?? "")))
    ).toBe(true);
  });

  it("normalizes gym names for matching", () => {
    expect(normalizeGymName("Condo")).toBe(normalizeGymName(" condo  "));
  });

  it("reuses existing gym by normalized name in create_workout_space", async () => {
    const equipment = await listEquipment();
    const selectable = equipment.filter((item) => item.id !== "bodyweight").slice(0, 1);
    const equipmentIds = selectable.map((item) => item.id);
    const spaceId = await createWorkoutSpace({ name: "Condo", equipmentIds });

    const result = await executeTool("create_workout_space", { name: " condo " });
    expect(result.spaceId).toBe(spaceId);
    expect(result.reused).toBe(true);
    expect(result.match).toBe("name");
  });
});
