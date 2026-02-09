import { getAllExercises } from "../db";
import { createCustomExercise } from "../exercises/customExercise";
import { getExerciseAliases } from "../exercises/data";
import { slugify } from "../seed/seedUtils";

const NAME_FIELDS = ["name", "exerciseName", "exercise", "title", "label"];

function normalizeName(value) {
  const normalized = slugify(value);
  return normalized ? normalized.toLowerCase() : "";
}

function extractDraftName(draft) {
  if (typeof draft === "string") return draft;
  if (!draft || typeof draft !== "object") return "";
  for (const field of NAME_FIELDS) {
    const value = draft[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function extractDraftId(draft) {
  if (!draft || typeof draft !== "object") return null;
  const value = draft.exerciseId ?? draft.id ?? null;
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCount(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function addLookupEntry(lookup, label, exercise) {
  const key = normalizeName(label);
  if (!key || lookup.has(key)) return;
  lookup.set(key, exercise);
}

function buildExerciseLookup(exercises) {
  const lookup = new Map();
  exercises.forEach((exercise) => {
    addLookupEntry(lookup, exercise?.name, exercise);
    getExerciseAliases(exercise).forEach((alias) => {
      addLookupEntry(lookup, alias, exercise);
    });
  });
  return lookup;
}

export async function resolveTemplateExercises(draftExercises, { createMissing } = {}) {
  const list = Array.isArray(draftExercises) ? draftExercises : [];
  if (!list.length) {
    return { resolvedExercises: [], mapping: [], mappedCount: 0, createdCustomCount: 0 };
  }

  const exercises = await getAllExercises();
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const byName = buildExerciseLookup(exercises);

  const resolvedExercises = [];
  const mapping = [];
  let createdCustomCount = 0;

  for (const draft of list) {
    const draftName = extractDraftName(draft);
    const draftId = extractDraftId(draft);
    let resolved = null;
    let matchSource = null;
    let createdCustom = false;

    if (draftName) {
      resolved = byName.get(normalizeName(draftName)) ?? null;
      if (resolved) matchSource = "name";
    }

    if (!resolved && draftId != null) {
      resolved = byId.get(draftId) ?? null;
      if (resolved) matchSource = "id";
    }

    if (!resolved && draftName && createMissing) {
      const newId = await createCustomExercise({ name: draftName });
      resolved = { id: newId, name: draftName, source: "user", is_custom: true };
      createdCustom = true;
      matchSource = "custom";
      createdCustomCount += 1;
      addLookupEntry(byName, draftName, resolved);
      byId.set(newId, resolved);
    }

    resolvedExercises.push({
      exerciseId: resolved?.id ?? null,
      sets: parseCount(draft?.sets ?? draft?.targetSets),
      reps: parseCount(draft?.reps ?? draft?.targetReps),
      warmupSets: parseCount(draft?.warmupSets),
      draftName,
    });

    mapping.push({
      draftName,
      draftId,
      resolvedId: resolved?.id ?? null,
      resolvedName: resolved?.name ?? null,
      createdCustom,
      matchSource,
    });
  }

  const mappedCount = resolvedExercises.filter((item) => item.exerciseId != null).length;

  return { resolvedExercises, mapping, mappedCount, createdCustomCount };
}
