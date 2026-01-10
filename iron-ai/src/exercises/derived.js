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

function isMatchingExerciseName(exercise, key) {
  if (!key) return false;
  return String(exercise?.name ?? "").trim().toLowerCase() === key;
}

async function resolveExerciseId(exerciseKey) {
  if (exerciseKey == null || exerciseKey === "") return null;
  const numericId = Number(exerciseKey);
  if (!Number.isNaN(numericId) && numericId > 0) return numericId;
  if (typeof exerciseKey !== "string") return null;
  const normalized = exerciseKey.trim().toLowerCase();
  if (!normalized) return null;
  const matches = await db
    .table("exercises")
    .filter((exercise) => isMatchingExerciseName(exercise, normalized))
    .toArray();
  if (!matches.length) return null;
  return matches[0].id ?? null;
}

export async function getExerciseHistory(exerciseKey, options = {}) {
  const parsedId = await resolveExerciseId(exerciseKey);
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

export function computeBestSet(history) {
  const sessions = Array.isArray(history) ? history : [];
  let best = null;

  sessions.forEach((session) => {
    const sets = Array.isArray(session.sets) ? session.sets : [];
    sets.forEach((set) => {
      const weight = parseMetric(set.weight);
      const reps = parseMetric(set.reps);
      if (weight == null && reps == null) return;
      if (!best) {
        best = { weight, reps, date: session.date ?? null };
        return;
      }
      const bestWeight = best.weight ?? null;
      if (weight != null) {
        if (bestWeight == null || weight > bestWeight) {
          best = { weight, reps, date: session.date ?? null };
          return;
        }
        if (weight === bestWeight) {
          const bestReps = best.reps ?? -1;
          const currentReps = reps ?? -1;
          if (currentReps > bestReps) {
            best = { weight, reps, date: session.date ?? null };
          }
          return;
        }
      }
      if (weight == null && bestWeight == null) {
        const bestReps = best.reps ?? -1;
        const currentReps = reps ?? -1;
        if (currentReps > bestReps) {
          best = { weight: null, reps, date: session.date ?? null };
        }
      }
    });
  });

  return best;
}

export function computeTrendPoints(history, options = {}) {
  const sessions = Array.isArray(history) ? history.slice() : [];
  const limit = options.limit ?? 8;
  const ordered = sessions.slice().reverse();
  const sliced = limit ? ordered.slice(-limit) : ordered;
  return sliced.map((session) => {
    const volume = Number(session.volume ?? 0);
    if (volume > 0) return volume;
    if (session.maxWeight != null) return Number(session.maxWeight);
    if (session.maxReps != null) return Number(session.maxReps);
    return 0;
  });
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
