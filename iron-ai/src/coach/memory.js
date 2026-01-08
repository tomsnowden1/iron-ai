const MAX_LIST_ITEMS = 12;

export function getDefaultCoachMemory() {
  return {
    goals: [],
    preferences: {
      daysPerWeek: null,
      equipment: [],
      injuriesToAvoid: [],
      favoriteExercises: [],
    },
    communicationStyle: "neutral",
    notes: "",
  };
}

export function normalizeCoachMemory(input) {
  const base = getDefaultCoachMemory();
  if (!input || typeof input !== "object") return base;
  const memory = { ...base, ...input };
  memory.goals = Array.isArray(input.goals) ? input.goals : [];
  memory.preferences = { ...base.preferences, ...(input.preferences ?? {}) };
  memory.preferences.equipment = Array.isArray(memory.preferences.equipment)
    ? memory.preferences.equipment
    : [];
  memory.preferences.injuriesToAvoid = Array.isArray(memory.preferences.injuriesToAvoid)
    ? memory.preferences.injuriesToAvoid
    : [];
  memory.preferences.favoriteExercises = Array.isArray(memory.preferences.favoriteExercises)
    ? memory.preferences.favoriteExercises
    : [];
  memory.communicationStyle = ["gentle", "tough", "neutral"].includes(input.communicationStyle)
    ? input.communicationStyle
    : base.communicationStyle;
  memory.notes = typeof input.notes === "string" ? input.notes : "";
  return memory;
}

export function summarizeCoachMemory(memory) {
  const safe = normalizeCoachMemory(memory);
  return {
    goals: safe.goals.slice(0, 5),
    preferences: {
      daysPerWeek: safe.preferences.daysPerWeek ?? null,
      equipment: safe.preferences.equipment.slice(0, MAX_LIST_ITEMS),
      injuriesToAvoid: safe.preferences.injuriesToAvoid.slice(0, MAX_LIST_ITEMS),
      favoriteExercises: safe.preferences.favoriteExercises.slice(0, MAX_LIST_ITEMS),
    },
    communicationStyle: safe.communicationStyle,
    notes: safe.notes.slice(0, 240),
  };
}

export function upsertGoal(memory, goalType, value, notes) {
  const safe = normalizeCoachMemory(memory);
  const goals = Array.isArray(safe.goals) ? [...safe.goals] : [];
  const index = goals.findIndex(
    (goal) => String(goal?.type ?? "").toLowerCase() === goalType.toLowerCase()
  );
  const nextGoal = {
    type: goalType,
    value,
    notes: notes ?? "",
  };
  if (index >= 0) {
    goals[index] = { ...goals[index], ...nextGoal };
  } else {
    goals.push(nextGoal);
  }
  return { ...safe, goals };
}

export function formatCoachMemory(memory) {
  return JSON.stringify(normalizeCoachMemory(memory), null, 2);
}
