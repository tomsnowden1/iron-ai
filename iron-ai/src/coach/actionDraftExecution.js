import { ActionDraftKinds, ActionDraftSchema } from "./actionDraftContract";
import {
  createWorkoutSpace,
  db,
  getAllExercises,
  getWorkoutSpaceById,
  listEquipment,
  listTemplates,
  listWorkoutSpaces,
} from "../db";

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimText(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeName({ name, title, fallback }) {
  return trimText(name) || trimText(title) || trimText(fallback) || "";
}

function resolveUniqueName(name, existingNames) {
  const base = String(name ?? "").trim();
  const existing = new Set(
    (existingNames ?? [])
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (!base) return { name: "", changed: false };
  const lowered = base.toLowerCase();
  if (!existing.has(lowered)) return { name: base, changed: false };
  let suffix = 2;
  let candidate = `${base} (${suffix})`;
  while (existing.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  return { name: candidate, changed: true };
}

function normalizeSetEntry(set) {
  if (!set || typeof set !== "object") return {};
  const reps = parseNumber(set.reps);
  const weight = parseNumber(set.weight);
  const duration = parseNumber(set.duration);
  const rpe = parseNumber(set.rpe);
  return {
    ...(reps != null ? { reps } : {}),
    ...(weight != null ? { weight } : {}),
    ...(duration != null ? { duration } : {}),
    ...(rpe != null ? { rpe } : {}),
  };
}

function normalizeExerciseEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const exerciseId = parseId(entry.exerciseId);
  if (!exerciseId) return null;
  const notes = trimText(entry.notes);
  const rawSets = Array.isArray(entry.sets)
    ? entry.sets
    : parseNumber(entry.sets) != null
      ? Array.from({ length: Math.max(0, Math.floor(Number(entry.sets))) }, () => ({}))
      : [];
  const normalizedSets = rawSets.map((set) => normalizeSetEntry(set));
  return {
    exerciseId,
    ...(normalizedSets.length ? { sets: normalizedSets } : {}),
    ...(notes ? { notes } : {}),
  };
}

function resolveTargetReps(sets, fallback) {
  if (!Array.isArray(sets) || sets.length === 0) return fallback;
  const repsValues = sets
    .map((set) => parseNumber(set?.reps))
    .filter((value) => value != null);
  if (repsValues.length === 0) return fallback;
  const unique = new Set(repsValues);
  if (unique.size === 1) return repsValues[0];
  return repsValues[0];
}

function resolveTargetSets(sets, fallback) {
  if (Array.isArray(sets) && sets.length) return sets.length;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 3;
}

async function resolveRestDefaults() {
  const settings = await db.table("settings").get(1);
  const parsed = Number.parseInt(settings?.rest_default_seconds ?? 60, 10);
  return {
    restDefaultSeconds: Number.isFinite(parsed) ? Math.max(0, parsed) : 60,
  };
}

function formatZodIssues(error) {
  if (!error?.issues?.length) return ["Invalid action draft."];
  return error.issues.map((issue) => issue.message);
}

export async function validateActionDraft(draft, options = {}) {
  const parsed = ActionDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { valid: false, errors: formatZodIssues(parsed.error), warnings: [] };
  }

  const normalizedDraft = { ...parsed.data, payload: { ...(parsed.data.payload ?? {}) } };
  const errors = [];
  const warnings = [];
  const defaultGymId = options.defaultGymId ?? null;

  if (
    parsed.data.kind === ActionDraftKinds.create_workout ||
    parsed.data.kind === ActionDraftKinds.create_template
  ) {
    const payload = parsed.data.payload ?? {};
    const name = normalizeName({
      name: payload.name,
      title: payload.title,
      fallback: parsed.data.title,
    });
    if (!name) errors.push("Provide a name or title for the draft.");

    const gymId = parseId(payload.gymId ?? payload.spaceId ?? defaultGymId);
    normalizedDraft.payload.gymId = gymId ?? null;
    normalizedDraft.payload.name = name || parsed.data.title;

    const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
    const normalizedExercises = exercises
      .map((entry) => normalizeExerciseEntry(entry))
      .filter(Boolean);
    if (!normalizedExercises.length) {
      errors.push("Include at least one exercise in the draft.");
    }
    normalizedDraft.payload.exercises = normalizedExercises;

    const availableExercises = await getAllExercises();
    const validIds = new Set(availableExercises.map((exercise) => exercise.id));
    const invalidIds = normalizedExercises
      .map((exercise) => exercise.exerciseId)
      .filter((id) => !validIds.has(id));
    if (invalidIds.length) {
      errors.push(`Unknown exercise IDs: ${invalidIds.join(", ")}.`);
    }

    if (gymId != null) {
      const space = await getWorkoutSpaceById(gymId);
      if (!space) errors.push("Selected gym does not exist.");
    }

    if (parsed.data.kind === ActionDraftKinds.create_template) {
      const templates = await listTemplates();
      const existingNames = templates.map((tpl) => tpl?.name ?? "");
      const uniqueName = resolveUniqueName(name, existingNames);
      if (uniqueName.changed) {
        warnings.push(
          `Template name already exists. Will create "${uniqueName.name}".`
        );
        normalizedDraft.payload.name = uniqueName.name;
      }
    }
  }

  if (parsed.data.kind === ActionDraftKinds.create_gym) {
    const payload = parsed.data.payload ?? {};
    const name = normalizeName({
      name: payload.name,
      title: payload.title,
      fallback: parsed.data.title,
    });
    if (!name) errors.push("Provide a name for the gym.");

    const spaces = await listWorkoutSpaces();
    const existingNames = spaces.map((space) => space?.name ?? "");
    const uniqueName = resolveUniqueName(name, existingNames);
    if (uniqueName.changed) {
      warnings.push(`Gym name already exists. Will create "${uniqueName.name}".`);
      normalizedDraft.payload.name = uniqueName.name;
    } else {
      normalizedDraft.payload.name = name;
    }

    const equipmentIds = Array.isArray(payload.equipmentIds) ? payload.equipmentIds : [];
    if (equipmentIds.length) {
      const equipment = await listEquipment();
      const validIds = new Set(equipment.map((item) => item.id));
      const filtered = equipmentIds.filter((id) => validIds.has(id));
      if (filtered.length !== equipmentIds.length) {
        warnings.push("Some equipment IDs were not recognized and will be skipped.");
      }
      normalizedDraft.payload.equipmentIds = filtered;
    } else {
      normalizedDraft.payload.equipmentIds = [];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedDraft: errors.length === 0 ? normalizedDraft : null,
  };
}

export async function createWorkoutFromDraft(draft) {
  const payload = draft?.payload ?? {};
  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const { restDefaultSeconds } = await resolveRestDefaults();
  const exerciseList = await getAllExercises();
  const exerciseMap = new Map(exerciseList.map((exercise) => [exercise.id, exercise]));
  const nowIso = new Date().toISOString();
  const sessionNote = trimText(payload.name) ?? "";
  const spaceId = payload.gymId ?? null;

  const workoutId = await db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    async () => {
      const id = await db.table("workoutSessions").add({
        startedAt: nowIso,
        finishedAt: null,
        templateId: null,
        spaceId,
        sessionNote,
        sessionReflection: "",
        exerciseNotes: {},
      });
      await db.table("workouts").put({
        id,
        startedAt: nowIso,
        finishedAt: null,
        templateId: null,
        spaceId,
        sessionNote,
        sessionReflection: "",
        exerciseNotes: {},
      });
      return id;
    }
  );

  await db.transaction(
    "rw",
    db.table("workoutItems"),
    db.table("workoutSets"),
    async () => {
      for (let i = 0; i < exercises.length; i += 1) {
        const entry = exercises[i];
        const exercise = exerciseMap.get(entry.exerciseId);
        const defaultSets = exercise?.default_sets ?? 3;
        const defaultReps = exercise?.default_reps ?? null;
        const targetSets = resolveTargetSets(entry.sets, defaultSets);
        const targetReps = resolveTargetReps(entry.sets, defaultReps);
        const workoutItemId = await db.table("workoutItems").add({
          workoutId,
          exerciseId: entry.exerciseId,
          sortOrder: i,
          targetSets,
          targetReps,
          restSeconds: restDefaultSeconds,
          notes: entry.notes ?? "",
        });

        if (Array.isArray(entry.sets) && entry.sets.length) {
          for (let s = 0; s < entry.sets.length; s += 1) {
            const set = entry.sets[s] ?? {};
            await db.table("workoutSets").add({
              workoutItemId,
              setNumber: s + 1,
              weight: set.weight != null ? String(set.weight) : "",
              reps: set.reps != null ? String(set.reps) : "",
              isWarmup: false,
            });
          }
        } else {
          for (let s = 1; s <= targetSets; s += 1) {
            await db.table("workoutSets").add({
              workoutItemId,
              setNumber: s,
              weight: "",
              reps: targetReps == null ? "" : String(targetReps),
              isWarmup: false,
            });
          }
        }
      }
    }
  );

  return workoutId;
}

export async function createTemplateFromDraft(draft) {
  const payload = draft?.payload ?? {};
  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const exerciseList = await getAllExercises();
  const exerciseMap = new Map(exerciseList.map((exercise) => [exercise.id, exercise]));
  const now = Date.now();

  const result = await db.transaction(
    "rw",
    db.table("templates"),
    db.table("templateItems"),
    async () => {
      const templateId = await db.table("templates").add({
        name: payload.name ?? "Untitled Template",
        spaceId: payload.gymId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      for (let i = 0; i < exercises.length; i += 1) {
        const entry = exercises[i];
        const exercise = exerciseMap.get(entry.exerciseId);
        const defaultSets = exercise?.default_sets ?? 3;
        const defaultReps = exercise?.default_reps ?? null;
        const targetSets = resolveTargetSets(entry.sets, defaultSets);
        const targetReps = resolveTargetReps(entry.sets, defaultReps);
        await db.table("templateItems").add({
          templateId,
          exerciseId: entry.exerciseId,
          sortOrder: i,
          targetSets,
          targetReps,
          notes: entry.notes ?? "",
          createdAt: now,
          updatedAt: now,
        });
      }
      return templateId;
    }
  );

  return result;
}

export async function createGymFromDraft(draft) {
  const payload = draft?.payload ?? {};
  const name = String(payload.name ?? "New Space");
  const equipmentIds = Array.isArray(payload.equipmentIds) ? payload.equipmentIds : [];
  return createWorkoutSpace({ name, equipmentIds });
}

export async function executeActionDraft(draft) {
  if (!draft) throw new Error("No action draft provided.");
  if (draft.kind === ActionDraftKinds.create_workout) {
    return { kind: draft.kind, id: await createWorkoutFromDraft(draft) };
  }
  if (draft.kind === ActionDraftKinds.create_template) {
    return { kind: draft.kind, id: await createTemplateFromDraft(draft) };
  }
  if (draft.kind === ActionDraftKinds.create_gym) {
    return { kind: draft.kind, id: await createGymFromDraft(draft) };
  }
  throw new Error("Unsupported action draft kind.");
}
