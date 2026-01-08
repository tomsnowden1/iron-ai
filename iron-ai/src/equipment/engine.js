import { db, getAllExercises, getWorkoutSpaceById, listEquipment, listWorkoutSpaces } from "../db";
import { EQUIPMENT_CATALOG, EQUIPMENT_ID_SET, getEquipmentMap } from "./catalog";
import { inferExerciseEquipment } from "./inference";
import { resolveActiveSpace } from "../workoutSpaces/logic";

const EQUIPMENT_ORDER = new Map(EQUIPMENT_CATALOG.map((item, index) => [item.id, index]));

const EQUIPMENT_FALLBACKS = {
  trap_bar: ["barbell", "dumbbell", "bodyweight"],
  barbell: ["dumbbell", "bodyweight"],
  ez_bar: ["dumbbell", "bodyweight"],
  dumbbell: ["bodyweight"],
  cable_machine: ["dumbbell", "bodyweight"],
  lat_pulldown_machine: ["pullup_bar", "bodyweight"],
  leg_press_machine: ["bodyweight"],
  leg_extension_machine: ["bodyweight"],
  leg_curl_machine: ["bodyweight"],
  calf_raise_machine: ["bodyweight"],
  pullup_bar: ["bodyweight"],
  dip_station: ["bodyweight"],
  rower: ["treadmill", "bodyweight"],
  stationary_bike: ["treadmill", "bodyweight"],
  treadmill: ["bodyweight"],
};

function uniqueIds(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function sortEquipmentIds(ids) {
  return uniqueIds(ids).sort(
    (a, b) => (EQUIPMENT_ORDER.get(a) ?? 999) - (EQUIPMENT_ORDER.get(b) ?? 999)
  );
}

export function normalizeSpaceEquipmentIds(spaceEquipmentIds, equipmentIdSet = EQUIPMENT_ID_SET) {
  const base = Array.isArray(spaceEquipmentIds) ? spaceEquipmentIds : [];
  const withBodyweight = base.includes("bodyweight") ? base : [...base, "bodyweight"];
  return sortEquipmentIds(withBodyweight.filter((id) => equipmentIdSet.has(id)));
}

export function normalizeExerciseEquipment(exercise, equipmentIdSet = EQUIPMENT_ID_SET) {
  const hasRequired =
    Array.isArray(exercise?.requiredEquipmentIds) && exercise.requiredEquipmentIds.length > 0;
  const hasOptional = Array.isArray(exercise?.optionalEquipmentIds);
  const inferred = !hasRequired || !hasOptional ? inferExerciseEquipment(exercise) : null;

  const required = hasRequired ? exercise.requiredEquipmentIds : inferred?.requiredEquipmentIds ?? [];
  const optional = hasOptional ? exercise.optionalEquipmentIds : inferred?.optionalEquipmentIds ?? [];

  return {
    requiredEquipmentIds: sortEquipmentIds(required.filter((id) => equipmentIdSet.has(id))),
    optionalEquipmentIds: sortEquipmentIds(optional.filter((id) => equipmentIdSet.has(id))),
  };
}

export function getMissingEquipmentIdsForExercise(
  exercise,
  spaceEquipmentIds,
  equipmentIdSet = EQUIPMENT_ID_SET
) {
  const normalized = normalizeExerciseEquipment(exercise, equipmentIdSet);
  const spaceIds = normalizeSpaceEquipmentIds(spaceEquipmentIds, equipmentIdSet);
  return normalized.requiredEquipmentIds.filter((id) => !spaceIds.includes(id));
}

export function getMissingEquipmentForExercise(
  exercise,
  spaceEquipmentIds,
  equipmentMap = getEquipmentMap()
) {
  const missingIds = getMissingEquipmentIdsForExercise(
    exercise,
    spaceEquipmentIds,
    new Set(equipmentMap.keys())
  );
  return missingIds.map((id) => equipmentMap.get(id)).filter(Boolean);
}

export function isExerciseAvailableWithSpace(exercise, spaceEquipmentIds, equipmentIdSet) {
  const missing = getMissingEquipmentIdsForExercise(exercise, spaceEquipmentIds, equipmentIdSet);
  return missing.length === 0;
}

function getPrimaryEquipmentId(requiredEquipmentIds) {
  if (!requiredEquipmentIds?.length) return null;
  const nonBody = requiredEquipmentIds.find((id) => id !== "bodyweight");
  return nonBody ?? requiredEquipmentIds[0] ?? null;
}

export function getExerciseSubstitutionsForExercise(
  exercise,
  allExercises,
  spaceEquipmentIds,
  equipmentMap = getEquipmentMap()
) {
  const equipmentIdSet = new Set(equipmentMap.keys());
  const normalized = normalizeExerciseEquipment(exercise, equipmentIdSet);
  const primary = getPrimaryEquipmentId(normalized.requiredEquipmentIds);
  if (!primary) return [];

  const fallbackIds = EQUIPMENT_FALLBACKS[primary] ?? [];
  const spaceIds = normalizeSpaceEquipmentIds(spaceEquipmentIds, equipmentIdSet);
  const substitutions = [];

  const pushCandidate = (candidate, equipmentId) => {
    substitutions.push({
      exerciseId: candidate.id,
      name: candidate.name ?? "Unknown Exercise",
      equipmentId,
      reason: `Uses ${equipmentMap.get(equipmentId)?.name ?? equipmentId}`,
    });
  };

  for (const equipmentId of fallbackIds) {
    const matches = allExercises.filter((ex) => {
      if (ex.id === exercise.id) return false;
      const { requiredEquipmentIds } = normalizeExerciseEquipment(ex, equipmentIdSet);
      if (equipmentId === "bodyweight") {
        const isBodyweight =
          requiredEquipmentIds.length === 0 || requiredEquipmentIds.includes("bodyweight");
        if (!isBodyweight) return false;
      } else if (!requiredEquipmentIds.includes(equipmentId)) {
        return false;
      }
      return isExerciseAvailableWithSpace(ex, spaceIds, equipmentIdSet);
    });

    if (!matches.length) continue;
    const sameGroup = matches.filter(
      (ex) =>
        String(ex.muscle_group ?? "").toLowerCase() ===
        String(exercise.muscle_group ?? "").toLowerCase()
    );
    const sorted = (sameGroup.length ? sameGroup : matches).sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""))
    );
    const candidate = sorted[0];
    if (candidate && !substitutions.find((item) => item.exerciseId === candidate.id)) {
      pushCandidate(candidate, equipmentId);
    }
  }

  return substitutions;
}

export function getTemplateCompatibility({
  items,
  spaceEquipmentIds,
  allExercises,
  equipmentMap,
}) {
  const safeItems = Array.isArray(items) ? items : [];
  const exercises = Array.isArray(allExercises) ? allExercises : [];
  const resolvedEquipmentMap =
    equipmentMap instanceof Map ? equipmentMap : getEquipmentMap(equipmentMap ?? []);
  const missingByExercise = [];
  let hasBlockingMissing = false;

  safeItems.forEach((item) => {
    const exercise = item?.exercise ?? null;
    if (!exercise) return;
    const missing = getMissingEquipmentForExercise(
      exercise,
      spaceEquipmentIds ?? [],
      resolvedEquipmentMap
    );
    if (!missing.length) return;

    const canCheckSubstitutions = exercises.length > 0;
    const substitutions = canCheckSubstitutions
      ? getExerciseSubstitutionsForExercise(
          exercise,
          exercises,
          spaceEquipmentIds ?? [],
          resolvedEquipmentMap
        )
      : [];
    if (canCheckSubstitutions && !substitutions.length) {
      hasBlockingMissing = true;
    }

    missingByExercise.push({
      exerciseId: exercise.id ?? null,
      name: exercise.name ?? "Unknown Exercise",
      missingEquipment: missing.map((item) => item?.name ?? "Unknown"),
      hasSubstitution: substitutions.length > 0,
    });
  });

  const missingEquipment = Array.from(
    new Set(missingByExercise.flatMap((entry) => entry.missingEquipment))
  );

  let status = "full";
  if (missingByExercise.length > 0) {
    status = hasBlockingMissing ? "not_compatible" : "needs_substitutions";
  }

  return {
    status,
    missingEquipment,
    missingByExercise,
  };
}

async function resolveSpace(spaceId) {
  if (spaceId != null) return getWorkoutSpaceById(spaceId);
  const spaces = await listWorkoutSpaces();
  const settings = await db.settings.get(1);
  return resolveActiveSpace(spaces, settings?.active_space_id ?? null);
}

export async function isExerciseAvailable(exerciseId, spaceId) {
  const space = await resolveSpace(spaceId);
  if (!space) return true;
  const exercise = await db.table("exercises").get(exerciseId);
  if (!exercise) return false;
  const equipment = await listEquipment();
  const equipmentIdSet = new Set(equipment.map((item) => item.id));
  return isExerciseAvailableWithSpace(exercise, space.equipmentIds, equipmentIdSet);
}

export async function getMissingEquipment(exerciseId, spaceId) {
  const space = await resolveSpace(spaceId);
  if (!space) return [];
  const exercise = await db.table("exercises").get(exerciseId);
  if (!exercise) return [];
  const equipment = await listEquipment();
  const equipmentMap = getEquipmentMap(equipment);
  return getMissingEquipmentForExercise(exercise, space.equipmentIds, equipmentMap);
}

export async function getAvailableExercises(spaceId) {
  const space = await resolveSpace(spaceId);
  const exercises = await getAllExercises();
  if (!space) return exercises;
  const equipment = await listEquipment();
  const equipmentIdSet = new Set(equipment.map((item) => item.id));
  return exercises.filter((ex) =>
    isExerciseAvailableWithSpace(ex, space.equipmentIds, equipmentIdSet)
  );
}

export async function getExerciseSubstitutions(exerciseId, spaceId) {
  const space = await resolveSpace(spaceId);
  if (!space) return [];
  const exercises = await getAllExercises();
  const exercise = exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return [];
  const equipment = await listEquipment();
  const equipmentMap = getEquipmentMap(equipment);
  return getExerciseSubstitutionsForExercise(exercise, exercises, space.equipmentIds, equipmentMap);
}
