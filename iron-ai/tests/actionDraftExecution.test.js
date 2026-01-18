import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, getAllExercises } from "../src/db.js";
import {
  createGymFromDraft,
  createTemplateFromDraft,
  createWorkoutFromDraft,
  validateActionDraft,
} from "../src/coach/actionDraftExecution.js";
import { ActionDraftKinds } from "../src/coach/actionDraftContract.js";
import { seedTestExercises } from "./seedTestData.js";

function baseDraft(kind, payload) {
  return {
    kind,
    confidence: 0.8,
    risk: "low",
    title: "Coach draft",
    summary: "Draft summary.",
    payload,
  };
}

describe.sequential("action draft execution", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedTestExercises();
  });

  afterAll(async () => {
    await db.delete();
    db.close();
  });

  it("validates and creates a workout from a draft", async () => {
    const exercises = await getAllExercises();
    const exerciseId = exercises[0]?.id;
    const draft = baseDraft(ActionDraftKinds.create_workout, {
      name: "Leg day",
      exercises: [
        {
          exerciseId,
          sets: [{ reps: 8, weight: 135 }],
        },
      ],
    });
    const validation = await validateActionDraft(draft);
    expect(validation.valid).toBe(true);
    const workoutId = await createWorkoutFromDraft(validation.normalizedDraft);

    const session = await db.table("workoutSessions").get(workoutId);
    const items = await db.table("workoutItems").where({ workoutId }).toArray();
    const sets = await db
      .table("workoutSets")
      .where({ workoutItemId: items[0]?.id })
      .toArray();

    expect(session?.id).toBe(workoutId);
    expect(items.length).toBe(1);
    expect(sets.length).toBe(1);
    expect(sets[0]?.reps).toBe("8");
    expect(sets[0]?.weight).toBe("135");
  });

  it("validates and creates a template from a draft", async () => {
    const exercises = await getAllExercises();
    const exerciseId = exercises[0]?.id;
    const draft = baseDraft(ActionDraftKinds.create_template, {
      name: "Push day",
      exercises: [
        {
          exerciseId,
          sets: [{ reps: 10 }],
        },
      ],
    });
    const validation = await validateActionDraft(draft);
    expect(validation.valid).toBe(true);
    const templateId = await createTemplateFromDraft(validation.normalizedDraft);

    const template = await db.table("templates").get(templateId);
    const items = await db.table("templateItems").where({ templateId }).toArray();

    expect(template?.id).toBe(templateId);
    expect(template?.name).toBe("Push day");
    expect(items.length).toBe(1);
    expect(items[0]?.targetSets).toBe(1);
    expect(items[0]?.targetReps).toBe(10);
  });

  it("detects duplicate gyms and creates with a suffix", async () => {
    const draft = baseDraft(ActionDraftKinds.create_gym, {
      name: "Default Gym",
    });
    const validation = await validateActionDraft(draft);
    expect(validation.valid).toBe(true);
    expect(validation.warnings?.length ?? 0).toBeGreaterThan(0);

    const gymId = await createGymFromDraft(validation.normalizedDraft);
    const gym = await db.table("workoutSpaces").get(gymId);

    expect(gym?.name).toMatch(/Default Gym \(\d+\)/);
  });

  it("fails validation for unknown exercise IDs", async () => {
    const draft = baseDraft(ActionDraftKinds.create_workout, {
      name: "Invalid exercise",
      exercises: [
        {
          exerciseId: 99999,
          sets: [{ reps: 8 }],
        },
      ],
    });
    const validation = await validateActionDraft(draft);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/Unknown exercise IDs/i);
  });
});
