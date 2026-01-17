import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addExerciseToWorkout,
  createEmptyWorkout,
  createTemplate,
  db,
  getAllExercises,
} from "../src/db.js";
import { getCoachContextSnapshot } from "../src/coach/context.js";
import { coachReducer, initialCoachState } from "../src/coach/state.js";
import { executeTool, getToolRegistry, validateToolInput } from "../src/coach/tools.js";
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
});
