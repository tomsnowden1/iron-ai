import { ActionDraftKinds } from "../../coach/actionDraftContract";
import { validateToolInput } from "../../coach/tools";

function parseJsonCandidate(text) {
  try {
    return { parsed: JSON.parse(text), error: null };
  } catch (err) {
    return {
      parsed: null,
      error: `Unable to parse JSON${err?.message ? `: ${err.message}` : ""}.`,
    };
  }
}

function extractFencedCodeBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const regex = /```[ \t]*([^\s]*)?\s*([\s\S]*?)```/g;
  let match = null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: String(match[1] ?? "").trim().toLowerCase(),
      content: match[2] ?? "",
    });
  }
  return blocks;
}

function parseIntegerValue(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
  }
  return null;
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = parseIntegerValue(value);
  if (parsed == null || parsed <= 0) return fallback;
  return parsed;
}

function extractSetsRepsFromText(value) {
  const text = String(value ?? "").trim();
  if (!text) return { sets: null, reps: null };
  const times = text.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (times) {
    return {
      sets: parsePositiveInteger(times[1], null),
      reps: parsePositiveInteger(times[2], null),
    };
  }
  const setsOfReps = text.match(/(\d+)\s*sets?\s*(?:of)?\s*(\d+)/i);
  if (setsOfReps) {
    return {
      sets: parsePositiveInteger(setsOfReps[1], null),
      reps: parsePositiveInteger(setsOfReps[2], null),
    };
  }
  return { sets: null, reps: null };
}

function resolveSetsRepsFromSetArray(setEntries) {
  const setsArray = Array.isArray(setEntries) ? setEntries : [];
  if (!setsArray.length) return { sets: null, reps: null };
  const sets = setsArray.length;
  const repsFromEntries = setsArray
    .map((set) => {
      const direct =
        parsePositiveInteger(set?.reps, null) ??
        parsePositiveInteger(set?.targetReps, null);
      if (direct != null) return direct;
      const fromText = extractSetsRepsFromText(set?.reps ?? set?.targetReps);
      return fromText.reps;
    })
    .filter((value) => value != null);
  return {
    sets,
    reps: repsFromEntries.length ? repsFromEntries[0] : null,
  };
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

function cleanExerciseName(value) {
  return String(value ?? "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function parseWorkoutListLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/, "").trim();
  if (!withoutPrefix) return null;

  const setsOfRepsMatch = withoutPrefix.match(
    /^(.+?)\s*[:\-–]?\s*(\d+)\s*sets?\s*(?:of)?\s*(\d+)(?:\s*[-–]\s*\d+)?\s*reps?\b/i
  );
  if (setsOfRepsMatch) {
    const name = cleanExerciseName(setsOfRepsMatch[1]);
    const sets = parsePositiveInteger(setsOfRepsMatch[2], null);
    const reps = parsePositiveInteger(setsOfRepsMatch[3], null);
    if (!name || sets == null || reps == null) return null;
    return { name, exerciseName: name, sets, reps };
  }

  const timesMatch = withoutPrefix.match(/^(.+?)\s*[:\-–]?\s*(\d+)\s*[x×]\s*(\d+)\b/i);
  if (timesMatch) {
    const name = cleanExerciseName(timesMatch[1]);
    const sets = parsePositiveInteger(timesMatch[2], null);
    const reps = parsePositiveInteger(timesMatch[3], null);
    if (!name || sets == null || reps == null) return null;
    return { name, exerciseName: name, sets, reps };
  }

  return null;
}

function resolveTemplateDraftFromPlainText(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { draft: null, found: false, error: null, source: "assistantText:list", rawJson: null };
  }

  const exercises = lines.map(parseWorkoutListLine).filter(Boolean);
  if (exercises.length < 3) {
    return { draft: null, found: false, error: null, source: "assistantText:list", rawJson: null };
  }

  const headingLine =
    lines.find((line) => /workout/i.test(line) && /here|today|draft|plan|routine/i.test(line)) ??
    null;
  const inferredName = headingLine
    ? cleanExerciseName(
        headingLine
          .replace(/^.*?\b(?:a|an|the)\b\s*/i, "")
          .replace(/[:\-–].*$/, "")
      )
    : "Coach Workout Draft";
  const name = inferredName || "Coach Workout Draft";

  return {
    draft: {
      name,
      exercises,
      needsReview: exercises.map((entry) => ({
        requestedName: entry.name ?? entry.exerciseName ?? "Unknown exercise",
        suggestions: [],
      })),
    },
    found: true,
    error: null,
    source: "assistantText:list",
    rawJson: null,
    requiresReview: true,
  };
}

function normalizeNeedsReviewEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .map((entry) => {
      const requestedName = String(entry?.requestedName ?? "").trim();
      if (!requestedName) return null;
      const suggestions = Array.isArray(entry?.suggestions)
        ? entry.suggestions
            .map((suggestion) => {
              const exerciseId = parsePositiveInteger(suggestion?.exerciseId, null);
              const name = String(suggestion?.name ?? "").trim();
              if (exerciseId == null || !name) return null;
              return { exerciseId, name };
            })
            .filter(Boolean)
        : [];
      return { requestedName, suggestions };
    })
    .filter(Boolean);
}

function validateTemplateDraft(
  raw,
  fallbackName,
  templateTool,
  { strictExerciseIds = false, allowMissingPrescription = false } = {}
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { draft: null, error: "Template draft must be an object." };
  }
  const rawName =
    typeof raw.name === "string"
      ? raw.name
      : typeof raw.title === "string"
        ? raw.title
        : typeof fallbackName === "string"
          ? fallbackName
          : "";
  const name = rawName.trim();
  if (!name) {
    return { draft: null, error: "Template name is required." };
  }
  const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : [];
  const normalizedNeedsReview = normalizeNeedsReviewEntries(raw.needsReview);
  if (!rawExercises.length && normalizedNeedsReview.length === 0) {
    return {
      draft: null,
      error: "Template draft must include exercises or needsReview entries.",
    };
  }
  const unresolvedNeedsReview = [];
  const exercises = [];
  for (let i = 0; i < rawExercises.length; i += 1) {
    const entry = rawExercises[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        draft: null,
        error: `exercises[${i}] must be an object.`,
      };
    }
    const exerciseId = parseIntegerValue(entry.exerciseId);
    const exerciseName =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : typeof entry.exerciseName === "string" && entry.exerciseName.trim()
          ? entry.exerciseName.trim()
          : "";
    if (exerciseId == null && !exerciseName) {
      return {
        draft: null,
        error: `exercises[${i}] must include exerciseId or name.`,
      };
    }
    const setsFromArray = resolveSetsRepsFromSetArray(entry.sets);
    const setsRepsFromSetsText = extractSetsRepsFromText(entry.sets);
    const setsRepsFromRepsText = extractSetsRepsFromText(entry.reps);
    const sets =
      parseIntegerValue(entry.sets) ??
      parseIntegerValue(entry.targetSets) ??
      setsRepsFromSetsText.sets ??
      setsRepsFromRepsText.sets ??
      setsFromArray.sets;
    if (sets == null && !allowMissingPrescription) {
      return {
        draft: null,
        error: `exercises[${i}].sets must be a number.`,
      };
    }
    const reps =
      parseIntegerValue(entry.reps) ??
      parseIntegerValue(entry.targetReps) ??
      setsRepsFromSetsText.reps ??
      setsRepsFromRepsText.reps ??
      setsFromArray.reps;
    if (reps == null && !allowMissingPrescription) {
      return {
        draft: null,
        error: `exercises[${i}].reps must be a number.`,
      };
    }
    let warmupSets = null;
    if (entry.warmupSets != null) {
      warmupSets = parseIntegerValue(entry.warmupSets);
      if (warmupSets == null) {
        return {
          draft: null,
          error: `exercises[${i}].warmupSets must be a number.`,
        };
      }
    }
    const normalizedExercise = {
      sets: sets ?? 3,
      reps: reps ?? 10,
      ...(warmupSets != null ? { warmupSets } : {}),
    };
    if (exerciseId != null) {
      normalizedExercise.exerciseId = exerciseId;
    } else if (strictExerciseIds && exerciseName) {
      unresolvedNeedsReview.push({
        requestedName: exerciseName,
        suggestions: [],
      });
    }
    if (exerciseName) {
      normalizedExercise.name = exerciseName;
      normalizedExercise.exerciseName = exerciseName;
    }
    exercises.push(normalizedExercise);
  }
  let spaceId = null;
  if (raw.spaceId != null) {
    spaceId = parseIntegerValue(raw.spaceId);
    if (spaceId == null) {
      return { draft: null, error: "spaceId must be a number." };
    }
  }
  const draft = {
    name,
    exercises,
    ...(normalizedNeedsReview.length || unresolvedNeedsReview.length
      ? {
          needsReview: [...normalizedNeedsReview, ...unresolvedNeedsReview],
        }
      : {}),
    ...(spaceId != null ? { spaceId } : {}),
  };
  const requiresReview =
    strictExerciseIds &&
    Array.isArray(draft.needsReview) &&
    draft.needsReview.length > 0;
  if (templateTool && !requiresReview) {
    const validation = validateToolInput(templateTool, draft);
    if (!validation.valid) {
      return { draft: null, error: validation.errors.join("; ") };
    }
  }
  return { draft, error: null, requiresReview };
}

function resolveTemplateDraftFromActionDraft(
  actionDraft,
  templateTool,
  { strictExerciseIds = false } = {}
) {
  if (!actionDraft) return { draft: null, error: null, found: false, rawJson: null };
  if (
    actionDraft.kind !== ActionDraftKinds.create_template &&
    actionDraft.kind !== ActionDraftKinds.create_workout
  ) {
    return { draft: null, error: null, found: false, rawJson: null };
  }
  const payload = actionDraft.payload ?? {};
  const fallbackName = payload.name ?? payload.title ?? actionDraft.title ?? null;
  const raw = { ...payload };
  if (!raw.name && fallbackName) raw.name = fallbackName;
  const result = validateTemplateDraft(raw, fallbackName, templateTool, {
    strictExerciseIds,
    allowMissingPrescription: true,
  });
  return {
    ...result,
    found: true,
    rawJson: JSON.stringify(raw, null, 2),
  };
}

function resolveTemplateDraftFromText(
  text,
  templateTool,
  { strictExerciseIds = false } = {}
) {
  const blocks = extractFencedCodeBlocks(text);

  const evaluateBlocks = (targetBlocks, source) => {
    let lastError = null;
    let foundCandidate = false;
    let rawJson = null;
    for (const block of targetBlocks) {
      foundCandidate = true;
      rawJson = block.content;
      const { parsed, error } = parseJsonCandidate(block.content);
      if (!parsed) {
        lastError = error;
        continue;
      }
      if (parsed?.actionDraft) {
        const fromAction = resolveTemplateDraftFromActionDraft(
          parsed.actionDraft,
          templateTool,
          { strictExerciseIds }
        );
        if (fromAction.draft) {
          return {
            draft: fromAction.draft,
            found: true,
            error: null,
            source,
            rawJson: block.content,
            requiresReview: Boolean(fromAction.requiresReview),
          };
        }
        if (fromAction.error) lastError = fromAction.error;
      }
      const normalized = validateTemplateDraft(parsed, null, templateTool, {
        strictExerciseIds,
        allowMissingPrescription: false,
      });
      if (normalized.draft) {
        return {
          draft: normalized.draft,
          found: true,
          error: null,
          source,
          rawJson: block.content,
          requiresReview: Boolean(normalized.requiresReview),
        };
      }
      if (normalized.error) lastError = normalized.error;
    }
    return {
      draft: null,
      found: foundCandidate,
      error: lastError,
      source,
      rawJson,
      requiresReview: false,
    };
  };

  const jsonBlocks = blocks.filter((block) => block.language === "json");
  const jsonResult = jsonBlocks.length
    ? evaluateBlocks(jsonBlocks, "codeFence:json")
    : {
        draft: null,
        found: false,
        error: null,
        source: null,
        rawJson: null,
        requiresReview: false,
      };
  if (jsonResult.draft) return jsonResult;

  const anyResult = blocks.length
    ? evaluateBlocks(blocks, "codeFence:any")
    : {
        draft: null,
        found: false,
        error: null,
        source: null,
        rawJson: null,
        requiresReview: false,
      };
  if (anyResult.draft) return anyResult;

  const rawJsonCandidate = extractJsonObjectCandidate(text);
  if (rawJsonCandidate) {
    const { parsed, error } = parseJsonCandidate(rawJsonCandidate);
    if (!parsed) {
      return {
        draft: null,
        found: true,
        error,
        source: "raw:json",
        rawJson: rawJsonCandidate,
      };
    }
    if (parsed?.actionDraft) {
      const fromAction = resolveTemplateDraftFromActionDraft(
        parsed.actionDraft,
        templateTool,
        { strictExerciseIds }
      );
      if (fromAction.draft) {
        return {
          draft: fromAction.draft,
          found: true,
          error: null,
          source: "raw:json",
          rawJson: rawJsonCandidate,
          requiresReview: Boolean(fromAction.requiresReview),
        };
      }
    }
    const normalized = validateTemplateDraft(parsed, null, templateTool, {
      strictExerciseIds,
      allowMissingPrescription: false,
    });
    if (normalized.draft) {
      return {
        draft: normalized.draft,
        found: true,
        error: null,
        source: "raw:json",
        rawJson: rawJsonCandidate,
        requiresReview: Boolean(normalized.requiresReview),
      };
    }
    return {
      draft: null,
      found: true,
      error: normalized.error,
      source: "raw:json",
      rawJson: rawJsonCandidate,
    };
  }

  const plainTextResult = resolveTemplateDraftFromPlainText(text);
  if (plainTextResult.draft) return plainTextResult;

  return {
    draft: null,
    found: jsonResult.found || anyResult.found,
    error: jsonResult.error ?? anyResult.error,
    source: jsonResult.source ?? anyResult.source,
    rawJson: jsonResult.rawJson ?? anyResult.rawJson ?? rawJsonCandidate,
    requiresReview: false,
  };
}

export function resolveTemplateDraftInfo({ actionDraft, text, templateTool }) {
  const strictExerciseIds = true;
  const actionResult = resolveTemplateDraftFromActionDraft(actionDraft, templateTool, {
    strictExerciseIds,
  });
  if (actionResult.draft) {
    return {
      draft: actionResult.draft,
      found: true,
      valid: !actionResult.requiresReview,
      error: actionResult.requiresReview
        ? "Some exercises need review before saving."
        : null,
      source: "actionDraft",
      rawJson: actionResult.rawJson,
    };
  }

  const textResult = resolveTemplateDraftFromText(text, templateTool, {
    strictExerciseIds,
  });
  if (textResult.draft) {
    return {
      draft: textResult.draft,
      found: true,
      valid: !textResult.requiresReview,
      error: textResult.requiresReview
        ? "Some exercises need review before saving."
        : null,
      source: textResult.source,
      rawJson: textResult.rawJson,
    };
  }

  return {
    draft: null,
    found: actionResult.found || textResult.found,
    valid: false,
    error: actionResult.error ?? textResult.error,
    source: actionResult.found ? "actionDraft" : textResult.source,
    rawJson: actionResult.rawJson ?? textResult.rawJson ?? null,
  };
}

export function buildTemplateDraftFromWorkoutPlan(workoutPlan, options = {}) {
  if (!workoutPlan || typeof workoutPlan !== "object") return null;
  const exercises = Array.isArray(workoutPlan.exercises) ? workoutPlan.exercises : [];
  if (!exercises.length) return null;

  const normalizedExercises = exercises
    .map((entry) => {
      const name = String(entry?.name ?? entry?.exerciseName ?? "").trim();
      if (!name) return null;
      const sets = parsePositiveInteger(entry?.sets, 3);
      const reps = parsePositiveInteger(entry?.reps, 10);
      return {
        name,
        exerciseName: name,
        sets,
        reps,
      };
    })
    .filter(Boolean);

  if (!normalizedExercises.length) return null;
  const fallbackName = String(options.fallbackName ?? "Coach Template").trim() || "Coach Template";
  const name =
    String(workoutPlan.name ?? workoutPlan.title ?? fallbackName).trim() || fallbackName;
  const spaceId = parsePositiveInteger(options.spaceId, null);

  return {
    name,
    exercises: normalizedExercises,
    ...(spaceId != null ? { spaceId } : {}),
  };
}
