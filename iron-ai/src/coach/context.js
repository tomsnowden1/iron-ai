import {
  db,
  getAllExercises,
  getTemplateWithDetails,
  getWorkoutWithDetails,
  listRecentWorkoutSessions,
  listTemplates,
  listEquipment,
  listWorkoutSpaces,
} from "../db";
import { getEquipmentMap } from "../equipment/catalog";
import { getMissingEquipmentForExercise } from "../equipment/engine";
import { resolveActiveSpace } from "../workoutSpaces/logic";
import { summarizeCoachMemory } from "./memory";

const DEFAULT_SESSION_LIMIT = 5;
const MAX_SESSION_LIMIT = 20;
const DEFAULT_TEMPLATE_LIMIT = 10;
const MAX_TEMPLATE_LIMIT = 50;
const DEFAULT_MAX_BYTES = 60000;
const MAX_MISSING_EXERCISES = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toDateLabel(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function estimateMinutes(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function sortByDateDesc(a, b) {
  const aDate = a.finishedAt ?? a.startedAt ?? "";
  const bDate = b.finishedAt ?? b.startedAt ?? "";
  return String(bDate).localeCompare(String(aDate));
}

function summarizeSession(bundle) {
  const workout = bundle.workout;
  const items = bundle.items ?? [];
  const sessionNote = workout?.sessionNote?.trim?.() ?? "";
  const exerciseNotes = workout?.exerciseNotes ?? {};
  const exercises = items.map((item) => {
    const note = exerciseNotes?.[item.exerciseId]?.trim?.() ?? "";
    return {
      exerciseId: item.exerciseId,
      name: item.exercise?.name ?? "Unknown Exercise",
      muscleGroup: item.exercise?.muscle_group ?? "Unknown",
      sets: (item.sets ?? []).map((set) => ({
        setNumber: set.setNumber ?? null,
        weight: set.weight ?? "",
        reps: set.reps ?? "",
      })),
      note: note || undefined,
    };
  });

  return {
    id: workout?.id ?? null,
    startedAt: toDateLabel(workout?.startedAt),
    finishedAt: toDateLabel(workout?.finishedAt),
    durationMinutes: estimateMinutes(workout?.startedAt, workout?.finishedAt),
    sessionNote: sessionNote || undefined,
    exercises,
  };
}

function summarizeTemplate(template, items) {
  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return {
    id: template.id ?? null,
    name: template.name ?? "Untitled",
    exercises: sorted.map((item) => ({
      exerciseId: item.exerciseId,
      name: item.exercise?.name ?? "Unknown Exercise",
      muscleGroup: item.exercise?.muscle_group ?? "Unknown",
      targetSets: item.targetSets ?? null,
      targetReps: item.targetReps ?? null,
    })),
    updatedAt: template.updatedAt ?? null,
  };
}

function summarizeExerciseLibrary(exercises, sessions) {
  const muscleGroups = {};
  const lastUsedMap = new Map();
  let customCount = 0;

  exercises.forEach((exercise) => {
    const group = exercise.muscle_group ?? "Unknown";
    muscleGroups[group] = (muscleGroups[group] ?? 0) + 1;
    if (exercise.is_custom) customCount += 1;
  });

  sessions.forEach((session) => {
    const date = session.finishedAt ?? session.startedAt ?? null;
    const dateLabel = toDateLabel(date);
    session.exercises.forEach((exercise) => {
      const prev = lastUsedMap.get(exercise.exerciseId);
      if (!prev || String(dateLabel ?? "").localeCompare(prev.date ?? "") > 0) {
        lastUsedMap.set(exercise.exerciseId, {
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          date: dateLabel,
        });
      }
    });
  });

  const lastUsed = Array.from(lastUsedMap.values()).sort((a, b) => {
    const byDate = String(b.date ?? "").localeCompare(String(a.date ?? ""));
    if (byDate !== 0) return byDate;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return {
    totalCount: exercises.length,
    customCount,
    muscleGroups: Object.entries(muscleGroups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    lastUsed: lastUsed.slice(0, 10),
  };
}

function buildSettingsSummary(settings) {
  if (!settings) return null;
  return {
    restEnabled: settings.rest_enabled ?? null,
    restDefaultSeconds: settings.rest_default_seconds ?? null,
    weightUnit: settings.weight_unit ?? settings.unit ?? null,
  };
}

function sizeOfSnapshot(snapshot) {
  try {
    return JSON.stringify(snapshot).length;
  } catch {
    return Infinity;
  }
}

function truncateSnapshot(snapshot, maxBytes) {
  const meta = { truncated: false, omitted: [] };
  let working = snapshot;

  const maybeTruncate = (label, updater) => {
    if (sizeOfSnapshot(working) <= maxBytes) return;
    working = updater(working);
    meta.truncated = true;
    meta.omitted.push(label);
  };

  let sessionsTrimmed = false;
  while (sizeOfSnapshot(working) > maxBytes && working.sessions.length > 1) {
    working = { ...working, sessions: working.sessions.slice(0, -1) };
    meta.truncated = true;
    sessionsTrimmed = true;
  }

  if (sessionsTrimmed) meta.omitted.push("sessions");

  let templatesTrimmed = false;
  while (sizeOfSnapshot(working) > maxBytes && working.templates.length > 1) {
    working = { ...working, templates: working.templates.slice(0, -1) };
    meta.truncated = true;
    templatesTrimmed = true;
  }

  if (templatesTrimmed) meta.omitted.push("templates");

  maybeTruncate("notes", (current) => ({
    ...current,
    sessions: current.sessions.map((session) => ({
      ...session,
      sessionNote: undefined,
      exercises: session.exercises.map((exercise) => ({ ...exercise, note: undefined })),
    })),
  }));

  maybeTruncate("exerciseLibrary.lastUsed", (current) => ({
    ...current,
    exerciseLibrary: { ...current.exerciseLibrary, lastUsed: [] },
  }));

  maybeTruncate("equipment", (current) => ({
    ...current,
    activeSpace: current.activeSpace
      ? { ...current.activeSpace, equipmentIds: [] }
      : current.activeSpace,
    availableEquipment: [],
    missingEquipment: [],
  }));

  maybeTruncate("settings", (current) => ({ ...current, settings: null }));
  maybeTruncate("memory", (current) => ({ ...current, memorySummary: null }));

  return { snapshot: working, meta };
}

export async function getCoachContextSnapshot(options = {}) {
  const {
    scopes = {},
    sessionLimit = DEFAULT_SESSION_LIMIT,
    templateLimit = DEFAULT_TEMPLATE_LIMIT,
    maxBytes = DEFAULT_MAX_BYTES,
    memorySummary = null,
    launchContext = null,
  } = options;

  const resolvedSessionLimit = clamp(
    sessionLimit ?? DEFAULT_SESSION_LIMIT,
    1,
    MAX_SESSION_LIMIT
  );
  const resolvedTemplateLimit = clamp(
    templateLimit ?? DEFAULT_TEMPLATE_LIMIT,
    1,
    MAX_TEMPLATE_LIMIT
  );

  const includeSessions = Boolean(scopes.sessions);
  const includeTemplates = Boolean(scopes.templates);
  const includeExercises = Boolean(scopes.exerciseHistory);
  const includeNotes = Boolean(scopes.notes);
  const includeSettings = Boolean(scopes.settings);
  const includeSpaces = Boolean(scopes.spaces);

  const sessions = [];
  if (includeSessions || includeExercises) {
    const sessionRows = await listRecentWorkoutSessions(resolvedSessionLimit);
    const sorted = [...sessionRows].sort(sortByDateDesc);
    for (const session of sorted) {
      const details = await getWorkoutWithDetails(session.id);
      if (!details) continue;
      const summary = summarizeSession(details);
      sessions.push(summary);
    }
  }

  const templates = [];
  if (includeTemplates) {
    const templateRows = await listTemplates();
    const sorted = [...templateRows].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""))
    );
    const limited = sorted.slice(0, resolvedTemplateLimit);
    for (const tpl of limited) {
      const details = await getTemplateWithDetails(tpl.id);
      if (!details) continue;
      templates.push(summarizeTemplate(details.template, details.items ?? []));
    }
  }

  const allExercises = await getAllExercises();
  const exerciseLibrary = includeExercises
    ? summarizeExerciseLibrary(allExercises, sessions)
    : null;

  const settingsRow = includeSettings || includeSpaces ? await db.settings.get(1) : null;
  const settings = includeSettings ? buildSettingsSummary(settingsRow) : null;
  const memorySummaryData = memorySummary ? summarizeCoachMemory(memorySummary) : null;

  let activeSpace = null;
  let availableEquipment = [];
  let missingEquipment = [];

  if (includeSpaces) {
    const spaces = await listWorkoutSpaces();
    activeSpace = resolveActiveSpace(spaces, settingsRow?.active_space_id ?? null);

    if (activeSpace) {
      const equipmentList = await listEquipment();
      const equipmentMap = getEquipmentMap(equipmentList);
      const equipmentIds = Array.isArray(activeSpace.equipmentIds)
        ? activeSpace.equipmentIds
        : [];
      availableEquipment = equipmentIds
        .map((id) => equipmentMap.get(id))
        .filter(Boolean)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

      const exerciseMap = new Map(allExercises.map((ex) => [ex.id, ex]));
      const candidateIds = new Set();
      if (includeSessions) {
        sessions.forEach((session) =>
          session.exercises.forEach((exercise) => candidateIds.add(exercise.exerciseId))
        );
      }
      if (includeTemplates) {
        templates.forEach((template) =>
          template.exercises.forEach((exercise) => candidateIds.add(exercise.exerciseId))
        );
      }

      const missingList = [];
      candidateIds.forEach((exerciseId) => {
        const ex = exerciseMap.get(exerciseId);
        if (!ex) return;
        const missing = getMissingEquipmentForExercise(
          ex,
          activeSpace.equipmentIds ?? [],
          equipmentMap
        );
        if (!missing.length) return;
        missingList.push({
          exerciseId,
          name: ex.name ?? "Unknown Exercise",
          missingEquipment: missing.map((item) => item?.name ?? "Unknown"),
        });
      });

      missingEquipment = missingList
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .slice(0, MAX_MISSING_EXERCISES);
    }
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    scopes: {
      sessions: includeSessions,
      templates: includeTemplates,
      exerciseHistory: includeExercises,
      notes: includeNotes,
      settings: includeSettings,
      spaces: includeSpaces,
    },
    sessions: includeSessions
      ? sessions.map((session) => ({
          ...session,
          sessionNote: includeNotes ? session.sessionNote : undefined,
          exercises: session.exercises.map((exercise) => ({
            ...exercise,
            note: includeNotes ? exercise.note : undefined,
          })),
        }))
      : [],
    templates: includeTemplates ? templates : [],
    exerciseLibrary: exerciseLibrary,
    settings,
    activeSpace: includeSpaces
      ? activeSpace
        ? {
            id: activeSpace.id ?? null,
            name: activeSpace.name ?? "Unknown",
            isTemporary: activeSpace.isTemporary ?? false,
            expiresAt: activeSpace.expiresAt ?? null,
            equipmentIds: Array.isArray(activeSpace.equipmentIds)
              ? activeSpace.equipmentIds
              : [],
          }
        : null
      : null,
    availableEquipment: includeSpaces ? availableEquipment : [],
    missingEquipment: includeSpaces ? missingEquipment : [],
    memorySummary: memorySummaryData,
    launchContext: launchContext
      ? {
          source: launchContext.source ?? null,
          gymId: launchContext.gymId ?? null,
          gymName: launchContext.gymName ?? null,
          exerciseId: launchContext.exerciseId ?? null,
          exerciseName: launchContext.exerciseName ?? null,
        }
      : null,
  };

  const size = sizeOfSnapshot(snapshot);
  const truncatedResult = size > maxBytes ? truncateSnapshot(snapshot, maxBytes) : null;

  if (truncatedResult) {
    const meta = { sizeBytes: size, truncated: true, omitted: truncatedResult.meta.omitted };
    return {
      snapshot: { ...truncatedResult.snapshot, meta },
      meta,
    };
  }

  const meta = { sizeBytes: size, truncated: false, omitted: [] };
  return { snapshot: { ...snapshot, meta }, meta };
}
