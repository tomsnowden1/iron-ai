import Dexie from "dexie";
import starterExercises from "./data/starterExercises.json";
import { EQUIPMENT_CATALOG } from "./equipment/catalog";
import { inferExerciseEquipment } from "./equipment/inference";
import { computeStableId } from "./seed/seedUtils";

export const db = new Dexie("ironAI");
const COACH_ACTIVE_GYM_KEY = "coach.activeGymId.v1";

function normalizeCoachGymId(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function readCoachGymFromStorage(storage) {
  if (!storage) return { value: null, exists: false };
  const raw = storage.getItem(COACH_ACTIVE_GYM_KEY);
  if (raw == null) return { value: null, exists: false };
  try {
    const parsed = JSON.parse(raw);
    return { value: normalizeCoachGymId(parsed), exists: true };
  } catch {
    return { value: null, exists: true };
  }
}

function writeCoachGymToStorage(storage, value) {
  if (!storage) return;
  storage.setItem(COACH_ACTIVE_GYM_KEY, JSON.stringify(value));
}

/**
 * v2 (existing)
 */
db.version(2)
  .stores({
    exercises:
      "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",
  })
  .upgrade(async (tx) => {
    const now = Date.now();
    await tx.table("templates").toCollection().modify((t) => {
      if (t.createdAt == null) t.createdAt = now;
      if (t.updatedAt == null) t.updatedAt = now;
    });
  });

/**
 * v3 (NEW): workouts (legacy session table)
 */
db.version(3)
  .stores({
    exercises:
      "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // NEW tables
    workouts: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",
  })
  .upgrade(async (tx) => {
    const now = Date.now();
    await tx.table("templates").toCollection().modify((t) => {
      if (t.createdAt == null) t.createdAt = now;
      if (t.updatedAt == null) t.updatedAt = now;
    });
  });

/**
 * v4 (NEW): workoutSessions table (backward-compatible with workouts)
 */
db.version(4)
  .stores({
    exercises:
      "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // Legacy sessions (kept for backward compatibility)
    workouts: "++id, startedAt, finishedAt, templateId",
    // Canonical sessions table
    workoutSessions: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",
  })
  .upgrade(async (tx) => {
    const workouts = await tx.table("workouts").toArray();
    if (!workouts.length) return;

    const existingIds = new Set(
      await tx.table("workoutSessions").toCollection().primaryKeys()
    );

    const missing = workouts.filter((w) => !existingIds.has(w.id));
    if (!missing.length) return;

    await tx.table("workoutSessions").bulkAdd(
      missing.map((w) => ({
        id: w.id,
        startedAt: w.startedAt ?? null,
        finishedAt: w.finishedAt ?? null,
        templateId: w.templateId ?? null,
      }))
    );
  });

/**
 * v5 (NEW): plannedWorkouts table for lightweight scheduling
 */
db.version(5).stores({
  exercises:
    "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
  logs: "++id, date",
  settings: "id, api_key, coach_persona",
  templates: "++id, name, createdAt, updatedAt",
  templateItems:
    "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

  // Legacy sessions (kept for backward compatibility)
  workouts: "++id, startedAt, finishedAt, templateId",
  // Canonical sessions table
  workoutSessions: "++id, startedAt, finishedAt, templateId",
  workoutItems:
    "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
  workoutSets: "++id, workoutItemId, setNumber",

  plannedWorkouts: "++id, date, createdAt, updatedAt, source, templateId",
});

/**
 * v6 (NEW): workoutSpaces + equipment catalog
 */
db.version(6)
  .stores({
    exercises:
      "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // Legacy sessions (kept for backward compatibility)
    workouts: "++id, startedAt, finishedAt, templateId",
    // Canonical sessions table
    workoutSessions: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",

    plannedWorkouts: "++id, date, createdAt, updatedAt, source, templateId",

    equipment: "id, name, category, isPortable",
    workoutSpaces: "++id, name, isDefault, isTemporary, expiresAt, updatedAt",
  })
  .upgrade(async (tx) => {
    const now = Date.now();

    const equipmentTable = tx.table("equipment");
    const existingEquipment = await equipmentTable.toArray();
    if (!existingEquipment.length) {
      await equipmentTable.bulkPut(EQUIPMENT_CATALOG);
    } else {
      const existingIds = new Set(existingEquipment.map((item) => item.id));
      const missingEquipment = EQUIPMENT_CATALOG.filter((item) => !existingIds.has(item.id));
      if (missingEquipment.length) {
        await equipmentTable.bulkPut(missingEquipment);
      }
    }

    const spacesTable = tx.table("workoutSpaces");
    const spaces = await spacesTable.toArray();
    if (!spaces.length) {
      await spacesTable.add({
        name: "Default Gym",
        description: "All equipment available.",
        equipmentIds: EQUIPMENT_CATALOG.map((item) => item.id),
        isDefault: true,
        isTemporary: false,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx.table("exercises").toCollection().modify((exercise) => {
      const required = Array.isArray(exercise.requiredEquipmentIds)
        ? exercise.requiredEquipmentIds
        : [];
      const optional = Array.isArray(exercise.optionalEquipmentIds)
        ? exercise.optionalEquipmentIds
        : null;
      if (required.length && optional !== null) return;
      const inferred = inferExerciseEquipment(exercise);
      if (!required.length) {
        exercise.requiredEquipmentIds = inferred.requiredEquipmentIds;
      }
      if (optional === null) {
        exercise.optionalEquipmentIds = inferred.optionalEquipmentIds;
      }
    });
  });

/**
 * v7 (NEW): extended exercise metadata
 */
db.version(7)
  .stores({
    exercises:
      "++id, name, default_sets, default_reps, muscle_group, video_url, is_custom",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // Legacy sessions (kept for backward compatibility)
    workouts: "++id, startedAt, finishedAt, templateId",
    // Canonical sessions table
    workoutSessions: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",

    plannedWorkouts: "++id, date, createdAt, updatedAt, source, templateId",

    equipment: "id, name, category, isPortable",
    workoutSpaces: "++id, name, isDefault, isTemporary, expiresAt, updatedAt",
  })
  .upgrade(async (tx) => {
    await tx.table("exercises").toCollection().modify((exercise) => {
      const primary =
        Array.isArray(exercise.primaryMuscles) && exercise.primaryMuscles.length
          ? exercise.primaryMuscles
          : [];
      if (!primary.length) {
        const legacy = String(exercise.muscle_group ?? "").trim();
        exercise.primaryMuscles = legacy ? [legacy] : [];
      }
      if (!Array.isArray(exercise.secondaryMuscles)) {
        exercise.secondaryMuscles = [];
      }
      if (!Array.isArray(exercise.instructions)) {
        exercise.instructions = [];
      }
      if (!Array.isArray(exercise.commonMistakes)) {
        exercise.commonMistakes = [];
      }
      if (!Array.isArray(exercise.progressions)) {
        exercise.progressions = [];
      }
      if (!Array.isArray(exercise.regressions)) {
        exercise.regressions = [];
      }
      if (!Array.isArray(exercise.aliases)) {
        exercise.aliases = [];
      }

      const hasRequired =
        Array.isArray(exercise.requiredEquipmentIds) &&
        exercise.requiredEquipmentIds.length > 0;
      const hasOptional = Array.isArray(exercise.optionalEquipmentIds);
      if (!hasRequired || !hasOptional) {
        const inferred = inferExerciseEquipment(exercise);
        if (!hasRequired) {
          exercise.requiredEquipmentIds = inferred.requiredEquipmentIds;
        }
        if (!hasOptional) {
          exercise.optionalEquipmentIds = inferred.optionalEquipmentIds;
        }
      }

      if (!exercise.media || typeof exercise.media !== "object") {
        exercise.media = {};
      }
      if (exercise.video_url && !exercise.media.videoUrl) {
        exercise.media.videoUrl = exercise.video_url;
      }
      if (exercise.videoUrl && !exercise.media.videoUrl) {
        exercise.media.videoUrl = exercise.videoUrl;
      }
    });
  });

/**
 * v8 (NEW): exercise library seed + meta table
 */
db.version(8)
  .stores({
    exercises:
      "++id, slug, name, default_sets, default_reps, muscle_group, video_url, is_custom, status, *aliases, *primaryMuscles, *secondaryMuscles, *equipment",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // Legacy sessions (kept for backward compatibility)
    workouts: "++id, startedAt, finishedAt, templateId",
    // Canonical sessions table
    workoutSessions: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",

    plannedWorkouts: "++id, date, createdAt, updatedAt, source, templateId",

    equipment: "id, name, category, isPortable",
    workoutSpaces: "++id, name, isDefault, isTemporary, expiresAt, updatedAt",
    meta: "key",
  })
  .upgrade(async (tx) => {
    const now = Date.now();
    const slugify = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    await tx.table("exercises").toCollection().modify((exercise) => {
      if (!exercise.slug) {
        const baseSlug = slugify(exercise.name ?? "");
        const idPrefix = exercise.id != null ? String(exercise.id) : "";
        if (baseSlug && idPrefix) {
          exercise.slug = `${idPrefix}-${baseSlug}`;
        } else {
          exercise.slug = baseSlug || idPrefix || "exercise";
        }
      }
      if (!exercise.status) exercise.status = "extended";
      if (!Array.isArray(exercise.aliases)) exercise.aliases = [];
      if (!Array.isArray(exercise.primaryMuscles)) {
        const legacy = String(exercise.muscle_group ?? "").trim();
        exercise.primaryMuscles = legacy ? [legacy] : [];
      }
      if (!Array.isArray(exercise.secondaryMuscles)) exercise.secondaryMuscles = [];
      if (!Array.isArray(exercise.instructions)) exercise.instructions = [];
      if (!Array.isArray(exercise.gotchas)) exercise.gotchas = [];
      if (!Array.isArray(exercise.equipment)) exercise.equipment = [];
      if (!exercise.youtubeSearchQuery && exercise.name) {
        exercise.youtubeSearchQuery = `${exercise.name} exercise form cues`;
      }
      if (exercise.youtubeVideoId === undefined) {
        exercise.youtubeVideoId = null;
      }
      if (!exercise.source) {
        exercise.source = exercise.is_custom ? "user" : "starter";
      }
      if (exercise.createdAt == null) exercise.createdAt = now;
      if (exercise.updatedAt == null) exercise.updatedAt = now;
    });
  });

/**
 * v9 (NEW): stable exercise IDs for seed imports
 */
db.version(9)
  .stores({
    exercises:
      "++id, &stableId, slug, name, default_sets, default_reps, muscle_group, video_url, is_custom, status, *aliases, *primaryMuscles, *secondaryMuscles, *equipment",
    logs: "++id, date",
    settings: "id, api_key, coach_persona",
    templates: "++id, name, createdAt, updatedAt",
    templateItems:
      "++id, templateId, exerciseId, sortOrder, targetSets, targetReps, notes, createdAt, updatedAt, [templateId+exerciseId]",

    // Legacy sessions (kept for backward compatibility)
    workouts: "++id, startedAt, finishedAt, templateId",
    // Canonical sessions table
    workoutSessions: "++id, startedAt, finishedAt, templateId",
    workoutItems:
      "++id, workoutId, exerciseId, sortOrder, targetSets, targetReps, notes, [workoutId+exerciseId]",
    workoutSets: "++id, workoutItemId, setNumber",

    plannedWorkouts: "++id, date, createdAt, updatedAt, source, templateId",

    equipment: "id, name, category, isPortable",
    workoutSpaces: "++id, name, isDefault, isTemporary, expiresAt, updatedAt",
    meta: "key",
  })
  .upgrade(async (tx) => {
    const exercises = await tx.table("exercises").toArray();
    const updated = await Promise.all(
      exercises.map(async (exercise) => {
        if (exercise.stableId) return exercise;
        const stableId = await computeStableId({
          externalId: exercise.externalId ?? exercise.sourceKey ?? null,
          name: exercise.name,
          equipment: exercise.equipment ?? [],
          primaryMuscles: exercise.primaryMuscles ?? [],
          pattern: exercise.pattern,
          category: exercise.category,
        });
        return { ...exercise, stableId };
      })
    );
    await tx.table("exercises").bulkPut(updated);
  });

// Seed only on first DB creation
db.on("populate", async () => {
  const now = Date.now();
  const slugify = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  await db.table("equipment").bulkPut(EQUIPMENT_CATALOG);
  await db.table("workoutSpaces").add({
    name: "Default Gym",
    description: "All equipment available.",
    equipmentIds: EQUIPMENT_CATALOG.map((item) => item.id),
    isDefault: true,
    isTemporary: false,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const starterRecords = await Promise.all(
    starterExercises.map(async (ex) => {
      const name = ex.name ?? "Exercise";
      const baseSlug = slugify(name);
      const primaryMuscles =
        Array.isArray(ex.primaryMuscles) && ex.primaryMuscles.length
          ? ex.primaryMuscles
          : ex.muscle_group
            ? [ex.muscle_group]
            : [];
      const media =
        ex.media ??
        (ex.video_url || ex.videoUrl
          ? { videoUrl: ex.video_url ?? ex.videoUrl }
          : {});
      const stableId = await computeStableId({
        externalId: ex.externalId ?? ex.sourceKey ?? null,
        name,
        equipment: ex.equipment ?? [],
        primaryMuscles,
        pattern: ex.pattern,
        category: ex.category,
      });
      return {
        ...ex,
        slug: ex.slug ?? (baseSlug || "exercise"),
        primaryMuscles,
        secondaryMuscles: Array.isArray(ex.secondaryMuscles) ? ex.secondaryMuscles : [],
        instructions: Array.isArray(ex.instructions) ? ex.instructions : [],
        commonMistakes: Array.isArray(ex.commonMistakes) ? ex.commonMistakes : [],
        gotchas: Array.isArray(ex.gotchas) ? ex.gotchas : [],
        progressions: Array.isArray(ex.progressions) ? ex.progressions : [],
        regressions: Array.isArray(ex.regressions) ? ex.regressions : [],
        aliases: Array.isArray(ex.aliases) ? ex.aliases : [],
        equipment: Array.isArray(ex.equipment) ? ex.equipment : [],
        status: ex.status ?? "extended",
        youtubeSearchQuery:
          ex.youtubeSearchQuery ?? `${name ?? "exercise"} exercise form cues`,
        youtubeVideoId: ex.youtubeVideoId ?? null,
        media,
        stableId,
        source: ex.source ?? "starter",
        sourceKey: ex.sourceKey ?? ex.externalId ?? null,
        is_custom: false,
        ...inferExerciseEquipment(ex),
        createdAt: now,
        updatedAt: now,
      };
    })
  );
  await db.table("exercises").bulkAdd(starterRecords);
});

// --------------------
// Templates API helpers
// --------------------

export async function createTemplate({ name, spaceId = null }) {
  const now = Date.now();
  const safeName = String(name ?? "").trim() || "Untitled Template";
  const parsedSpaceId = spaceId == null ? null : Number(spaceId);
  return db.table("templates").add({
    name: safeName,
    spaceId: Number.isNaN(parsedSpaceId) ? null : parsedSpaceId,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Canonical: returns { template, items: [{...templateItem, exercise}] }
 * This matches what TemplateEditor.jsx expects.
 */
export async function getTemplateWithDetails(templateId) {
  const template = await db.table("templates").get(templateId);
  if (!template) return null;

  const items = await db
    .table("templateItems")
    .where({ templateId })
    .sortBy("sortOrder");

  const exerciseIds = items.map((i) => i.exerciseId);
  const exercises = exerciseIds.length
    ? await db.table("exercises").bulkGet(exerciseIds)
    : [];

  const exMap = new Map(exercises.filter(Boolean).map((ex) => [ex.id, ex]));

  const itemsWithExercise = items.map((it) => ({
    ...it,
    exercise: exMap.get(it.exerciseId) ?? null,
  }));

  return { template, items: itemsWithExercise };
}

/**
 * Backwards-compatible wrapper: returns { ...template, items }
 * (kept because your workout starter uses it)
 */
export async function getTemplateWithItems(templateId) {
  const res = await getTemplateWithDetails(templateId);
  if (!res) return null;
  return { ...res.template, items: res.items };
}

/**
 * TemplateEditor.jsx expects updateTemplate(templateId, patch)
 */
export async function updateTemplate(templateId, patch) {
  const now = Date.now();
  const safePatch = { ...(patch ?? {}), updatedAt: now };

  if ("name" in safePatch) {
    safePatch.name = String(safePatch.name ?? "").trim() || "Untitled Template";
  }
  if ("spaceId" in safePatch) {
    const parsed = safePatch.spaceId == null ? null : Number(safePatch.spaceId);
    safePatch.spaceId = Number.isNaN(parsed) ? null : parsed;
  }

  await db.table("templates").update(templateId, safePatch);
  return templateId;
}

// Keep old name, but route through updateTemplate for consistency
export async function renameTemplate(id, name) {
  return updateTemplate(id, { name });
}

export async function deleteTemplate(id) {
  return db.transaction(
    "rw",
    db.table("templates"),
    db.table("templateItems"),
    async () => {
      await db.table("templateItems").where({ templateId: id }).delete();
      await db.table("templates").delete(id);
    }
  );
}

export async function listTemplates() {
  return db.table("templates").orderBy("updatedAt").reverse().toArray();
}

export async function addExerciseToTemplate(templateId, exerciseId) {
  const existing = await db
    .table("templateItems")
    .where("[templateId+exerciseId]")
    .equals([templateId, exerciseId])
    .first();

  if (existing) throw new Error("Exercise already exists in this template.");

  const items = await db.table("templateItems").where({ templateId }).toArray();
  const maxSort = items.length ? Math.max(...items.map((i) => i.sortOrder ?? 0)) : -1;
  const sortOrder = maxSort + 1;

  const now = Date.now();
  return db.table("templateItems").add({
    templateId,
    exerciseId,
    sortOrder,
    targetSets: 3,
    targetReps: 10,
    notes: "",
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateTemplateItem(itemId, patch) {
  return db.table("templateItems").update(itemId, { ...patch, updatedAt: Date.now() });
}

export async function removeTemplateItem(itemId) {
  return db.table("templateItems").delete(itemId);
}

export async function reorderTemplateItems(templateId, orderedItemIds) {
  return db.transaction("rw", db.table("templateItems"), db.table("templates"), async () => {
    const now = Date.now();
    for (let i = 0; i < orderedItemIds.length; i++) {
      await db.table("templateItems").update(orderedItemIds[i], {
        sortOrder: i,
        updatedAt: now,
      });
    }
    await db.table("templates").update(templateId, { updatedAt: now });
  });
}

// --------------------
// Exercises helpers
// --------------------

export async function getAllExercises() {
  return db.table("exercises").orderBy("name").toArray();
}

// --------------------
// Equipment + Spaces
// --------------------

export async function listEquipment() {
  return db.table("equipment").orderBy("name").toArray();
}

export async function getEquipmentByIds(ids) {
  const list = Array.isArray(ids) ? ids : [];
  return list.length ? db.table("equipment").bulkGet(list) : [];
}

export async function listWorkoutSpaces() {
  return db.table("workoutSpaces").orderBy("name").toArray();
}

export async function getWorkoutSpaceById(id) {
  return db.table("workoutSpaces").get(id);
}

export async function createWorkoutSpace({
  name,
  description = "",
  equipmentIds = [],
  isDefault = false,
  isTemporary = false,
  expiresAt = null,
}) {
  const now = Date.now();
  const safeName = String(name ?? "").trim() || "New Space";
  const safeDescription = String(description ?? "").trim();
  const safeEquipment = Array.isArray(equipmentIds) ? equipmentIds : [];
  const withBodyweight = safeEquipment.includes("bodyweight")
    ? safeEquipment
    : [...safeEquipment, "bodyweight"];
  const normalizedEquipment = Array.from(new Set(withBodyweight));
  const space = {
    name: safeName,
    description: safeDescription,
    equipmentIds: normalizedEquipment,
    isDefault: Boolean(isDefault),
    isTemporary: Boolean(isTemporary),
    expiresAt: expiresAt || null,
    createdAt: now,
    updatedAt: now,
  };

  return db.transaction("rw", db.table("workoutSpaces"), async () => {
    const id = await db.table("workoutSpaces").add(space);
    if (space.isDefault) {
      await db
        .table("workoutSpaces")
        .where("id")
        .notEqual(id)
        .modify({ isDefault: false, updatedAt: now });
    }
    return id;
  });
}

export async function updateWorkoutSpace(spaceId, patch) {
  const now = Date.now();
  const safePatch = { ...(patch ?? {}), updatedAt: now };
  if ("name" in safePatch) {
    safePatch.name = String(safePatch.name ?? "").trim() || "New Space";
  }
  if ("description" in safePatch) {
    safePatch.description = String(safePatch.description ?? "").trim();
  }
  if ("equipmentIds" in safePatch) {
    const next = Array.isArray(safePatch.equipmentIds) ? safePatch.equipmentIds : [];
    const withBodyweight = next.includes("bodyweight") ? next : [...next, "bodyweight"];
    safePatch.equipmentIds = Array.from(new Set(withBodyweight));
  }

  return db.transaction("rw", db.table("workoutSpaces"), async () => {
    await db.table("workoutSpaces").update(spaceId, safePatch);
    if (safePatch.isDefault) {
      await db
        .table("workoutSpaces")
        .where("id")
        .notEqual(spaceId)
        .modify({ isDefault: false, updatedAt: now });
    }
  });
}

export async function deleteWorkoutSpace(spaceId) {
  return db.transaction("rw", db.table("workoutSpaces"), db.table("settings"), async () => {
    await db.table("workoutSpaces").delete(spaceId);
    const settings = await db.table("settings").get(1);
    if (settings?.active_space_id === spaceId) {
      await db.table("settings").put({ ...(settings ?? { id: 1 }), active_space_id: null });
    }
  });
}

export async function duplicateWorkoutSpace(spaceId) {
  const space = await db.table("workoutSpaces").get(spaceId);
  if (!space) throw new Error("Workout space not found.");
  const now = Date.now();
  const name = String(space.name ?? "Space").trim() || "Space";
  const newId = await db.table("workoutSpaces").add({
    ...space,
    name: `${name} Copy`,
    isDefault: false,
    isTemporary: false,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return newId;
}

export async function setDefaultWorkoutSpace(spaceId) {
  const now = Date.now();
  return db.transaction("rw", db.table("workoutSpaces"), async () => {
    await db.table("workoutSpaces").update(spaceId, { isDefault: true, updatedAt: now });
    await db
      .table("workoutSpaces")
      .where("id")
      .notEqual(spaceId)
      .modify({ isDefault: false, updatedAt: now });
  });
}

export async function setActiveWorkoutSpace(spaceId) {
  const settings = await db.table("settings").get(1);
  await db.table("settings").put({
    ...(settings ?? { id: 1 }),
    active_space_id: spaceId ?? null,
  });
}

export async function getCoachActiveGymMeta() {
  try {
    const record = await db.table("meta").get(COACH_ACTIVE_GYM_KEY);
    if (record) {
      return {
        value: normalizeCoachGymId(record.value),
        exists: true,
      };
    }
  } catch {
    // Ignore Dexie errors and fall back to local storage.
  }
  if (typeof window === "undefined") {
    return { value: null, exists: false };
  }
  return readCoachGymFromStorage(window.localStorage);
}

export async function setCoachActiveGymMeta(nextValue) {
  const normalized = normalizeCoachGymId(nextValue);
  const record = {
    key: COACH_ACTIVE_GYM_KEY,
    value: normalized,
    updatedAt: Date.now(),
  };
  try {
    await db.table("meta").put(record);
  } catch {
    // Ignore Dexie errors and fall back to local storage.
  }
  if (typeof window === "undefined") return;
  writeCoachGymToStorage(window.localStorage, normalized);
}

function parseRestSeconds(value, fallback = 60) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

async function getRestDefaults() {
  const settings = await db.table("settings").get(1);
  return {
    restEnabled: settings?.rest_enabled ?? true,
    restDefaultSeconds: parseRestSeconds(settings?.rest_default_seconds, 60),
  };
}

// --------------------
// Workout Sessions (v4)
// --------------------

async function getWorkoutSessionRecord(workoutId) {
  const session = await db.table("workoutSessions").get(workoutId);
  if (session) return session;
  return db.table("workouts").get(workoutId);
}

async function listWorkoutSessionsByStartedAt() {
  const sessions = await db.table("workoutSessions").orderBy("startedAt").reverse().toArray();
  if (sessions.length) return sessions;
  return db.table("workouts").orderBy("startedAt").reverse().toArray();
}

export async function createEmptyWorkout(options = {}) {
  const spaceId =
    options && typeof options === "object" && "spaceId" in options
      ? options.spaceId
      : null;
  const nowIso = new Date().toISOString();
  return db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    async () => {
      const workoutId = await db.table("workoutSessions").add({
        startedAt: nowIso,
        finishedAt: null,
        templateId: null,
        spaceId: spaceId ?? null,
        sessionNote: "",
        sessionReflection: "",
        exerciseNotes: {},
      });
      await db.table("workouts").put({
        id: workoutId,
        startedAt: nowIso,
        finishedAt: null,
        templateId: null,
        spaceId: spaceId ?? null,
        sessionNote: "",
        sessionReflection: "",
        exerciseNotes: {},
      });
      return workoutId;
    }
  );
}

export async function startWorkoutFromTemplate(templateId, options = {}) {
  const spaceId =
    options && typeof options === "object" && "spaceId" in options
      ? options.spaceId
      : null;
  const tpl = await getTemplateWithItems(templateId);
  if (!tpl) throw new Error("Template not found.");
  const items = (tpl.items ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (items.length === 0) throw new Error("Template has no exercises.");
  const { restDefaultSeconds } = await getRestDefaults();

  // Prefill sets/reps from exercise defaults when template targets are missing.
  const exerciseIds = items.map((i) => i.exerciseId);
  const exercises = exerciseIds.length ? await db.table("exercises").bulkGet(exerciseIds) : [];
  const exMap = new Map(exercises.filter(Boolean).map((ex) => [ex.id, ex]));

  const nowIso = new Date().toISOString();
  const workoutId = await db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    async () => {
      const id = await db.table("workoutSessions").add({
        startedAt: nowIso,
        finishedAt: null,
        templateId,
        spaceId: spaceId ?? null,
        sessionNote: "",
        sessionReflection: "",
        exerciseNotes: {},
      });
      await db.table("workouts").put({
        id,
        startedAt: nowIso,
        finishedAt: null,
        templateId,
        spaceId: spaceId ?? null,
        sessionNote: "",
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
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const ex = exMap.get(it.exerciseId);
        const targetSets = it.targetSets ?? ex?.default_sets ?? 3;
        const targetReps = it.targetReps ?? ex?.default_reps ?? null;
        const workoutItemId = await db.table("workoutItems").add({
          workoutId,
          exerciseId: it.exerciseId,
          sortOrder: i,
          targetSets,
          targetReps,
          restSeconds: restDefaultSeconds,
          notes: it.notes ?? "",
        });

        const nSets = targetSets;
        for (let s = 1; s <= nSets; s++) {
          await db.table("workoutSets").add({
            workoutItemId,
            setNumber: s,
            weight: "",
            reps: targetReps == null ? "" : String(targetReps),
          });
        }
      }
    }
  );

  return workoutId;
}

export async function getMostRecentActiveWorkoutId() {
  const active = await db
    .table("workoutSessions")
    .filter((w) => w.finishedAt == null || w.finishedAt === "")
    .toArray();

  if (!active.length) {
    const legacyActive = await db
      .table("workouts")
      .filter((w) => w.finishedAt == null || w.finishedAt === "")
      .toArray();
    if (!legacyActive.length) return null;
    legacyActive.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return legacyActive[0].id;
  }

  if (!active.length) return null;
  active.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return active[0].id;
}




export async function finishWorkout(workoutId) {
  const nowIso = new Date().toISOString();
  await db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    async () => {
      await db.table("workoutSessions").update(workoutId, { finishedAt: nowIso });
      await db.table("workouts").update(workoutId, { finishedAt: nowIso });
    }
  );
}

export async function updateWorkoutSession(workoutId, patch) {
  return db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    async () => {
      await db.table("workoutSessions").update(workoutId, patch);
      await db.table("workouts").update(workoutId, patch);
    }
  );
}

export async function deleteWorkout(workoutId) {
  return db.transaction(
    "rw",
    db.table("workoutSessions"),
    db.table("workouts"),
    db.table("workoutItems"),
    db.table("workoutSets"),
    async () => {
      const items = await db.table("workoutItems").where({ workoutId }).toArray();
      const itemIds = items.map((i) => i.id);

      for (const itemId of itemIds) {
        await db.table("workoutSets").where({ workoutItemId: itemId }).delete();
      }

      await db.table("workoutItems").where({ workoutId }).delete();
      await db.table("workoutSessions").delete(workoutId);
      await db.table("workouts").delete(workoutId);
    }
  );
}

export async function addExerciseToWorkout(workoutId, exerciseId) {
  const existing = await db.table("workoutItems").where({ workoutId, exerciseId }).first();
  if (existing) throw new Error("Exercise already exists in this workout.");

  const ex = await db.table("exercises").get(exerciseId);
  if (!ex) throw new Error("Exercise not found.");
  const { restDefaultSeconds } = await getRestDefaults();

  const items = await db.table("workoutItems").where({ workoutId }).toArray();
  const maxSort = items.length ? Math.max(...items.map((i) => i.sortOrder ?? 0)) : -1;
  const sortOrder = maxSort + 1;

  const targetSets = ex.default_sets ?? 3;
  const targetReps = ex.default_reps ?? null;

  const workoutItemId = await db.table("workoutItems").add({
    workoutId,
    exerciseId,
    sortOrder,
    targetSets,
    targetReps,
    restSeconds: restDefaultSeconds,
    notes: "",
  });

  await db.transaction("rw", db.table("workoutSets"), async () => {
    for (let s = 1; s <= targetSets; s++) {
      await db.table("workoutSets").add({
        workoutItemId,
        setNumber: s,
        weight: "",
        reps: targetReps == null ? "" : String(targetReps),
        isWarmup: false,
      });
    }
  });

  return workoutItemId;
}

export async function removeWorkoutItem(workoutItemId) {
  return db.transaction("rw", db.table("workoutItems"), db.table("workoutSets"), async () => {
    await db.table("workoutSets").where({ workoutItemId }).delete();
    await db.table("workoutItems").delete(workoutItemId);
  });
}

export async function addWorkoutSet(workoutItemId, options = {}) {
  const sets = await db.table("workoutSets").where({ workoutItemId }).toArray();
  const maxN = sets.length ? Math.max(...sets.map((s) => s.setNumber ?? 0)) : 0;
  const nextN = maxN + 1;
  const { weight, reps, isWarmup } = options ?? {};
  return db.table("workoutSets").add({
    workoutItemId,
    setNumber: nextN,
    weight: weight ?? "",
    reps: reps ?? "",
    isWarmup: isWarmup ?? false,
  });
}

export async function addWarmupSets(workoutItemId, count = 2) {
  const safeCount = Math.max(1, Math.floor(count));
  return db.transaction("rw", db.table("workoutSets"), async () => {
    const sets = await db.table("workoutSets").where({ workoutItemId }).toArray();
    sets.sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
    const warmupCount = sets.filter((set) => set.isWarmup).length;

    for (const set of sets) {
      if (set.isWarmup) continue;
      const current = set.setNumber ?? 0;
      await db.table("workoutSets").update(set.id, { setNumber: current + safeCount });
    }

    for (let i = 0; i < safeCount; i += 1) {
      await db.table("workoutSets").add({
        workoutItemId,
        setNumber: warmupCount + i + 1,
        weight: "",
        reps: "",
        isWarmup: true,
      });
    }
  });
}

export async function replaceWorkoutExercise(workoutItemId, newExerciseId) {
  return db.transaction(
    "rw",
    db.table("workoutItems"),
    db.table("workoutSets"),
    db.table("exercises"),
    async () => {
      const workoutItem = await db.table("workoutItems").get(workoutItemId);
      if (!workoutItem) throw new Error("Workout item not found.");

      // Prevent duplicates inside same workout
      const duplicate = await db
        .table("workoutItems")
        .where("[workoutId+exerciseId]")
        .equals([workoutItem.workoutId, newExerciseId])
        .first();

      if (duplicate && duplicate.id !== workoutItemId) {
        throw new Error("That exercise is already in this workout.");
      }

      const ex = await db.table("exercises").get(newExerciseId);
      if (!ex) throw new Error("Exercise not found.");

      // Keep same number of sets currently on the item
      const existingSets = await db.table("workoutSets").where({ workoutItemId }).toArray();
      const setCount = existingSets.length || ex.default_sets || 3;
      const warmupFlags = existingSets.length
        ? existingSets
            .sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0))
            .map((set) => Boolean(set.isWarmup))
        : Array.from({ length: setCount }, () => false);

      // Update workout item
      await db.table("workoutItems").update(workoutItemId, {
        exerciseId: newExerciseId,
        targetSets: ex.default_sets ?? setCount,
        targetReps: ex.default_reps ?? null,
      });

      // Reset sets to match new exercise defaults while preserving count
      await db.table("workoutSets").where({ workoutItemId }).delete();

      for (let s = 1; s <= setCount; s++) {
        await db.table("workoutSets").add({
          workoutItemId,
          setNumber: s,
          weight: "",
          reps: "",
          isWarmup: warmupFlags[s - 1] ?? false,
        });
      }
    }
  );
}


export async function removeWorkoutSet(workoutItemId, setId) {
  return db.transaction("rw", db.table("workoutSets"), async () => {
    await db.table("workoutSets").delete(setId);
    const sets = await db.table("workoutSets").where({ workoutItemId }).toArray();
    sets.sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));

    for (let i = 0; i < sets.length; i++) {
      const desired = i + 1;
      if (sets[i].setNumber !== desired) {
        await db.table("workoutSets").update(sets[i].id, { setNumber: desired });
      }
    }
  });
}

export async function restoreWorkoutSet(workoutItemId, setData) {
  return db.transaction("rw", db.table("workoutSets"), async () => {
    const sets = await db.table("workoutSets").where({ workoutItemId }).toArray();
    const maxPosition = sets.length + 1;
    const desired = Math.min(
      maxPosition,
      Math.max(1, Math.floor(setData?.setNumber ?? maxPosition))
    );

    for (const set of sets) {
      if ((set.setNumber ?? 0) >= desired) {
        const nextNumber = (set.setNumber ?? 0) + 1;
        await db.table("workoutSets").update(set.id, { setNumber: nextNumber });
      }
    }

    await db.table("workoutSets").add({
      id: setData?.id,
      workoutItemId,
      setNumber: desired,
      weight: setData?.weight ?? "",
      reps: setData?.reps ?? "",
      isWarmup: setData?.isWarmup ?? false,
      isComplete: setData?.isComplete ?? false,
    });
  });
}

export async function updateWorkoutSet(setId, patch) {
  return db.table("workoutSets").update(setId, patch);
}

export async function updateWorkoutItem(itemId, patch) {
  return db.table("workoutItems").update(itemId, patch);
}

export async function reorderWorkoutItems(workoutId, orderedWorkoutItemIds) {
  return db.transaction("rw", db.table("workoutItems"), async () => {
    for (let i = 0; i < orderedWorkoutItemIds.length; i++) {
      await db.table("workoutItems").update(orderedWorkoutItemIds[i], { sortOrder: i });
    }
  });
}

export async function getWorkoutWithDetails(workoutId) {
  const workoutRecord = await getWorkoutSessionRecord(workoutId);
  const workout = workoutRecord
    ? {
        ...workoutRecord,
        spaceId: workoutRecord.spaceId ?? null,
        sessionNote:
          typeof workoutRecord.sessionNote === "string" ? workoutRecord.sessionNote : "",
        sessionReflection:
          typeof workoutRecord.sessionReflection === "string"
            ? workoutRecord.sessionReflection
            : "",
        exerciseNotes:
          workoutRecord.exerciseNotes && typeof workoutRecord.exerciseNotes === "object"
            ? workoutRecord.exerciseNotes
            : {},
      }
    : null;
  if (!workout) return null;

  const items = await db.table("workoutItems").where({ workoutId }).toArray();
  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const exerciseIds = items.map((i) => i.exerciseId);
  const exercises = await db.table("exercises").bulkGet(exerciseIds);
  const exMap = new Map(exercises.filter(Boolean).map((ex) => [ex.id, ex]));

  const itemsWithSets = [];
  for (const it of items) {
    const sets = await db.table("workoutSets").where({ workoutItemId: it.id }).toArray();
    sets.sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
    itemsWithSets.push({
      ...it,
      exercise: exMap.get(it.exerciseId) ?? null,
      sets,
    });
  }

  return { workout, items: itemsWithSets };
}

export async function listFinishedWorkouts() {
  const done = await db
    .table("workoutSessions")
    .filter((w) => w.finishedAt != null && w.finishedAt !== "")
    .toArray();

  if (!done.length) {
    const legacyDone = await db
      .table("workouts")
      .filter((w) => w.finishedAt != null && w.finishedAt !== "")
      .toArray();
    legacyDone.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    return legacyDone;
  }

  done.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  return done;
}

export async function getPreviousWorkoutSetsByExercise(exerciseIds, currentWorkoutId = null) {
  const uniqueIds = Array.from(new Set(exerciseIds ?? [])).filter((id) => id != null);
  if (uniqueIds.length === 0) return new Map();

  const finished = await listFinishedWorkouts();
  if (!finished.length) return new Map();

  const remaining = new Set(uniqueIds);
  const results = new Map();

  for (const workout of finished) {
    if (remaining.size === 0) break;
    if (currentWorkoutId != null && workout.id === currentWorkoutId) continue;

    const items = await db.table("workoutItems").where({ workoutId: workout.id }).toArray();
    const matchingItems = items.filter((item) => remaining.has(item.exerciseId));
    if (!matchingItems.length) continue;

    for (const item of matchingItems) {
      if (!remaining.has(item.exerciseId)) continue;
      const sets = await db.table("workoutSets").where({ workoutItemId: item.id }).toArray();
      sets.sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
      results.set(item.exerciseId, {
        workoutId: workout.id,
        finishedAt: workout.finishedAt ?? workout.startedAt ?? null,
        sets,
      });
      remaining.delete(item.exerciseId);
    }
  }

  return results;
}

export async function getExerciseUsageCounts() {
  const finished = await listFinishedWorkouts();
  if (!finished.length) return [];
  const workoutIds = finished.map((workout) => workout.id).filter((id) => id != null);
  if (!workoutIds.length) return [];

  const items = await db.table("workoutItems").where("workoutId").anyOf(workoutIds).toArray();
  const counts = new Map();
  items.forEach((item) => {
    if (item?.exerciseId == null) return;
    counts.set(item.exerciseId, (counts.get(item.exerciseId) ?? 0) + 1);
  });

  return Array.from(counts, ([exerciseId, count]) => ({ exerciseId, count }));
}

// --------------------
// Workout Sessions helpers
// --------------------

export async function getWorkoutSessionById(workoutId) {
  return getWorkoutSessionRecord(workoutId);
}

export async function listRecentWorkoutSessions(limit = 10) {
  const sessions = await listWorkoutSessionsByStartedAt();
  if (limit == null) return sessions;
  return sessions.slice(0, Math.max(0, limit));
}

// --------------------
// Planned workouts (v5)
// --------------------

export async function addPlannedWorkout({ date, templateId = null, exercises = null, source }) {
  const now = Date.now();
  const safeSource = source ?? "user";
  return db.table("plannedWorkouts").add({
    date,
    templateId,
    exercises,
    source: safeSource,
    createdAt: now,
    updatedAt: now,
  });
}

export async function listPlannedWorkouts() {
  return db.table("plannedWorkouts").orderBy("date").toArray();
}

export async function getPlannedWorkoutById(id) {
  return db.table("plannedWorkouts").get(id);
}

export async function deletePlannedWorkout(id) {
  return db.table("plannedWorkouts").delete(id);
}
