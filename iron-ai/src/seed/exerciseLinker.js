import { normalizeExerciseEquipment } from "../equipment/engine";
import { normalizeString } from "./seedUtils";

const EQUIPMENT_DIFFICULTY = {
  bodyweight: 1,
  resistance_band: 1,
  band: 1,
  dumbbell: 2,
  kettlebell: 2,
  cable_machine: 2,
  machine: 2,
  bench: 2,
  squat_rack: 3,
  barbell: 3,
  trap_bar: 3,
  ez_bar: 3,
};

const DIFFICULTY_KEYWORDS = [
  { match: /assisted|banded|supported/i, delta: -1 },
  { match: /machine|smith/i, delta: -0.5 },
  { match: /single|unilateral|one[-\s]?arm|one[-\s]?leg/i, delta: 0.75 },
  { match: /pause|tempo|deficit|weighted|plyo|explosive/i, delta: 0.75 },
];

const MAX_LINKS = 3;
const MIN_SCORE = 6;

function getLinkKey(exercise) {
  return exercise.stableId || exercise.slug || null;
}

function scoreDifficulty(exercise, equipmentIdSet) {
  const normalized = normalizeExerciseEquipment(exercise, equipmentIdSet);
  const required = normalized.requiredEquipmentIds ?? [];
  let base = required.reduce((max, id) => {
    const score = EQUIPMENT_DIFFICULTY[id] ?? 2;
    return Math.max(max, score);
  }, 1);

  const name = normalizeString(exercise?.name).toLowerCase();
  DIFFICULTY_KEYWORDS.forEach(({ match, delta }) => {
    if (match.test(name)) base += delta;
  });

  return Math.max(1, Math.min(5, base));
}

function overlapCount(a = [], b = []) {
  const set = new Set(a.map((item) => normalizeString(item).toLowerCase()));
  let count = 0;
  b.forEach((item) => {
    if (set.has(normalizeString(item).toLowerCase())) count += 1;
  });
  return count;
}

export function buildExerciseLinks(exercises, { maxLinks = MAX_LINKS, minScore = MIN_SCORE } = {}) {
  const list = Array.isArray(exercises) ? exercises : [];
  const equipmentIdSet = new Set(
    list.flatMap((ex) => ex?.requiredEquipmentIds ?? ex?.equipment ?? [])
  );
  equipmentIdSet.add("bodyweight");

  const keyed = list
    .map((exercise) => ({ exercise, key: getLinkKey(exercise) }))
    .filter((item) => item.key && !item.exercise?.is_custom && item.exercise?.source !== "user");

  const result = new Map();

  keyed.forEach(({ exercise, key }) => {
    const basePattern = normalizeString(exercise?.pattern).toLowerCase();
    const baseCategory = normalizeString(exercise?.category).toLowerCase();
    const basePrimary = Array.isArray(exercise?.primaryMuscles)
      ? exercise.primaryMuscles
      : [];
    const baseDifficulty = scoreDifficulty(exercise, equipmentIdSet);

    const regressions = [];
    const progressions = [];

    keyed.forEach((candidateItem) => {
      const candidate = candidateItem.exercise;
      if (candidate === exercise) return;
      const candidateKey = candidateItem.key;
      if (!candidateKey) return;

      const candidatePattern = normalizeString(candidate?.pattern).toLowerCase();
      const candidateCategory = normalizeString(candidate?.category).toLowerCase();
      const muscleOverlap = overlapCount(basePrimary, candidate?.primaryMuscles);
      const equipmentOverlap = overlapCount(
        exercise?.equipment,
        candidate?.equipment ?? candidate?.requiredEquipmentIds
      );

      let score = 0;
      if (basePattern && candidatePattern && basePattern === candidatePattern) score += 4;
      if (baseCategory && candidateCategory && baseCategory === candidateCategory) score += 2;
      score += Math.min(muscleOverlap * 2, 6);
      if (equipmentOverlap > 0) score += 1;

      if (score < minScore) return;

      const candidateDifficulty = scoreDifficulty(candidate, equipmentIdSet);
      if (candidateDifficulty < baseDifficulty) {
        regressions.push({ key: candidateKey, score });
      } else if (candidateDifficulty > baseDifficulty) {
        progressions.push({ key: candidateKey, score });
      }
    });

    const pickTop = (listToSort) =>
      listToSort
        .sort((a, b) => b.score - a.score)
        .slice(0, maxLinks)
        .map((item) => item.key);

    result.set(key, {
      progressions: pickTop(progressions),
      regressions: pickTop(regressions),
    });
  });

  return result;
}
