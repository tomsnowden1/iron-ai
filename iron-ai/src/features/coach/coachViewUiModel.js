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
