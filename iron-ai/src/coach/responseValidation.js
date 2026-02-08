import { z } from "zod";
import { ActionDraftKinds, parseCoachActionDraftMessage } from "./actionDraftContract";

const JSON_FENCE_REGEX = /```json\s*([\s\S]*?)```/gi;
const STRICT_JSON_FENCE_REGEX = /^\s*```json\s*([\s\S]*?)\s*```\s*$/i;

const WorkoutExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.union([z.number().int().positive(), z.string().min(1)]),
  reps: z.union([z.number().int().positive(), z.string().min(1)]),
});

export const WorkoutPlanSchema = z.object({
  name: z.string().min(1).optional(),
  exercises: z.array(WorkoutExerciseSchema).min(1),
});

const TemplateExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  name: z.string().min(1).optional(),
  exerciseName: z.string().min(1).optional(),
  sets: z.number().int().positive(),
  reps: z.number().int().positive(),
  warmupSets: z.number().int().nonnegative().optional(),
});

const NeedsReviewSuggestionSchema = z.object({
  exerciseId: z.number().int().positive(),
  name: z.string().min(1),
});

const NeedsReviewEntrySchema = z.object({
  requestedName: z.string().min(1),
  suggestions: z.array(NeedsReviewSuggestionSchema).max(5).optional(),
});

export const TemplateJsonSchema = z.object({
  name: z.string().min(1),
  exercises: z.array(TemplateExerciseSchema).min(1),
  needsReview: z.array(NeedsReviewEntrySchema).optional(),
});

const CONTEXT_CLAIM_REGEX =
  /available equipment|using .*equipment|based on .*equipment|i can see .*equipment|with your equipment/i;
const WORKOUT_REQUEST_REGEX = /\b(workout|routine|session|plan)\b/i;
const WORKOUT_LIST_LINE_REGEX =
  /^\s*(?:[-*]|\d+[.)])\s+.+?(\d+\s*(?:sets?\s*(?:of)?\s*\d+\s*reps?|[x×]\s*\d+))/gim;

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeZodErrors(error) {
  if (!error?.issues?.length) return "Validation failed.";
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function extractJsonFences(text) {
  const value = String(text ?? "");
  const fences = [];
  JSON_FENCE_REGEX.lastIndex = 0;
  let match = null;
  while ((match = JSON_FENCE_REGEX.exec(value)) !== null) {
    fences.push(match[1] ?? "");
  }
  return fences;
}

function extractJsonObjectCandidate(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (value.startsWith("{") && value.endsWith("}")) {
    return value;
  }
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return value.slice(first, last + 1);
  }
  return null;
}

function validateContextOffWorkout(text) {
  const claimsEquipment = CONTEXT_CLAIM_REGEX.test(text);
  if (claimsEquipment) {
    return {
      valid: false,
      error:
        "Context is off, so the response cannot claim it can see available equipment.",
    };
  }
  return { valid: true, error: null };
}

function hasPlainWorkoutList(text) {
  const value = String(text ?? "");
  if (!value.trim()) return false;
  const matches = value.match(WORKOUT_LIST_LINE_REGEX);
  return Array.isArray(matches) && matches.length >= 3;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getActionDraftForWorkout(text) {
  const parsed = parseCoachActionDraftMessage(text);
  const draft = parsed?.actionDraft ?? null;
  if (!draft) return null;
  if (
    draft.kind !== ActionDraftKinds.create_workout &&
    draft.kind !== ActionDraftKinds.create_template
  ) {
    return null;
  }
  return draft;
}

function validateActionDraftExerciseIds(draft, { allowedCandidateIds, libraryIdSet } = {}) {
  const payload = draft?.payload ?? {};
  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const needsReview = Array.isArray(payload.needsReview) ? payload.needsReview : [];

  if (exercises.length === 0 && needsReview.length === 0) {
    return {
      valid: false,
      error: "Action draft must include exercises or needsReview entries.",
    };
  }

  for (let i = 0; i < exercises.length; i += 1) {
    const entry = exercises[i];
    const exerciseId = parsePositiveInt(entry?.exerciseId);
    if (exerciseId == null) {
      return {
        valid: false,
        error: `actionDraft.payload.exercises[${i}].exerciseId must be a valid ID.`,
      };
    }
    if (libraryIdSet?.size && !libraryIdSet.has(exerciseId)) {
      return {
        valid: false,
        error: `Unknown exerciseId ${exerciseId} (not in library).`,
      };
    }
    if (allowedCandidateIds?.size && !allowedCandidateIds.has(exerciseId)) {
      return {
        valid: false,
        error: `exerciseId ${exerciseId} is outside the allowed candidate list.`,
      };
    }
  }

  for (let i = 0; i < needsReview.length; i += 1) {
    const review = needsReview[i];
    const parsedReview = NeedsReviewEntrySchema.safeParse(review);
    if (!parsedReview.success) {
      return { valid: false, error: normalizeZodErrors(parsedReview.error) };
    }
    const suggestions = Array.isArray(review?.suggestions) ? review.suggestions : [];
    for (let s = 0; s < suggestions.length; s += 1) {
      const suggestionId = parsePositiveInt(suggestions[s]?.exerciseId);
      if (suggestionId == null) {
        return {
          valid: false,
          error: `needsReview[${i}].suggestions[${s}].exerciseId must be a valid ID.`,
        };
      }
      if (libraryIdSet?.size && !libraryIdSet.has(suggestionId)) {
        return {
          valid: false,
          error: `needsReview suggestion ${suggestionId} is not in the library.`,
        };
      }
      if (allowedCandidateIds?.size && !allowedCandidateIds.has(suggestionId)) {
        return {
          valid: false,
          error: `needsReview suggestion ${suggestionId} is outside the candidate list.`,
        };
      }
    }
  }

  return { valid: true, error: null };
}

export function extractWorkoutPlanOutput(text) {
  const fences = extractJsonFences(text);
  let lastSchemaError = null;
  for (const raw of fences) {
    const parsed = safeParseJson(raw);
    if (!parsed) {
      lastSchemaError = "Workout plan JSON could not be parsed.";
      continue;
    }
    const validation = WorkoutPlanSchema.safeParse(parsed);
    if (validation.success) {
      return {
        valid: true,
        parsed: validation.data,
        error: null,
        source: "codeFence:json",
        rawJson: raw,
      };
    }
    lastSchemaError = normalizeZodErrors(validation.error);
  }
  const rawJsonCandidate = extractJsonObjectCandidate(text);
  if (rawJsonCandidate) {
    const parsed = safeParseJson(rawJsonCandidate);
    if (parsed) {
      const validation = WorkoutPlanSchema.safeParse(parsed);
      if (validation.success) {
        return {
          valid: true,
          parsed: validation.data,
          error: null,
          source: "raw:json",
          rawJson: rawJsonCandidate,
        };
      }
      lastSchemaError = normalizeZodErrors(validation.error);
    } else {
      lastSchemaError = "Workout plan JSON could not be parsed.";
    }
  }
  return {
    valid: false,
    parsed: null,
    error:
      lastSchemaError ??
      "Workout responses must include JSON with a WorkoutPlan object.",
    source: null,
    rawJson: rawJsonCandidate,
  };
}

export function validateTemplateJsonOutput(
  text,
  { allowedCandidateIds, libraryIdSet } = {}
) {
  const match = String(text ?? "").match(STRICT_JSON_FENCE_REGEX);
  if (!match) {
    return {
      valid: false,
      parsed: null,
      error:
        "Template conversion must return only one fenced ```json block with no extra text.",
    };
  }
  const parsed = safeParseJson(match[1] ?? "");
  if (!parsed) {
    return {
      valid: false,
      parsed: null,
      error: "Template JSON could not be parsed.",
    };
  }
  const validation = TemplateJsonSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      valid: false,
      parsed: null,
      error: normalizeZodErrors(validation.error),
    };
  }
  const exercises = Array.isArray(validation.data?.exercises)
    ? validation.data.exercises
    : [];
  for (let i = 0; i < exercises.length; i += 1) {
    const exerciseId = parsePositiveInt(exercises[i]?.exerciseId);
    if (exerciseId == null) {
      return {
        valid: false,
        parsed: null,
        error: `exercises[${i}].exerciseId must be a valid ID.`,
      };
    }
    if (libraryIdSet?.size && !libraryIdSet.has(exerciseId)) {
      return {
        valid: false,
        parsed: null,
        error: `Unknown exerciseId ${exerciseId} (not in library).`,
      };
    }
    if (allowedCandidateIds?.size && !allowedCandidateIds.has(exerciseId)) {
      return {
        valid: false,
        parsed: null,
        error: `exerciseId ${exerciseId} is outside the allowed candidate list.`,
      };
    }
  }
  const needsReview = Array.isArray(validation.data?.needsReview)
    ? validation.data.needsReview
    : [];
  for (let i = 0; i < needsReview.length; i += 1) {
    const suggestions = Array.isArray(needsReview[i]?.suggestions)
      ? needsReview[i].suggestions
      : [];
    for (let s = 0; s < suggestions.length; s += 1) {
      const suggestionId = parsePositiveInt(suggestions[s]?.exerciseId);
      if (suggestionId == null) {
        return {
          valid: false,
          parsed: null,
          error: `needsReview[${i}].suggestions[${s}].exerciseId must be a valid ID.`,
        };
      }
      if (libraryIdSet?.size && !libraryIdSet.has(suggestionId)) {
        return {
          valid: false,
          parsed: null,
          error: `needsReview suggestion ${suggestionId} is not in the library.`,
        };
      }
      if (allowedCandidateIds?.size && !allowedCandidateIds.has(suggestionId)) {
        return {
          valid: false,
          parsed: null,
          error: `needsReview suggestion ${suggestionId} is outside the candidate list.`,
        };
      }
    }
  }
  return { valid: true, parsed: validation.data, error: null };
}

export function classifyCoachResponseMode({ userMessage, responseMode }) {
  if (responseMode === "template_json") return "template_json";
  if (WORKOUT_REQUEST_REGEX.test(String(userMessage ?? ""))) return "workout";
  return "general";
}

export function validateCoachResponse({
  userMessage,
  assistantText,
  responseMode,
  contextEnabled,
  allowedCandidateIds,
  libraryIdSet,
}) {
  const mode = classifyCoachResponseMode({ userMessage, responseMode });
  const text = String(assistantText ?? "").trim();

  if (mode === "template_json") {
    const result = validateTemplateJsonOutput(text, {
      allowedCandidateIds,
      libraryIdSet,
    });
    return { ...result, mode };
  }

  if (mode === "workout") {
    const actionDraft = getActionDraftForWorkout(text);
    if (actionDraft) {
      const idValidation = validateActionDraftExerciseIds(actionDraft, {
        allowedCandidateIds,
        libraryIdSet,
      });
      if (!idValidation.valid) {
        return { valid: false, parsed: null, error: idValidation.error, mode };
      }
      if (!contextEnabled) {
        const contextResult = validateContextOffWorkout(text);
        if (!contextResult.valid) {
          return { ...contextResult, parsed: null, mode };
        }
      }
      return { valid: true, parsed: null, error: null, mode };
    }

    if (!contextEnabled) {
      const contextResult = validateContextOffWorkout(text);
      if (!contextResult.valid) {
        return { ...contextResult, parsed: null, mode };
      }
    }
    if (hasPlainWorkoutList(text)) {
      return { valid: true, parsed: null, error: null, mode };
    }
    return {
      valid: false,
      parsed: null,
      error:
        "Workout responses must include coach_action_v1 actionDraft with exerciseId values from candidates.",
      mode,
    };
  }

  return { valid: true, parsed: null, error: null, mode };
}

const TEMPLATE_JSON_SCHEMA_TEXT =
  "{ name: string, exercises: [{ exerciseId: number, sets: number, reps: number, warmupSets?: number }], needsReview?: [{ requestedName: string, suggestions?: [{ exerciseId: number, name: string }] }] }";

function formatCandidateList(candidateExercises) {
  const list = Array.isArray(candidateExercises) ? candidateExercises : [];
  if (!list.length) return "[]";
  return JSON.stringify(
    list.map((entry) => ({
      exerciseId: entry.exerciseId ?? entry.id ?? null,
      name: entry.name ?? "Unknown Exercise",
    })),
    null,
    2
  );
}

export function buildRepairPrompt({
  validationMode,
  contextEnabled,
  invalidContent,
  selectedGym,
  candidateExercises,
}) {
  const gymLabel = selectedGym?.name ? `Selected gym: ${selectedGym.name}` : "Selected gym: none";
  const invalid = String(invalidContent ?? "");
  const candidateList = formatCandidateList(candidateExercises);

  if (validationMode === "template_json") {
    return [
      "REPAIR TASK: The previous output failed template JSON validation.",
      "Return ONLY a fenced ```json block, with no extra text before or after.",
      `Schema: ${TEMPLATE_JSON_SCHEMA_TEXT}`,
      "Use only these candidate exercises and IDs:",
      candidateList,
      "Each exercise in exercises must include a valid exerciseId from candidates.",
      "If no valid ID is possible, return needsReview with candidate suggestions.",
      "Invalid content:",
      invalid,
      "Rule: return ONLY the corrected output.",
    ].join("\n");
  }

  if (validationMode === "workout" && !contextEnabled) {
    return [
      "REPAIR TASK: Context sharing is OFF.",
      "Do NOT claim you can see equipment.",
      "Return a generic workout as coach_action_v1 actionDraft with at least 5 exercises.",
      "Every exercise must include exerciseId from candidates only.",
      "If a request cannot be mapped safely, return needsReview with candidate suggestions.",
      "Candidate list:",
      candidateList,
      "Include a brief line asking the user to enable context or choose a gym for personalization.",
      "Invalid content:",
      invalid,
      "Rule: return ONLY the corrected output with concise assistant text.",
    ].join("\n");
  }

  return [
    "REPAIR TASK: The previous workout output failed validation.",
    "Return coach_action_v1 actionDraft output with at least 5 exercises.",
    "Every exercise must include exerciseId from the provided candidate list.",
    "If you cannot map safely, return needsReview with candidate suggestions.",
    "Candidate list:",
    candidateList,
    gymLabel,
    "Prefer coach_action_v1 actionDraft output for deterministic parsing.",
    "Invalid content:",
    invalid,
    "Rule: return ONLY the corrected output with concise assistant text.",
  ].join("\n");
}

export function getValidationFailureMessage(mode) {
  if (mode === "template_json") {
    return "Coach had trouble formatting template JSON. Please tap Retry.";
  }
  if (mode === "workout") {
    return "Coach had trouble formatting a complete workout. Please tap Retry.";
  }
  return "Coach response validation failed. Please tap Retry.";
}
