import {
  addPlannedWorkout,
  getAllExercises,
  getTemplateWithDetails,
  getWorkoutWithDetails,
  listRecentWorkoutSessions,
  listTemplates,
  listEquipment,
  listWorkoutSpaces,
  createWorkoutSpace,
  updateWorkoutSpace,
  setActiveWorkoutSpace,
  getWorkoutSpaceById,
  db,
} from "../db";
import { normalizeCoachMemory, upsertGoal } from "./memory";
import { validateSchema } from "./schema";
import { isSpaceExpired, normalizeGymName } from "../workoutSpaces/logic";
import { getExerciseSubstitutions } from "../equipment/engine";

const MAX_LIST_LIMIT = 50;
const MAX_SESSION_LIMIT = 20;

function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveCoachActiveSpace(spaces, activeGymId) {
  if (!Array.isArray(spaces) || spaces.length === 0) return null;
  const validSpaces = spaces.filter((space) => !isSpaceExpired(space));
  if (!validSpaces.length) return null;
  if (activeGymId == null) return null;
  return validSpaces.find((space) => space.id === activeGymId) ?? null;
}

function resolveCoachSpaceByName(spaces, name) {
  if (!Array.isArray(spaces) || spaces.length === 0) return null;
  const normalized = normalizeGymName(name);
  if (!normalized) return null;
  const validSpaces = spaces.filter((space) => !isSpaceExpired(space));
  if (!validSpaces.length) return null;
  return (
    validSpaces.find((space) => normalizeGymName(space.name) === normalized) ?? null
  );
}

async function getSessionBundles(limit) {
  const sessions = await listRecentWorkoutSessions(limit);
  const sorted = [...sessions].sort((a, b) =>
    String(b.finishedAt ?? b.startedAt ?? "").localeCompare(String(a.finishedAt ?? a.startedAt ?? ""))
  );
  const bundles = [];
  for (const session of sorted) {
    const details = await getWorkoutWithDetails(session.id);
    if (details) bundles.push(details);
  }
  return bundles;
}

function summarizeSession(bundle) {
  const workout = bundle.workout ?? {};
  const items = bundle.items ?? [];
  const totalSets = items.reduce((sum, item) => sum + (item.sets?.length ?? 0), 0);
  return {
    id: workout.id ?? null,
    startedAt: workout.startedAt ?? null,
    finishedAt: workout.finishedAt ?? null,
    totalExercises: items.length,
    totalSets,
    sessionNote: workout.sessionNote ?? "",
  };
}

function formatSessionDetail(bundle) {
  const workout = bundle.workout ?? {};
  const items = bundle.items ?? [];
  const exerciseNotes = workout.exerciseNotes ?? {};
  return {
    id: workout.id ?? null,
    startedAt: workout.startedAt ?? null,
    finishedAt: workout.finishedAt ?? null,
    sessionNote: workout.sessionNote ?? "",
    exercises: items.map((item) => ({
      exerciseId: item.exerciseId,
      name: item.exercise?.name ?? "Unknown Exercise",
      muscleGroup: item.exercise?.muscle_group ?? "Unknown",
      note: exerciseNotes?.[item.exerciseId] ?? "",
      sets: (item.sets ?? []).map((set) => ({
        setNumber: set.setNumber ?? null,
        weight: set.weight ?? "",
        reps: set.reps ?? "",
      })),
    })),
  };
}

async function resolveExercise(exerciseIdOrName) {
  const exercises = await getAllExercises();
  const input = String(exerciseIdOrName ?? "").trim();
  if (!input) return null;
  const parsedId = Number.parseInt(input, 10);
  if (!Number.isNaN(parsedId)) {
    return exercises.find((exercise) => exercise.id === parsedId) ?? null;
  }
  const lowered = input.toLowerCase();
  return (
    exercises.find((exercise) => String(exercise.name ?? "").toLowerCase() === lowered) ??
    null
  );
}

function getToolSummary(name, input) {
  switch (name) {
    case "create_template":
      return `Create template: ${input?.name ?? "Untitled"} (${input?.exercises?.length ?? 0} exercises)`;
    case "add_planned_workout":
      return `Add planned workout: ${input?.date ?? "Unknown date"}`;
    case "update_user_goal":
      return `Update goal: ${input?.goalType ?? "Goal"}`;
    case "get_recent_sessions":
      return `Fetch recent sessions (${input?.limit ?? "default"})`;
    case "get_session_detail":
      return `Fetch session detail (${input?.sessionId ?? "unknown"})`;
    case "get_templates":
      return `Fetch templates (${input?.limit ?? "default"})`;
    case "get_template_detail":
      return `Fetch template detail (${input?.templateId ?? "unknown"})`;
    case "search_exercises":
      return `Search exercises (${input?.query ?? ""})`;
    case "get_exercise_history":
      return `Fetch exercise history (${input?.exerciseIdOrName ?? "unknown"})`;
    case "get_exercise_substitutions":
      return `Fetch substitutions (${input?.exerciseId ?? "unknown"})`;
    case "get_personal_records":
      return "Fetch personal records";
    case "get_training_summary":
      return `Fetch training summary (${input?.rangeDays ?? "default"} days)`;
    case "get_workout_spaces":
      return "Fetch workout spaces";
    case "get_active_space":
      return "Fetch active space";
    case "get_equipment_for_space":
      return `Fetch equipment for space (${input?.spaceId ?? "active"})`;
    case "create_workout_space":
      return `Create workout space: ${input?.name ?? "Untitled"}`;
    case "update_workout_space":
      return `Update workout space: ${input?.spaceId ?? "unknown"}`;
    case "set_active_space":
      return `Set active space: ${input?.spaceId ?? "unknown"}`;
    default:
      return name;
  }
}

export const toolDefinitions = [
  {
    name: "get_recent_sessions",
    description: "Get recent workout sessions with summary stats.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", min: 1, max: MAX_SESSION_LIMIT },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ limit }, context) => {
      const safeLimit = clampLimit(limit, 5, MAX_SESSION_LIMIT);
      const bundles = await getSessionBundles(safeLimit);
      const includeNotes = Boolean(context?.scopes?.notes);
      return {
        sessions: bundles.map((bundle) => {
          const summary = summarizeSession(bundle);
          if (!includeNotes) {
            return { ...summary, sessionNote: undefined };
          }
          return summary;
        }),
      };
    },
  },
  {
    name: "get_session_detail",
    description: "Get detailed data for a single workout session.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "integer" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ sessionId }, context) => {
      const bundle = await getWorkoutWithDetails(sessionId);
      if (!bundle) return { error: "Session not found." };
      const includeNotes = Boolean(context?.scopes?.notes);
      const detail = formatSessionDetail(bundle);
      if (!includeNotes) {
        return {
          ...detail,
          sessionNote: "",
          exercises: detail.exercises.map((exercise) => ({ ...exercise, note: "" })),
        };
      }
      return detail;
    },
  },
  {
    name: "get_templates",
    description: "List available workout templates with summary info.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", min: 1, max: MAX_LIST_LIMIT },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ limit }) => {
      const safeLimit = clampLimit(limit, 10, MAX_LIST_LIMIT);
      const templates = await listTemplates();
      const sorted = [...templates].sort((a, b) =>
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );
      return {
        templates: sorted.slice(0, safeLimit).map((tpl) => ({
          id: tpl.id ?? null,
          name: tpl.name ?? "Untitled",
          updatedAt: tpl.updatedAt ?? null,
        })),
      };
    },
  },
  {
    name: "get_template_detail",
    description: "Get full details for a template.",
    inputSchema: {
      type: "object",
      required: ["templateId"],
      properties: {
        templateId: { type: "integer" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ templateId }) => {
      const details = await getTemplateWithDetails(templateId);
      if (!details) return { error: "Template not found." };
      return {
        id: details.template.id ?? null,
        name: details.template.name ?? "Untitled",
        exercises: (details.items ?? []).map((item) => ({
          exerciseId: item.exerciseId,
          name: item.exercise?.name ?? "Unknown Exercise",
          muscleGroup: item.exercise?.muscle_group ?? "Unknown",
          targetSets: item.targetSets ?? null,
          targetReps: item.targetReps ?? null,
        })),
      };
    },
  },
  {
    name: "search_exercises",
    description: "Search exercises by name or muscle group.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", min: 1, max: MAX_LIST_LIMIT },
        muscleGroup: { type: "string" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ query, limit, muscleGroup }) => {
      const safeLimit = clampLimit(limit, 10, MAX_LIST_LIMIT);
      const exercises = await getAllExercises();
      const lowered = String(query ?? "").toLowerCase();
      const filtered = exercises.filter((exercise) => {
        const name = String(exercise.name ?? "").toLowerCase();
        const group = String(exercise.muscle_group ?? "").toLowerCase();
        const matchesQuery = name.includes(lowered) || group.includes(lowered);
        const matchesGroup = muscleGroup
          ? group === String(muscleGroup).toLowerCase()
          : true;
        return matchesQuery && matchesGroup;
      });
      const sorted = filtered.sort((a, b) =>
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );
      return {
        exercises: sorted.slice(0, safeLimit).map((exercise) => ({
          id: exercise.id,
          name: exercise.name ?? "Unknown",
          muscleGroup: exercise.muscle_group ?? "Unknown",
          requiredEquipmentIds: Array.isArray(exercise.requiredEquipmentIds)
            ? exercise.requiredEquipmentIds
            : [],
          optionalEquipmentIds: Array.isArray(exercise.optionalEquipmentIds)
            ? exercise.optionalEquipmentIds
            : [],
        })),
      };
    },
  },
  {
    name: "get_exercise_history",
    description: "Get recent sessions that include the specified exercise.",
    inputSchema: {
      type: "object",
      required: ["exerciseIdOrName"],
      properties: {
        exerciseIdOrName: { type: "string" },
        limit: { type: "integer", min: 1, max: MAX_SESSION_LIMIT },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ exerciseIdOrName, limit }) => {
      const exercise = await resolveExercise(exerciseIdOrName);
      if (!exercise) return { error: "Exercise not found." };
      const safeLimit = clampLimit(limit, 5, MAX_SESSION_LIMIT);
      const bundles = await getSessionBundles(MAX_SESSION_LIMIT);
      const matches = [];
      bundles.forEach((bundle) => {
        const workout = bundle.workout ?? {};
        const items = bundle.items ?? [];
        const item = items.find((it) => it.exerciseId === exercise.id);
        if (!item) return;
        matches.push({
          sessionId: workout.id ?? null,
          date: workout.finishedAt ?? workout.startedAt ?? null,
          sets: (item.sets ?? []).map((set) => ({
            setNumber: set.setNumber ?? null,
            weight: set.weight ?? "",
            reps: set.reps ?? "",
          })),
        });
      });
      const sorted = matches.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
      return {
        exercise: {
          id: exercise.id,
          name: exercise.name ?? "Unknown",
        },
        history: sorted.slice(0, safeLimit),
      };
    },
  },
  {
    name: "get_exercise_substitutions",
    description: "Suggest available substitutions for an exercise in a workout space.",
    inputSchema: {
      type: "object",
      required: ["exerciseId"],
      properties: {
        exerciseId: { type: "integer" },
        spaceId: { type: "integer" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ exerciseId, spaceId }) => {
      const substitutions = await getExerciseSubstitutions(exerciseId, spaceId);
      return { substitutions };
    },
  },
  {
    name: "get_personal_records",
    description: "Detect personal records from recent workout history.",
    inputSchema: {
      type: "object",
      properties: {
        exerciseIdOrName: { type: "string" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ exerciseIdOrName }) => {
      const exercises = await getAllExercises();
      const bundles = await getSessionBundles(MAX_SESSION_LIMIT);
      const target = exerciseIdOrName ? await resolveExercise(exerciseIdOrName) : null;

      const prMap = new Map();
      bundles.forEach((bundle) => {
        const workoutDate = bundle.workout?.finishedAt ?? bundle.workout?.startedAt ?? null;
        (bundle.items ?? []).forEach((item) => {
          if (target && item.exerciseId !== target.id) return;
          const existing = prMap.get(item.exerciseId) ?? {
            maxWeight: null,
            maxReps: null,
            lastDate: null,
          };
          (item.sets ?? []).forEach((set) => {
            const weight = parseNumber(set.weight);
            const reps = parseNumber(set.reps);
            if (weight != null && (existing.maxWeight == null || weight > existing.maxWeight)) {
              existing.maxWeight = weight;
              existing.lastDate = workoutDate;
            }
            if (reps != null && (existing.maxReps == null || reps > existing.maxReps)) {
              existing.maxReps = reps;
              existing.lastDate = workoutDate;
            }
          });
          prMap.set(item.exerciseId, existing);
        });
      });

      const records = Array.from(prMap.entries())
        .map(([exerciseId, record]) => {
          const exercise = exercises.find((ex) => ex.id === exerciseId);
          return {
            exerciseId,
            name: exercise?.name ?? "Unknown",
            maxWeight: record.maxWeight,
            maxReps: record.maxReps,
            lastDate: record.lastDate ?? null,
          };
        })
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

      return { records };
    },
  },
  {
    name: "get_training_summary",
    description: "Summarize training volume and streaks for a given time window.",
    inputSchema: {
      type: "object",
      properties: {
        rangeDays: { type: "integer", min: 1, max: 365 },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ rangeDays }) => {
      const safeDays = clampLimit(rangeDays, 30, 365);
      const bundles = await getSessionBundles(MAX_SESSION_LIMIT);
      const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;

      const sessions = bundles.filter((bundle) => {
        const when = bundle.workout?.finishedAt ?? bundle.workout?.startedAt ?? null;
        const time = when ? new Date(when).getTime() : 0;
        return time >= cutoff;
      });

      let totalSets = 0;
      let totalExercises = 0;
      let totalVolume = 0;
      const dates = new Set();

      sessions.forEach((bundle) => {
        const when = bundle.workout?.finishedAt ?? bundle.workout?.startedAt ?? null;
        if (when) dates.add(new Date(when).toDateString());
        (bundle.items ?? []).forEach((item) => {
          totalExercises += 1;
          (item.sets ?? []).forEach((set) => {
            totalSets += 1;
            const weight = parseNumber(set.weight);
            const reps = parseNumber(set.reps);
            if (weight != null && reps != null) {
              totalVolume += weight * reps;
            }
          });
        });
      });

      const sortedDates = Array.from(dates).sort((a, b) =>
        new Date(b).getTime() - new Date(a).getTime()
      );
      let streak = 0;
      let cursor = new Date();
      for (const dateStr of sortedDates) {
        const target = cursor.toDateString();
        if (dateStr !== target) break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }

      return {
        rangeDays: safeDays,
        workouts: sessions.length,
        totalExercises,
        totalSets,
        totalVolume: totalVolume ? Math.round(totalVolume) : null,
        streakDays: streak,
      };
    },
  },
  {
    name: "get_workout_spaces",
    description: "List available workout spaces and equipment counts.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async () => {
      const spaces = await listWorkoutSpaces();
      const sorted = [...spaces].sort((a, b) =>
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );
      return {
        spaces: sorted.map((space) => ({
          id: space.id ?? null,
          name: space.name ?? "Untitled",
          description: space.description ?? "",
          equipmentCount: Array.isArray(space.equipmentIds)
            ? space.equipmentIds.length
            : 0,
          isDefault: Boolean(space.isDefault),
          isTemporary: Boolean(space.isTemporary),
          expiresAt: space.expiresAt ?? null,
        })),
      };
    },
  },
  {
    name: "get_active_space",
    description: "Get the active workout space.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async (input, context) => {
      const spaces = await listWorkoutSpaces();
      const active = resolveCoachActiveSpace(spaces, context?.activeGymId ?? null);
      if (!active) return { activeSpace: null };
      return {
        activeSpace: {
          id: active.id ?? null,
          name: active.name ?? "Untitled",
          equipmentCount: Array.isArray(active.equipmentIds)
            ? active.equipmentIds.length
            : 0,
          isTemporary: Boolean(active.isTemporary),
          expiresAt: active.expiresAt ?? null,
        },
      };
    },
  },
  {
    name: "get_equipment_for_space",
    description: "Get equipment available for a workout space.",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: { type: "integer" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: false,
    handler: async ({ spaceId }, context) => {
      const spaces = await listWorkoutSpaces();
      const active = resolveCoachActiveSpace(spaces, context?.activeGymId ?? null);
      const target = spaceId ? await getWorkoutSpaceById(spaceId) : active;
      if (!target) return { error: "Space not found." };
      const equipment = await listEquipment();
      const byId = new Map(equipment.map((item) => [item.id, item]));
      const ids = Array.isArray(target.equipmentIds) ? target.equipmentIds : [];
      return {
        space: {
          id: target.id ?? null,
          name: target.name ?? "Untitled",
          isTemporary: Boolean(target.isTemporary),
          expiresAt: target.expiresAt ?? null,
        },
        equipment: ids
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((item) => ({
            id: item.id,
            name: item.name ?? "Unknown",
            category: item.category ?? "unknown",
          })),
      };
    },
  },
  {
    name: "create_template",
    description: "Create a workout template with exercises and targets.",
    inputSchema: {
      type: "object",
      required: ["name", "exercises"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        spaceId: { type: "integer" },
        exercises: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            required: ["exerciseId"],
            properties: {
              exerciseId: { type: "integer" },
              sets: { type: "integer" },
              reps: { type: "integer" },
              warmupSets: { type: "integer" },
            },
          },
        },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async ({ name, exercises, spaceId }) => {
      const existingExercises = await getAllExercises();
      const validIds = new Set(existingExercises.map((exercise) => exercise.id));
      exercises.forEach((ex) => {
        if (!validIds.has(ex.exerciseId)) {
          throw new Error(`Exercise ${ex.exerciseId} not found.`);
        }
      });
      if (spaceId != null) {
        const space = await getWorkoutSpaceById(spaceId);
        if (!space) throw new Error("Workout space not found.");
      }

      const now = Date.now();
      const safeName = String(name ?? "").trim() || "Untitled Template";
      const result = await db.transaction(
        "rw",
        db.table("templates"),
        db.table("templateItems"),
        async () => {
          const templateId = await db.table("templates").add({
            name: safeName,
            spaceId: spaceId ?? null,
            createdAt: now,
            updatedAt: now,
          });
          const items = [];
          for (let i = 0; i < exercises.length; i++) {
            const ex = exercises[i];
            const notes = ex.warmupSets ? `Warmup sets: ${ex.warmupSets}` : "";
            const itemId = await db.table("templateItems").add({
              templateId,
              exerciseId: ex.exerciseId,
              sortOrder: i,
              targetSets: ex.sets ?? null,
              targetReps: ex.reps ?? null,
              notes,
              createdAt: now,
              updatedAt: now,
            });
            items.push({ exerciseId: ex.exerciseId, itemId });
          }
          return { templateId, items };
        }
      );

      return { templateId: result.templateId, exercises: result.items };
    },
  },
  {
    name: "add_planned_workout",
    description:
      "Add a planned workout entry with a date and optional template or exercise list.",
    inputSchema: {
      type: "object",
      required: ["date"],
      properties: {
        date: { type: "string", minLength: 4, maxLength: 32 },
        templateId: { type: "integer" },
        exercises: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            required: ["exerciseId"],
            properties: {
              exerciseId: { type: "integer" },
              sets: { type: "integer" },
              reps: { type: "integer" },
            },
          },
        },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async ({ date, templateId, exercises }) => {
      if (!templateId && (!exercises || exercises.length === 0)) {
        throw new Error("Provide a templateId or exercises.");
      }
      if (templateId) {
        const template = await db.table("templates").get(templateId);
        if (!template) {
          throw new Error("Template not found.");
        }
      }
      const plannedId = await addPlannedWorkout({
        date,
        templateId: templateId ?? null,
        exercises: exercises ?? null,
        source: "coach",
      });
      return { plannedWorkoutId: plannedId };
    },
  },
  {
    name: "update_user_goal",
    description: "Update a user goal in Coach Memory.",
    inputSchema: {
      type: "object",
      required: ["goalType", "value"],
      properties: {
        goalType: { type: "string", minLength: 1, maxLength: 40 },
        value: { type: "string", minLength: 1, maxLength: 120 },
        notes: { type: "string", maxLength: 240 },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async ({ goalType, value, notes }) => {
      const settings = await db.settings.get(1);
      const currentMemory = normalizeCoachMemory(settings?.coach_memory);
      const nextMemory = upsertGoal(currentMemory, goalType, value, notes);
      await db.settings.put({
        ...(settings ?? { id: 1 }),
        coach_memory: nextMemory,
      });
      return { updated: true };
    },
  },
  {
    name: "create_workout_space",
    description: "Create a workout space with an equipment list.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", maxLength: 200 },
        equipmentIds: {
          type: "array",
          items: { type: "string" },
        },
        isDefault: { type: "boolean" },
        isTemporary: { type: "boolean" },
        expiresAt: { type: "string", maxLength: 32 },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async (
      { name, description, equipmentIds, isDefault, isTemporary, expiresAt },
      context
    ) => {
      const spaces = await listWorkoutSpaces();
      const activeGymId = context?.activeGymId ?? null;
      const activeSpace = resolveCoachActiveSpace(spaces, activeGymId);
      if (activeSpace) {
        return { spaceId: activeSpace.id ?? null, reused: true, match: "active" };
      }
      const matchedSpace = resolveCoachSpaceByName(spaces, name);
      if (matchedSpace) {
        return { spaceId: matchedSpace.id ?? null, reused: true, match: "name" };
      }
      const equipment = await listEquipment();
      const validIds = new Set(equipment.map((item) => item.id));
      const safeEquipment = Array.isArray(equipmentIds)
        ? equipmentIds.filter((id) => validIds.has(id))
        : [];
      const id = await createWorkoutSpace({
        name,
        description,
        equipmentIds: safeEquipment,
        isDefault: Boolean(isDefault),
        isTemporary: Boolean(isTemporary),
        expiresAt: expiresAt ?? null,
      });
      return { spaceId: id };
    },
  },
  {
    name: "update_workout_space",
    description: "Update an existing workout space.",
    inputSchema: {
      type: "object",
      required: ["spaceId"],
      properties: {
        spaceId: { type: "integer" },
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", maxLength: 200 },
        equipmentIds: {
          type: "array",
          items: { type: "string" },
        },
        isDefault: { type: "boolean" },
        isTemporary: { type: "boolean" },
        expiresAt: { type: "string", maxLength: 32 },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async ({
      spaceId,
      name,
      description,
      equipmentIds,
      isDefault,
      isTemporary,
      expiresAt,
    }) => {
      const existing = await getWorkoutSpaceById(spaceId);
      if (!existing) throw new Error("Workout space not found.");
      const equipment = await listEquipment();
      const validIds = new Set(equipment.map((item) => item.id));
      const safeEquipment = Array.isArray(equipmentIds)
        ? equipmentIds.filter((id) => validIds.has(id))
        : undefined;
      const patch = {
        ...(name != null ? { name } : {}),
        ...(description != null ? { description } : {}),
        ...(safeEquipment !== undefined ? { equipmentIds: safeEquipment } : {}),
        ...(isDefault != null ? { isDefault } : {}),
        ...(isTemporary != null ? { isTemporary } : {}),
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ?? null } : {}),
      };
      await updateWorkoutSpace(spaceId, patch);
      return { updated: true };
    },
  },
  {
    name: "set_active_space",
    description: "Set the active workout space used for new workouts.",
    inputSchema: {
      type: "object",
      required: ["spaceId"],
      properties: {
        spaceId: { type: "integer" },
      },
    },
    outputSchema: { type: "object" },
    isWriteTool: true,
    handler: async ({ spaceId }) => {
      const existing = await getWorkoutSpaceById(spaceId);
      if (!existing) throw new Error("Workout space not found.");
      await setActiveWorkoutSpace(spaceId);
      return { activeSpaceId: spaceId };
    },
  },
];

export function getToolRegistry() {
  return new Map(toolDefinitions.map((tool) => [tool.name, tool]));
}

export function getOpenAITools(options = {}) {
  const allowRead = options.allowRead !== false;
  const allowWrite = options.allowWrite !== false;
  const allowedTools = options.allowedTools ?? null;
  return toolDefinitions
    .filter((tool) => (tool.isWriteTool ? allowWrite : allowRead))
    .filter((tool) => (allowedTools ? allowedTools.has(tool.name) : true))
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
}

export function validateToolInput(tool, input) {
  const schema = tool.inputSchema ?? { type: "object" };
  return validateSchema(schema, input);
}

export function summarizeToolCall(name, input) {
  return getToolSummary(name, input);
}

export async function executeTool(name, input, options) {
  const registry = getToolRegistry();
  const tool = registry.get(name);
  if (!tool) {
    const error = new Error("Tool not found.");
    error.code = "tool_not_found";
    throw error;
  }
  return tool.handler(input ?? {}, options ?? {});
}

export function isWriteTool(name) {
  const registry = getToolRegistry();
  return Boolean(registry.get(name)?.isWriteTool);
}
