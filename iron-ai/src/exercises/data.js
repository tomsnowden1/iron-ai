import { normalizeExerciseEquipment } from "../equipment/engine";

const DEFAULT_INSTRUCTIONS = [
  "Set up your starting position and brace your core.",
  "Move through the full range of motion with control.",
  "Return to the start position and repeat with steady form.",
];

const DEFAULT_MISTAKES = [
  "Rushing the tempo or bouncing through reps.",
  "Letting form break down near the end of the set.",
  "Using momentum instead of controlled effort.",
];

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
  if (steps.length) return { steps, isFallback: false };
  return { steps: DEFAULT_INSTRUCTIONS, isFallback: true };
}

export function getExerciseCommonMistakes(exercise) {
  const mistakes = Array.isArray(exercise?.commonMistakes)
    ? exercise.commonMistakes.filter(Boolean)
    : [];
  if (mistakes.length) return { mistakes, isFallback: false };
  return { mistakes: DEFAULT_MISTAKES, isFallback: true };
}

export function getExerciseVideoUrl(exercise) {
  const mediaUrl = exercise?.media?.videoUrl ?? exercise?.media?.video_url;
  return mediaUrl || exercise?.videoUrl || exercise?.video_url || "";
}

export function getNormalizedEquipment(exercise) {
  return normalizeExerciseEquipment(exercise);
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
    .map((item) => item.name ?? id);
}
