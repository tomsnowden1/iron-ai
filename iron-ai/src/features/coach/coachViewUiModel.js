export const TEMPLATE_REQUEST_PROMPT_PREFIX =
  "Convert your last plan into the IronAI template JSON format.";

export function hasWorkoutCardPayload(role, exercises) {
  return role === "assistant" && Array.isArray(exercises) && exercises.length > 0;
}

export function resolveCoachDisplayText({ role, displayText, content, hasWorkoutCard }) {
  const rawText = String(displayText ?? content ?? "").trim();
  if (rawText) return rawText;
  if (role === "assistant" && hasWorkoutCard) return "Workout ready.";
  if (role === "assistant") return "Coach is preparing your response.";
  return String(content ?? "");
}

export function getCoachWorkoutActionConfig({ debugEnabled }) {
  return {
    primary: "Start workout",
    secondaryAdjust: "Adjust",
    secondaryAlternative: "Alternative option",
    tertiaryTemplate: "Save as template",
    showCopyJson: Boolean(debugEnabled),
    showPerMessageChangeGym: false,
  };
}

export const COACH_ACTION_PREVIEW_MIN_EXERCISES = 5;
export const COACH_ACTION_SHOW_ALL_THRESHOLD = 8;

export function shouldShowCoachActionShowAllToggle(totalExercises) {
  const total = Number(totalExercises);
  if (!Number.isFinite(total) || total <= 0) return false;
  return total > COACH_ACTION_SHOW_ALL_THRESHOLD;
}

export function getVisibleCoachActionExerciseCount(totalExercises, expanded) {
  const total = Number(totalExercises);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (expanded) return total;
  if (total <= COACH_ACTION_SHOW_ALL_THRESHOLD) return total;
  return Math.min(total, COACH_ACTION_PREVIEW_MIN_EXERCISES);
}

export function getSuggestedActionPrimaryLabel(actionDraftKind) {
  return actionDraftKind === "create_workout" ? "Open workout" : "Apply";
}

export function shouldShowSuggestedActionSaveTemplate(actionDraftKind) {
  return actionDraftKind === "create_workout";
}

function toFinitePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveExerciseLabel(entry, index, exerciseNameById) {
  const byDraft = String(entry?.name ?? entry?.exerciseName ?? "").trim();
  if (byDraft) return byDraft;
  const mapped = exerciseNameById?.get?.(entry?.exerciseId);
  const byLookup = String(mapped ?? "").trim();
  if (byLookup) return byLookup;
  return `Exercise ${index + 1}`;
}

function resolveSetMeta(entry) {
  const setCount = Array.isArray(entry?.sets)
    ? entry.sets.length
    : toFinitePositiveInt(entry?.sets);
  if (!setCount) return "sets as needed";
  const repsValue = Array.isArray(entry?.sets)
    ? entry.sets
        .map((set) => Number(set?.reps))
        .find((value) => Number.isFinite(value))
    : toFinitePositiveInt(entry?.reps);
  if (Number.isFinite(repsValue) && repsValue > 0) {
    return `${setCount} sets x ${repsValue} reps`;
  }
  return `${setCount} sets`;
}

export function buildCoachWorkoutSummaryFromDraft(draft, exerciseNameById = new Map()) {
  const payload = draft?.payload ?? {};
  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  if (!exercises.length) {
    return "Workout ready.";
  }
  const title =
    String(payload.name ?? payload.title ?? draft?.title ?? "Workout").trim() ||
    "Workout";
  const lines = exercises.map((entry, index) => {
    const name = resolveExerciseLabel(entry, index, exerciseNameById);
    const meta = resolveSetMeta(entry);
    return `${index + 1}. ${name} - ${meta}`;
  });
  return [`${title}`, ...lines].join("\n");
}

export function applyUniformSetCountToExercises(exercises, setCount) {
  const list = Array.isArray(exercises) ? exercises : [];
  const targetSetCount = toFinitePositiveInt(setCount);
  if (!targetSetCount) return list;
  return list.map((entry) => {
    const currentSets = Array.isArray(entry?.sets)
      ? entry.sets.filter((set) => set && typeof set === "object")
      : [];
    const templateSet = currentSets[0] ? { ...currentSets[0] } : {};
    const nextSets = Array.from({ length: targetSetCount }, (_, index) => {
      if (currentSets[index]) return { ...currentSets[index] };
      return { ...templateSet };
    });
    return {
      ...entry,
      sets: nextSets,
    };
  });
}

function toPositiveExerciseId(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveExerciseName(entry, exerciseId, exerciseNameById) {
  const fromEntry = String(entry?.name ?? entry?.exerciseName ?? "").trim();
  if (fromEntry) return fromEntry;
  const fromLookup = String(exerciseNameById?.get?.(exerciseId) ?? "").trim();
  if (fromLookup) return fromLookup;
  return `Exercise ${exerciseId}`;
}

export function buildSwapConfirmationMessage({
  previousDraft,
  nextDraft,
  exerciseNameById = new Map(),
}) {
  const prevExercises = Array.isArray(previousDraft?.payload?.exercises)
    ? previousDraft.payload.exercises
    : [];
  const nextExercises = Array.isArray(nextDraft?.payload?.exercises)
    ? nextDraft.payload.exercises
    : [];
  if (!prevExercises.length || prevExercises.length !== nextExercises.length) {
    return null;
  }

  let fromExerciseId = null;
  let toExerciseId = null;
  let fromEntry = null;
  let toEntry = null;

  for (let i = 0; i < prevExercises.length; i += 1) {
    const prevId = toPositiveExerciseId(prevExercises[i]?.exerciseId);
    const nextId = toPositiveExerciseId(nextExercises[i]?.exerciseId);
    if (prevId == null || nextId == null) return null;
    if (prevId === nextId) continue;
    if (fromExerciseId == null) {
      fromExerciseId = prevId;
      toExerciseId = nextId;
      fromEntry = prevExercises[i];
      toEntry = nextExercises[i];
      continue;
    }
    if (fromExerciseId !== prevId || toExerciseId !== nextId) {
      return null;
    }
  }

  if (fromExerciseId == null || toExerciseId == null || fromExerciseId === toExerciseId) {
    return null;
  }

  const fromName = resolveExerciseName(fromEntry, fromExerciseId, exerciseNameById);
  const toName = resolveExerciseName(toEntry, toExerciseId, exerciseNameById);
  return `Replaced ${fromName} -> ${toName}`;
}

const JSON_CODE_BLOCK_REGEX = /```json[\s\S]*?```/gi;
const JSON_PLUMBING_LINE_REGEX =
  /^.*(\bjson\b|fenced|code block|template format|template payload).*$\n?/gim;
const TEMPLATE_INTENT_REGEX =
  /\b(make|create|save|turn)\b[\w\s]*\btemplate\b|\btemplate\b[\w\s]*\b(save|create|make)\b/i;
const START_WORKOUT_INTENT_REGEX =
  /\b(start|begin|launch|run)\b[\w\s]*\b(workout|session)\b|\badd\b[\w\s]*\btoday\b/i;
const WORKOUT_ADJUST_INTENT_REGEX =
  /\b(make it|adjust|more|less|add|remove|replace|swap|change|include|exclude|without|shorter|longer|sets?|reps?|exercise(?:s)?|quads?|hamstrings?|glutes?|legs?|chest|back|shoulders?|triceps?|biceps?)\b/i;

export function sanitizeCoachAssistantText(value) {
  const text = String(value ?? "");
  const withoutBlocks = text.replace(JSON_CODE_BLOCK_REGEX, "");
  const withoutPlumbing = withoutBlocks.replace(JSON_PLUMBING_LINE_REGEX, "");
  return withoutPlumbing.replace(/\n{3,}/g, "\n\n").trim();
}

export function isTemplateIntentText(value) {
  return TEMPLATE_INTENT_REGEX.test(String(value ?? ""));
}

export function isStartWorkoutIntentText(value) {
  return START_WORKOUT_INTENT_REGEX.test(String(value ?? ""));
}

export function shouldForceWorkoutResponseMode({ userMessage, hasVisibleWorkoutDraft }) {
  if (!hasVisibleWorkoutDraft) return false;
  const text = String(userMessage ?? "").trim();
  if (!text) return false;
  if (isTemplateIntentText(text) || isStartWorkoutIntentText(text)) return false;
  return WORKOUT_ADJUST_INTENT_REGEX.test(text);
}

export function resolveCoachErrorMessage({ err, accessState }) {
  if (!accessState?.canChat) return accessState?.message ?? "";

  const status = Number(err?.status);
  const rawMessage = String(err?.message ?? "").trim();

  if (accessState?.keyMode === "server" && (status === 401 || status === 403)) {
    return "Coach server is disabled in production. Remove ALLOW_COACH_PROD=false in Vercel to enable Coach.";
  }

  if (accessState?.keyMode === "server" && status >= 500) {
    if (/openai_api_key/i.test(rawMessage)) {
      return "Coach server is missing OPENAI_API_KEY. Add it to your local env and restart the dev server.";
    }
    if (rawMessage) {
      return `Coach server error: ${rawMessage}`;
    }
  }

  if (status === 401 || status === 403) {
    return "That API key was rejected. Update it in Settings.";
  }
  if (status === 429) {
    return "OpenAI rate limit hit. Please wait and try again.";
  }
  if (status >= 500) {
    return rawMessage || "OpenAI is having trouble right now. Please try again soon.";
  }
  if (!status) {
    return "Network error. Check your connection and try again.";
  }
  return "Couldn't reach the coach. Check your connection and try again.";
}

export function isInternalPromptMessage(message) {
  if (!message || message.role !== "user") return false;
  return String(message.content ?? "").includes(TEMPLATE_REQUEST_PROMPT_PREFIX);
}

const WORKOUT_REQUEST_REGEX = /\b(workout|routine|session|plan)\b/i;

export function hasWorkoutIntent(text) {
  return WORKOUT_REQUEST_REGEX.test(String(text ?? ""));
}

function includesAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function resolveThemeKeywords(text) {
  const input = String(text ?? "").toLowerCase();
  if (includesAny(input, ["leg", "quad", "hamstring", "glute", "calf"])) {
    return {
      name: "Leg Workout Draft",
      groups: ["legs", "quads", "hamstrings", "glutes", "calves"],
      names: ["squat", "lunge", "deadlift", "leg", "hip thrust", "calf"],
    };
  }
  if (includesAny(input, ["push", "chest", "triceps", "shoulder"])) {
    return {
      name: "Push Workout Draft",
      groups: ["chest", "triceps", "shoulders"],
      names: ["press", "dip", "fly", "push"],
    };
  }
  if (includesAny(input, ["pull", "back", "biceps"])) {
    return {
      name: "Pull Workout Draft",
      groups: ["back", "biceps", "traps"],
      names: ["row", "pull", "curl", "lat"],
    };
  }
  return {
    name: "Workout Draft",
    groups: [],
    names: [],
  };
}

export function buildHeuristicWorkoutDraft({ userMessage, exercises, spaceId }) {
  if (!hasWorkoutIntent(userMessage)) return null;
  const theme = resolveThemeKeywords(userMessage);
  const list = Array.isArray(exercises) ? exercises : [];
  if (!list.length) {
    const fallbackByTheme = {
      "Leg Workout Draft": [
        { name: "Goblet Squat", sets: 3, reps: 12 },
        { name: "Romanian Deadlift", sets: 3, reps: 10 },
        { name: "Walking Lunge", sets: 3, reps: 12 },
        { name: "Hip Thrust", sets: 3, reps: 10 },
        { name: "Leg Press", sets: 3, reps: 12 },
        { name: "Standing Calf Raise", sets: 3, reps: 15 },
      ],
      "Push Workout Draft": [
        { name: "Bench Press", sets: 4, reps: 8 },
        { name: "Incline Dumbbell Press", sets: 3, reps: 10 },
        { name: "Overhead Press", sets: 3, reps: 8 },
        { name: "Lateral Raise", sets: 3, reps: 12 },
        { name: "Cable Fly", sets: 3, reps: 12 },
        { name: "Triceps Pushdown", sets: 3, reps: 12 },
      ],
      "Pull Workout Draft": [
        { name: "Lat Pulldown", sets: 4, reps: 10 },
        { name: "Seated Cable Row", sets: 3, reps: 10 },
        { name: "Chest Supported Row", sets: 3, reps: 10 },
        { name: "Face Pull", sets: 3, reps: 15 },
        { name: "Dumbbell Curl", sets: 3, reps: 12 },
        { name: "Hammer Curl", sets: 3, reps: 12 },
      ],
      "Workout Draft": [
        { name: "Squat", sets: 3, reps: 10 },
        { name: "Bench Press", sets: 3, reps: 10 },
        { name: "Row", sets: 3, reps: 10 },
        { name: "Romanian Deadlift", sets: 3, reps: 10 },
        { name: "Overhead Press", sets: 3, reps: 8 },
        { name: "Plank", sets: 3, reps: 45 },
      ],
    };
    const fallbackExercises =
      fallbackByTheme[theme.name] ?? fallbackByTheme["Workout Draft"];
    return {
      name: theme.name,
      exercises: fallbackExercises.map((entry) => ({
        ...entry,
        exerciseName: entry.name,
      })),
      ...(spaceId != null ? { spaceId } : {}),
    };
  }

  const scored = list
    .map((exercise) => {
      const name = String(exercise?.name ?? "");
      const normalizedName = name.toLowerCase();
      const muscle = String(exercise?.muscle_group ?? "").toLowerCase();
      let score = 0;
      if (theme.groups.length && includesAny(muscle, theme.groups)) score += 3;
      if (theme.names.length && includesAny(normalizedName, theme.names)) score += 2;
      if (!theme.groups.length && !theme.names.length) score += 1;
      return { exercise, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.exercise?.name ?? "").localeCompare(String(b.exercise?.name ?? "")));

  const fallback = scored.length ? scored : list.map((exercise) => ({ exercise, score: 1 }));
  const selected = fallback.slice(0, 6).map((entry) => entry.exercise);
  if (!selected.length) return null;

  return {
    name: theme.name,
    exercises: selected.map((exercise) => ({
      exerciseId: exercise.id,
      name: String(exercise?.name ?? "").trim(),
      exerciseName: String(exercise?.name ?? "").trim(),
      sets: Number.isFinite(Number(exercise?.default_sets)) ? Number(exercise.default_sets) : 3,
      reps: Number.isFinite(Number(exercise?.default_reps)) ? Number(exercise.default_reps) : 10,
    })),
    ...(spaceId != null ? { spaceId } : {}),
  };
}
