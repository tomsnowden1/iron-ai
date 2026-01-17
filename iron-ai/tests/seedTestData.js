import { db } from "../src/db.js";

export async function seedTestExercises() {
  const count = await db.table("exercises").count();
  if (count > 0) return;
  const now = Date.now();
  await db.table("exercises").add({
    name: "Test Exercise",
    slug: "test-exercise",
    default_sets: 3,
    default_reps: 8,
    muscle_group: "test",
    is_custom: false,
    status: "extended",
    aliases: [],
    primaryMuscles: ["test"],
    secondaryMuscles: [],
    equipment: ["bodyweight"],
    source: "starter",
    stableId: "test-exercise-1",
    createdAt: now,
    updatedAt: now,
  });
}
