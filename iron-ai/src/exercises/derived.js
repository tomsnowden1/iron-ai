import { db, listFinishedWorkouts } from "../db";
import { getEquipmentMap } from "../equipment/catalog";
import { getMissingEquipmentForExercise } from "../equipment/engine";

export function parseMetric(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

export function computeSetVolume(weight, reps) {
  const parsedWeight = parseMetric(weight);
  const parsedReps = parseMetric(reps);
  if (parsedWeight != null && parsedReps != null) return parsedWeight * parsedReps;
  if (parsedWeight == null && parsedReps != null) return parsedReps;
  return 0;
}

export function estimateOneRepMax(weight, reps) {
  const parsedWeight = parseMetric(weight);
  const parsedReps = parseMetric(reps);
  if (parsedWeight == null || parsedReps == null) return null;
  if (parsedWeight <= 0 || parsedReps <= 0) return null;
  return parsedWeight * (1 + parsedReps / 30);
}

export async function getExerciseUsageStats() {
  const finished = await listFinishedWorkouts();
  if (!finished.length) return [];
  const workoutIds = finished.map((workout) => workout.id).filter((id) => id != null);
  if (!workoutIds.length) return [];

  const items = await db
    .table("workoutItems")
    .where("workoutId")
    .anyOf(workoutIds)
    .toArray();
  if (!items.length) return [];

  const workoutDates = new Map(
    finished.map((workout) => [
      workout.id,
      workout.finishedAt ?? workout.startedAt ?? null,
    ])
  );

  const stats = new Map();
  items.forEach((item) => {
    const exerciseId = item?.exerciseId;
    if (exerciseId == null) return;
    const entry = stats.get(exerciseId) ?? {
      exerciseId,
      count: 0,
      lastPerformed: null,
    };
    entry.count += 1;
    const performedAt = workoutDates.get(item.workoutId);
    if (performedAt) {
      if (!entry.lastPerformed || String(performedAt) > String(entry.lastPerformed)) {
        entry.lastPerformed = performedAt;
      }
    }
    stats.set(exerciseId, entry);
  });

  return Array.from(stats.values());
}

export async function getExerciseHistory(exerciseId, options = {}) {
  const parsedId = Number(exerciseId);
  if (!parsedId || Number.isNaN(parsedId)) return [];

  const finished = await listFinishedWorkouts();
  if (!finished.length) return [];
  const finishedIds = new Set(finished.map((workout) => workout.id));
  const workoutDates = new Map(
    finished.map((workout) => [
      workout.id,
      workout.finishedAt ?? workout.startedAt ?? null,
    ])
  );

  const items = await db.table("workoutItems").where({ exerciseId: parsedId }).toArray();
  if (!items.length) return [];

  const grouped = new Map();
  for (const item of items) {
    if (!finishedIds.has(item.workoutId)) continue;
    const sets = await db.table("workoutSets").where({ workoutItemId: item.id }).toArray();
    const entry = grouped.get(item.workoutId) ?? {
      workoutId: item.workoutId,
      date: workoutDates.get(item.workoutId) ?? null,
      sets: [],
    };
    entry.sets.push(...sets);
    grouped.set(item.workoutId, entry);
  }

  const sessions = Array.from(grouped.values()).map((entry) => {
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    let maxWeight = null;
    let maxReps = null;
    let bestSet = null;
    let maxOneRm = null;

    const volume = sets.reduce((sum, set) => sum + computeSetVolume(set.weight, set.reps), 0);

    sets.forEach((set) => {
      const weight = parseMetric(set.weight);
      const reps = parseMetric(set.reps);
      if (weight != null) {
        if (maxWeight == null || weight > maxWeight) {
          maxWeight = weight;
          bestSet = { weight, reps: reps ?? null };
        } else if (weight === maxWeight && reps != null) {
          const bestReps = bestSet?.reps ?? 0;
          if (reps > bestReps) {
            bestSet = { weight, reps };
          }
        }
      } else if (reps != null && maxWeight == null) {
        if (maxReps == null || reps > maxReps) {
          maxReps = reps;
          bestSet = { weight: null, reps };
        }
      }

      const oneRm = estimateOneRepMax(weight, reps);
      if (oneRm != null && (maxOneRm == null || oneRm > maxOneRm)) {
        maxOneRm = oneRm;
      }
    });

    return {
      ...entry,
      sets,
      volume,
      maxWeight,
      maxReps,
      bestSet,
      oneRm: maxOneRm,
    };
  });

  sessions.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const limit = options.limit;
  if (limit == null) return sessions;
  return sessions.slice(0, Math.max(0, limit));
}

export function getGymAvailabilityForExercise(
  exercise,
  spaces,
  equipmentList
) {
  const resolvedSpaces = Array.isArray(spaces) ? spaces : [];
  const equipmentMap = equipmentList instanceof Map ? equipmentList : getEquipmentMap(equipmentList ?? []);

  return resolvedSpaces.map((space) => {
    const missing = getMissingEquipmentForExercise(
      exercise,
      space?.equipmentIds ?? [],
      equipmentMap
    );
    return {
      space,
      missingEquipment: missing,
      isAvailable: missing.length === 0,
    };
  });
}
