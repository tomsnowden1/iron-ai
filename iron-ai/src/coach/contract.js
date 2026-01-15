export const COACH_CONTEXT_VERSION = "coach_context_v1";

/**
 * @typedef {Object} CoachContextV1
 * @property {string} version
 * @property {number|null} activeGymId
 * @property {string|null} activeGymName
 * @property {number} equipmentCount
 * @property {number} recentWorkoutsCount
 * @property {string|null} lastWorkoutDate
 * @property {number} templatesCount
 * @property {number} customExercisesCount
 * @property {number} exerciseLibraryCount
 * @property {number} contextBytes
 * @property {number} buildMs
 */

export const CoachContextV1Schema = {
  type: "object",
  required: [
    "version",
    "activeGymId",
    "activeGymName",
    "equipmentCount",
    "recentWorkoutsCount",
    "lastWorkoutDate",
    "templatesCount",
    "customExercisesCount",
    "exerciseLibraryCount",
    "contextBytes",
    "buildMs",
  ],
  properties: {
    version: { type: "string", enum: [COACH_CONTEXT_VERSION] },
    activeGymId: { type: "number", nullable: true },
    activeGymName: { type: "string", nullable: true },
    equipmentCount: { type: "integer", min: 0 },
    recentWorkoutsCount: { type: "integer", min: 0 },
    lastWorkoutDate: { type: "string", nullable: true },
    templatesCount: { type: "integer", min: 0 },
    customExercisesCount: { type: "integer", min: 0 },
    exerciseLibraryCount: { type: "integer", min: 0 },
    contextBytes: { type: "integer", min: 0 },
    buildMs: { type: "number", min: 0 },
  },
};

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function countEquipment(equipmentIds) {
  if (!Array.isArray(equipmentIds)) return 0;
  return equipmentIds.filter((id) => id && id !== "bodyweight").length;
}

function resolveLastWorkoutDate(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const session = sessions[0];
  return session?.finishedAt ?? session?.startedAt ?? null;
}

export function buildCoachContextContract({ snapshot, contextBytes, buildMs }) {
  const activeSpace = snapshot?.activeSpace ?? null;
  const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
  const templates = Array.isArray(snapshot?.templates) ? snapshot.templates : [];
  const exerciseLibrary = snapshot?.exerciseLibrary ?? null;
  const exerciseTotal = safeNumber(exerciseLibrary?.totalCount, 0);
  const exerciseCustom = safeNumber(exerciseLibrary?.customCount, 0);
  const exerciseLibraryCount = Math.max(0, exerciseTotal - exerciseCustom);

  return {
    version: COACH_CONTEXT_VERSION,
    activeGymId: activeSpace?.id ?? null,
    activeGymName: activeSpace?.name ?? null,
    equipmentCount: countEquipment(activeSpace?.equipmentIds),
    recentWorkoutsCount: sessions.length,
    lastWorkoutDate: resolveLastWorkoutDate(sessions),
    templatesCount: templates.length,
    customExercisesCount: exerciseCustom,
    exerciseLibraryCount,
    contextBytes: safeNumber(contextBytes, 0),
    buildMs: safeNumber(buildMs, 0),
  };
}
