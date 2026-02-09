import { getAllExercises } from "../db";
import { createCustomExercise } from "../exercises/customExercise";
import { resolveExerciseId } from "./exerciseResolver";

const NAME_FIELDS = ["name", "exerciseName", "exercise", "title", "label"];

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

function normalizeCandidateExercise(candidate, byId) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.id != null && byId.has(candidate.id)) {
    return byId.get(candidate.id);
  }
  const candidateId = Number.parseInt(candidate.exerciseId, 10);
  if (Number.isFinite(candidateId) && byId.has(candidateId)) {
    return byId.get(candidateId);
  }
  if (candidate.id != null || candidate.exerciseId != null) {
    const id = Number(candidate.id ?? candidate.exerciseId);
    if (Number.isFinite(id) && id > 0) {
      return {
        id,
        name: String(candidate.name ?? "").trim() || `Exercise ${id}`,
        aliases: Array.isArray(candidate.aliases) ? candidate.aliases : [],
      };
    }
  }
  return null;
}

function resolveCandidatePool(candidates, byId, fallbackExercises) {
  const list = Array.isArray(candidates) ? candidates : [];
  const normalized = list
    .map((candidate) => normalizeCandidateExercise(candidate, byId))
    .filter(Boolean);
  if (normalized.length) return normalized;
  return fallbackExercises;
}

export async function resolveTemplateExercises(
  draftExercises,
  { createMissing, candidates, allExercises, maxSuggestions } = {}
) {
  const list = Array.isArray(draftExercises) ? draftExercises : [];
  if (!list.length) {
    return {
      resolvedExercises: [],
      mapping: [],
      mappedCount: 0,
      createdCustomCount: 0,
      unresolvedCount: 0,
      needsReview: [],
    };
  }

  const exercises = Array.isArray(allExercises) && allExercises.length
    ? allExercises
    : await getAllExercises();
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const candidatePool = resolveCandidatePool(candidates, byId, exercises);

  const resolvedExercises = [];
  const mapping = [];
  const needsReview = [];
  let createdCustomCount = 0;

  for (const draft of list) {
    const draftName = extractDraftName(draft);
    const draftId = extractDraftId(draft);
    let resolved = null;
    let matchSource = null;
    let createdCustom = false;
    let review = null;

    if (draftId != null) {
      resolved = byId.get(draftId) ?? null;
      if (resolved) matchSource = "id";
    }

    if (!resolved && draftName) {
      const result = resolveExerciseId(draftName, {
        candidates: candidatePool,
        allExercises: exercises,
        threshold: 0.58,
        tieMargin: 0.06,
        maxSuggestions,
      });
      if (result.status === "resolved") {
        resolved = byId.get(result.exerciseId) ?? null;
        matchSource = result.matchedBy ?? "name";
      } else {
        review = result;
      }
    }

    if (!resolved && !review && draftId != null) {
      review = {
        status: "needsReview",
        requestedName: draftName || `Exercise #${draftId}`,
        suggestions: [],
      };
    }

    if (!resolved && draftName && createMissing) {
      const newId = await createCustomExercise({ name: draftName });
      resolved = { id: newId, name: draftName, source: "user", is_custom: true };
      createdCustom = true;
      matchSource = "custom";
      createdCustomCount += 1;
      byId.set(newId, resolved);
    }

    if (review && !createdCustom) {
      const requestedName = review.requestedName || draftName || "Unknown exercise";
      needsReview.push({
        requestedName,
        suggestions: Array.isArray(review.suggestions) ? review.suggestions : [],
      });
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
      needsReview: review
        ? {
            requestedName: review.requestedName || draftName || "Unknown exercise",
            suggestions: Array.isArray(review.suggestions) ? review.suggestions : [],
          }
        : null,
    });
  }

  const mappedCount = resolvedExercises.filter((item) => item.exerciseId != null).length;
  const unresolvedCount = Math.max(0, resolvedExercises.length - mappedCount);

  return {
    resolvedExercises,
    mapping,
    mappedCount,
    createdCustomCount,
    unresolvedCount,
    needsReview,
  };
}
