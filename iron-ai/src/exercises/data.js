import { normalizeExerciseEquipment } from "../equipment/engine";

export function getExercisePrimaryMuscles(exercise) {
  const primary = Array.isArray(exercise?.primaryMuscles)
    ? exercise.primaryMuscles.filter(Boolean)
    : [];
  if (primary.length) return primary;
  const legacy = String(exercise?.muscle_group ?? "").trim();
  return legacy ? [legacy] : [];
}

export function getExerciseSecondaryMuscles(exercise) {
  return Array.isArray(exercise?.secondaryMuscles)
    ? exercise.secondaryMuscles.filter(Boolean)
    : [];
}

export function getExerciseAliases(exercise) {
  return Array.isArray(exercise?.aliases) ? exercise.aliases.filter(Boolean) : [];
}

export function getExerciseType(exercise) {
  const raw = exercise?.exerciseType ?? exercise?.exercise_type ?? exercise?.type ?? "";
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("comp")) return "compound";
  if (normalized.startsWith("iso")) return "isolation";
  return normalized;
}

export function getExerciseInstructions(exercise) {
  const steps = Array.isArray(exercise?.instructions)
    ? exercise.instructions.filter(Boolean)
    : [];
  return { steps, isFallback: false };
}

export function getExerciseCommonMistakes(exercise) {
  const mistakes = Array.isArray(exercise?.commonMistakes)
    ? exercise.commonMistakes.filter(Boolean)
    : [];
  return { mistakes, isFallback: false };
}

export function getExerciseGotchas(exercise) {
  const gotchas = Array.isArray(exercise?.gotchas) ? exercise.gotchas.filter(Boolean) : [];
  return { gotchas, isFallback: false };
}

export function getExerciseVideoUrl(exercise) {
  const mediaUrl = exercise?.media?.videoUrl ?? exercise?.media?.video_url;
  return mediaUrl || exercise?.videoUrl || exercise?.video_url || "";
}

export function getNormalizedEquipment(exercise, equipmentIdSet) {
  return normalizeExerciseEquipment(exercise, equipmentIdSet);
}

export function getExerciseEquipment(exercise) {
  const equipment = Array.isArray(exercise?.equipment)
    ? exercise.equipment.filter(Boolean)
    : [];
  if (equipment.length) return equipment;
  const normalized = normalizeExerciseEquipment(exercise);
  return Array.isArray(normalized?.requiredEquipmentIds)
    ? normalized.requiredEquipmentIds
    : [];
}

export function buildExerciseSearchText(exercise) {
  const parts = [
    exercise?.name,
    exercise?.muscle_group,
    ...getExercisePrimaryMuscles(exercise),
    ...getExerciseAliases(exercise),
  ];
  return parts
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function formatEquipmentLabels(requiredEquipmentIds, equipmentMap) {
  const ids = Array.isArray(requiredEquipmentIds) ? requiredEquipmentIds : [];
  return ids
    .map((id) => equipmentMap.get(id))
    .filter(Boolean)
    .map((item) => item.name ?? item.id);
}
