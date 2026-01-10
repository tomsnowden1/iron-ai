import { db } from "../db";
import { normalizeFreeExerciseRecord } from "./normalizeFreeExerciseDb";

export const EXERCISE_SEED_VERSION = "2026-01-10-free-exercise-db-v1";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasArrayValues(value) {
  return Array.isArray(value) && value.length > 0;
}

function mergeExercise(existing, seed, now) {
  const merged = { ...existing };

  if (!isNonEmptyString(existing.name)) {
    merged.name = seed.name;
  }
  if (!isNonEmptyString(existing.slug)) {
    merged.slug = seed.slug;
  }
  if (!isNonEmptyString(existing.source)) {
    merged.source = seed.source;
  }

  if (!isNonEmptyString(existing.status)) {
    merged.status = seed.status;
  }
  if (!hasArrayValues(existing.gotchas)) {
    merged.gotchas = seed.gotchas;
  }
  if (!hasArrayValues(existing.instructions)) {
    merged.instructions = seed.instructions;
  }
  if (!isNonEmptyString(existing.youtubeVideoId) && seed.youtubeVideoId) {
    merged.youtubeVideoId = seed.youtubeVideoId;
  }

  if (!hasArrayValues(existing.primaryMuscles)) {
    merged.primaryMuscles = seed.primaryMuscles;
  }
  if (!hasArrayValues(existing.secondaryMuscles)) {
    merged.secondaryMuscles = seed.secondaryMuscles;
  }
  if (!hasArrayValues(existing.equipment)) {
    merged.equipment = seed.equipment;
  }
  if (!hasArrayValues(existing.aliases)) {
    merged.aliases = seed.aliases;
  }
  if (!isNonEmptyString(existing.category)) {
    merged.category = seed.category;
  }
  if (!isNonEmptyString(existing.pattern)) {
    merged.pattern = seed.pattern;
  }
  if (!isNonEmptyString(existing.youtubeSearchQuery)) {
    merged.youtubeSearchQuery = seed.youtubeSearchQuery;
  }

  merged.updatedAt = now;
  merged.createdAt = existing.createdAt ?? seed.createdAt ?? now;

  return merged;
}

export async function resetExerciseSeedVersion() {
  await db.table("meta").delete("exerciseSeedVersion");
}

export async function seedExercisesIfNeeded() {
  const existingSeed = await db.table("meta").get("exerciseSeedVersion");
  if (existingSeed?.value === EXERCISE_SEED_VERSION) {
    return { status: "skipped" };
  }

  let response;
  try {
    response = await fetch("/seed/exercises.json");
  } catch (error) {
    console.error("Failed to fetch exercise seed:", error);
    return { status: "error", error };
  }

  if (!response.ok) {
    console.error(
      `Failed to fetch exercise seed: ${response.status} ${response.statusText}`
    );
    return { status: "error" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.error("Failed to parse exercise seed JSON:", error);
    return { status: "error", error };
  }

  if (!Array.isArray(payload)) {
    console.error("Exercise seed JSON must be an array.");
    return { status: "error" };
  }
  if (payload.length < 300) {
    console.error(
      `Exercise seed must include at least 300 records (found ${payload.length}).`
    );
    return { status: "error" };
  }

  const now = Date.now();
  const normalized = payload.map((record) => normalizeFreeExerciseRecord(record, now));
  const slugs = normalized.map((item) => item.slug).filter(Boolean);

  await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
    const existingExercises = slugs.length
      ? await db.table("exercises").where("slug").anyOf(slugs).toArray()
      : [];
    const bySlug = new Map(existingExercises.map((exercise) => [exercise.slug, exercise]));

    const merged = normalized.map((seed) => {
      const existing = bySlug.get(seed.slug);
      if (!existing) return seed;
      return mergeExercise(existing, seed, now);
    });

    await db.table("exercises").bulkPut(merged);
    await db
      .table("meta")
      .put({ key: "exerciseSeedVersion", value: EXERCISE_SEED_VERSION });
  });

  return { status: "seeded", count: normalized.length };
}
