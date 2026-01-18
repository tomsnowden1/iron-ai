import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Dumbbell,
  History,
  LayoutTemplate,
  MessageSquare,
  Copy,
  MoreHorizontal,
  MoreVertical,
  RefreshCcw,
  StickyNote,
  FileText,
  Flame,
  Info,
  Link2,
  Trash2,
} from "lucide-react";

import CoachView from "./features/coach/CoachView";
import ExerciseDetailView from "./features/exercises/ExerciseDetailView";
import ExerciseHistoryDrawer from "./features/exercises/ExerciseHistoryDrawer";
import ExercisePickerView from "./features/exercises/ExercisePickerView";
import ExercisesExplorer from "./features/exercises/ExercisesExplorer";
import SeedDebugMiniPanel from "./features/debug/SeedDebugMiniPanel";
import SeedDebugPanel from "./features/debug/SeedDebugPanel";
import DiagnosticsHub from "./features/debug/DiagnosticsHub";
import GymsView from "./features/gyms/GymsView";
import TemplatesList from "./features/templates/TemplatesList";
import TemplateEditor from "./features/templates/TemplateEditor";
import useTheme from "./utils/useTheme";
import {
  SEED_MIN_COUNT,
  resetExerciseSeedVersion,
  seedExercisesIfNeeded,
  repairSeededExercises,
} from "./seed/exerciseSeed";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
  Label,
  PageHeader,
  Select,
  ToastHost,
} from "./components/ui";
import { formatCoachMemory, getDefaultCoachMemory, normalizeCoachMemory } from "./coach/memory";
import { getEquipmentMap } from "./equipment/catalog";
import { getMissingEquipmentForExercise } from "./equipment/engine";
import { resolveActiveSpace } from "./workoutSpaces/logic";
import {
  clearOpenAIKey,
  getOpenAIKeyMasked,
  setOpenAIKey,
  testOpenAIKey,
  updateSettings,
  useSettings,
} from "./state/settingsStore";

import {
  db,
  addExerciseToWorkout,
  addWorkoutSet,
  addWarmupSets,
  createEmptyWorkout,
  deleteWorkout,
  finishWorkout,
  replaceWorkoutExercise,
  getAllExercises,
  getExerciseUsageCounts,
  getMostRecentActiveWorkoutId,
  getPreviousWorkoutSetsByExercise,
  getWorkoutWithDetails,
  listEquipment,
  listFinishedWorkouts,
  listWorkoutSpaces,
  removeWorkoutItem,
  removeWorkoutSet,
  restoreWorkoutSet,
  setActiveWorkoutSpace,
  startWorkoutFromTemplate,
  updateWorkoutSession,
  updateWorkoutSet,
} from "./db";

const SESSION_NOTE_LIMIT = 500;
const EXERCISE_NOTE_LIMIT = 250;
const SESSION_IDLE_MS = 8 * 60 * 1000;
const SESSION_PROLONGED_IDLE_MS = 12 * 60 * 1000;
const RESUME_BANNER_MINUTES_MS = 3 * 60 * 1000;
const NAV_ITEMS = [
  { id: "workout", label: "Workout", icon: Dumbbell },
  { id: "coach", label: "Coach", icon: MessageSquare },
  { id: "history", label: "History", icon: History },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "more", label: "More", icon: MoreHorizontal },
];
const KNOWN_TABS = new Set([
  "workout",
  "coach",
  "history",
  "summary",
  "templates",
  "more",
]);

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tabbar__button"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
    >
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function NotFoundView({ onGoHome }) {
  return (
    <div className="page">
      <PageHeader
        title="Page not found"
        subtitle="That section doesn't exist. Pick another tab to continue."
        actions={<Button onClick={onGoHome}>Go to Workout</Button>}
      />
      <Card>
        <CardBody>
          <p className="ui-muted">
            If you followed a stale link, try returning to the Workout tab and
            navigating again.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function formatRestTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseRestInput(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed);
}

function formatSetValue(set) {
  if (!set) return "—";
  const weight = set?.weight == null || set?.weight === "" ? "—" : set.weight;
  const reps = set?.reps == null || set?.reps === "" ? "—" : set.reps;
  if (weight === "—" && reps === "—") return "—";
  return `${weight}×${reps}`;
}

function parseSetMetric(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

const WorkoutSetRow = memo(function WorkoutSetRow({
  set,
  label,
  previousText,
  comparisonStatus,
  isWarmup,
  itemId,
  onUpdateSet,
  onRemoveSet,
  onToggleComplete,
  onStartLongPress,
  onCancelLongPress,
}) {
  const handleWeightChange = useCallback(
    (event) => {
      onUpdateSet(set.id, { weight: event.target.value });
    },
    [onUpdateSet, set.id]
  );

  const handleRepsChange = useCallback(
    (event) => {
      onUpdateSet(set.id, { reps: event.target.value });
    },
    [onUpdateSet, set.id]
  );

  const handleToggleDone = useCallback(
    (event) => {
      onToggleComplete(itemId, set.id, event.target.checked);
    },
    [itemId, onToggleComplete, set.id]
  );

  const handlePointerDown = useCallback(() => {
    onStartLongPress(itemId, set);
  }, [itemId, onStartLongPress, set]);

  const handlePointerCancel = useCallback(() => {
    onCancelLongPress(set.id);
  }, [onCancelLongPress, set.id]);

  const handleRemove = useCallback(() => {
    onRemoveSet(itemId, set.id);
  }, [itemId, onRemoveSet, set.id]);

  return (
    <div
      className={`workout-set-row${isWarmup ? " workout-set-row--warmup" : ""}`}
      data-workout-set-id={set.id}
    >
      <div className="set-index">{label}</div>
      <div className="set-prev">
        <span>{previousText}</span>
        {comparisonStatus ? (
          <span
            className="set-progress"
            data-status={comparisonStatus}
            aria-label={`Set ${label} progress: ${comparisonStatus}`}
          >
            {comparisonStatus === "improved"
              ? "↑"
              : comparisonStatus === "same"
                ? "•"
                : "↓"}
          </span>
        ) : null}
      </div>
      <Input
        inputMode="decimal"
        placeholder="kg"
        value={set.weight ?? ""}
        onChange={handleWeightChange}
        data-workout-set-id={set.id}
        data-workout-set-field="weight"
        className="workout-set-input"
      />
      <Input
        inputMode="numeric"
        placeholder="reps"
        value={set.reps ?? ""}
        onChange={handleRepsChange}
        data-workout-set-id={set.id}
        data-workout-set-field="reps"
        className="workout-set-input"
      />
      <div className="set-actions">
        <label className="set-done">
          <input
            type="checkbox"
            checked={Boolean(set.isComplete)}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerCancel}
            onPointerLeave={handlePointerCancel}
            onPointerCancel={handlePointerCancel}
            onChange={handleToggleDone}
            aria-label={`Mark set ${label} complete`}
          />
          <span>Done</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="set-remove-button"
          aria-label={`Remove set ${label}`}
          onClick={handleRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  );
});

function compareWorkoutSet(current, previous) {
  if (!current || !previous) return null;
  const currentWeight = parseSetMetric(current.weight);
  const currentReps = parseSetMetric(current.reps);
  const previousWeight = parseSetMetric(previous.weight);
  const previousReps = parseSetMetric(previous.reps);
  if (
    currentWeight == null ||
    currentReps == null ||
    previousWeight == null ||
    previousReps == null
  ) {
    return null;
  }
  if (currentWeight > previousWeight) return "improved";
  if (currentWeight === previousWeight && currentReps > previousReps) return "improved";
  if (currentWeight === previousWeight && currentReps === previousReps) return "same";
  return "worse";
}

function isComparableSet(set) {
  if (!set) return false;
  const weight = parseSetMetric(set.weight);
  const reps = parseSetMetric(set.reps);
  return weight != null && reps != null;
}

function compareSetQuality(current, previous) {
  if (!current || !previous) return 0;
  const currentWeight = parseSetMetric(current.weight);
  const currentReps = parseSetMetric(current.reps);
  const previousWeight = parseSetMetric(previous.weight);
  const previousReps = parseSetMetric(previous.reps);
  if (
    currentWeight == null ||
    currentReps == null ||
    previousWeight == null ||
    previousReps == null
  ) {
    return 0;
  }
  if (currentWeight > previousWeight) return 1;
  if (currentWeight === previousWeight && currentReps > previousReps) return 1;
  if (currentWeight === previousWeight && currentReps === previousReps) return 0;
  return -1;
}

function getBestComparableSet(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return null;
  return sets.reduce((best, set) => {
    if (!set || set.isWarmup) return best;
    if (!isComparableSet(set)) return best;
    if (!best) return set;
    return compareSetQuality(set, best) > 0 ? set : best;
  }, null);
}

function getLastWorkoutSet(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return null;
  return sets.reduce((latest, set) => {
    if (!latest) return set;
    const latestNumber = latest.setNumber ?? -Infinity;
    const currentNumber = set?.setNumber ?? -Infinity;
    return currentNumber >= latestNumber ? set : latest;
  }, null);
}

function getPrefillValues(sets) {
  const lastSet = getLastWorkoutSet(sets);
  if (!lastSet) return {};
  const weight = lastSet?.weight ?? "";
  const reps = lastSet?.reps ?? "";
  const prefill = {};
  if (weight !== "") prefill.weight = weight;
  if (reps !== "") prefill.reps = reps;
  return prefill;
}

function WorkoutView({
  workoutId,
  setWorkoutId,
  onFinish,
  onNotify,
  pickerIntent,
  onConsumePickerIntent,
}) {
  // Hooks MUST be at the top, always called
  const workoutBundle = useLiveQuery(
    () => (workoutId ? getWorkoutWithDetails(workoutId) : null),
    [workoutId]
  );
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const equipmentList = useLiveQuery(() => listEquipment(), []);

  const viewRef = useRef(null);
  const restFieldId = useId();
  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const exerciseUsageCounts = useLiveQuery(() => getExerciseUsageCounts(), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPrefill, setPickerPrefill] = useState(null);
  const [pickerMode, setPickerMode] = useState("add");
  const [replaceItem, setReplaceItem] = useState(null);
  const [finishMessage, setFinishMessage] = useState("");
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(null);
  const [restEnabled, setRestEnabled] = useState(true);
  const [restDefaultSeconds, setRestDefaultSeconds] = useState(60);
  const [restDefaultInput, setRestDefaultInput] = useState("60");
  const [showRestTimer, setShowRestTimer] = useState(true);
  const [restSheetOpen, setRestSheetOpen] = useState(false);
  const [restRunning, setRestRunning] = useState(false);
  const [restRemaining, setRestRemaining] = useState(60);
  const [restDuration, setRestDuration] = useState(60);
  const [restHint, setRestHint] = useState("");
  const restEndsAtRef = useRef(null);
  const [sessionNoteOpen, setSessionNoteOpen] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const [sessionNoteFocused, setSessionNoteFocused] = useState(false);
  const [exerciseNotes, setExerciseNotes] = useState({});
  const [exerciseNoteSheet, setExerciseNoteSheet] = useState(null);
  const [exerciseNoteDraft, setExerciseNoteDraft] = useState("");
  const [menuItemId, setMenuItemId] = useState(null);
  const [sessionState, setSessionState] = useState("active");
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [isProlongedIdle, setIsProlongedIdle] = useState(false);
  const [supersetSheetItemId, setSupersetSheetItemId] = useState(null);
  const [detailExerciseId, setDetailExerciseId] = useState(null);
  const [historyExercise, setHistoryExercise] = useState(null);
  const scrollRestoreRef = useRef(0);
  const pendingScrollRestoreRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const autoScrollAppliedRef = useRef(false);
  const longPressTimeoutsRef = useRef(new Map());
  const longPressTriggeredRef = useRef(new Set());
  const lastActivityAtRef = useRef(Date.now());
  const lastBackgroundAtRef = useRef(null);
  const resumeBannerShownRef = useRef(false);

  // Safe defaults so we can compute memos without crashing
  const workout = workoutBundle?.workout ?? null;
  const items = useMemo(() => {
    const rawItems = Array.isArray(workoutBundle?.items) ? workoutBundle.items : [];
    let warned = false;
    return rawItems
      .filter(Boolean)
      .map((item) => {
        if (!Array.isArray(item.sets)) {
          if (!warned) {
            console.error(
              "Workout items contain invalid set arrays; falling back to empty arrays."
            );
            warned = true;
          }
          return { ...item, sets: [] };
        }
        return item;
      });
  }, [workoutBundle]);
  const totalSets = useMemo(
    () => items.reduce((sum, it) => sum + (it.sets?.length ?? 0), 0),
    [items]
  );
  const exerciseIdPayload = useMemo(() => {
    const uniqueIds = Array.from(
      new Set(items.map((item) => item.exerciseId).filter((id) => id != null))
    );
    return { ids: uniqueIds, key: uniqueIds.join("|") };
  }, [items]);
  const exerciseIds = exerciseIdPayload.ids;
  const settingsActiveSpaceId = settings?.active_space_id ?? null;
  const activeSpace = useMemo(
    () => resolveActiveSpace(workoutSpaces ?? [], settingsActiveSpaceId),
    [settingsActiveSpaceId, workoutSpaces]
  );
  const workoutSpace = useMemo(() => {
    if (!workout) return activeSpace;
    if (workout.spaceId != null) {
      return (workoutSpaces ?? []).find((space) => space.id === workout.spaceId) ?? null;
    }
    return activeSpace;
  }, [activeSpace, workout, workoutSpaces]);
  const pickerSpace = workoutSpace ?? activeSpace;
  const startSpaceId = activeSpace?.id ?? null;
  const activeSpaceSelectValue =
    settingsActiveSpaceId != null && settingsActiveSpaceId === activeSpace?.id
      ? String(settingsActiveSpaceId)
      : "";
  const equipmentMap = useMemo(
    () => getEquipmentMap(equipmentList ?? []),
    [equipmentList]
  );
  const missingEquipmentByItem = useMemo(() => {
    if (!workoutSpace || !items.length) return new Map();
    const map = new Map();
    items.forEach((item) => {
      if (!item.exercise) return;
      const missing = getMissingEquipmentForExercise(
        item.exercise,
        workoutSpace.equipmentIds ?? [],
        equipmentMap
      );
      if (missing.length) {
        map.set(item.id, missing);
      }
    });
    return map;
  }, [equipmentMap, items, workoutSpace]);
  const previousSetsByExercise = useLiveQuery(
    () => getPreviousWorkoutSetsByExercise(exerciseIds, workout?.id ?? null),
    [exerciseIdPayload.key, workout?.id]
  );
  const supersetLabels = useMemo(() => {
    const labels = new Map();
    let index = 0;
    items.forEach((item) => {
      const groupId = item.supersetGroupId;
      if (!groupId || labels.has(groupId)) return;
      const letter = String.fromCharCode(65 + (index % 26));
      labels.set(groupId, `Superset ${letter}`);
      index += 1;
    });
    return labels;
  }, [items]);
  const activeMenuItem = useMemo(
    () => items.find((item) => item.id === menuItemId) ?? null,
    [items, menuItemId]
  );
  const isIdle = sessionState === "idle";

  const existingExerciseIds = useMemo(() => {
    return new Set(items.map((i) => i.exerciseId));
  }, [items]);
  const pickerExcludeIds = useMemo(() => {
    if (pickerMode !== "replace" || !replaceItem) return existingExerciseIds;
    const next = new Set(existingExerciseIds);
    next.delete(replaceItem.exerciseId);
    return next;
  }, [existingExerciseIds, pickerMode, replaceItem]);

  useEffect(() => {
    setPickerOpen(false);
    setPickerPrefill(null);
    setMenuItemId(null);
    setExerciseNoteSheet(null);
    setExerciseNoteDraft("");
    setSupersetSheetItemId(null);
    setDetailExerciseId(null);
    pendingScrollRestoreRef.current = null;
    pendingFocusRef.current = null;
    autoScrollAppliedRef.current = false;
  }, [workoutId]);

  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    lastBackgroundAtRef.current = null;
    resumeBannerShownRef.current = false;
    setSessionState("active");
    setIsProlongedIdle(false);
    setShowResumeBanner(false);
  }, [workoutId]);

  useEffect(() => {
    if (!pickerIntent || !workoutId) return;
    setPickerMode("add");
    setPickerPrefill(pickerIntent);
    setPickerOpen(true);
    onConsumePickerIntent?.();
  }, [onConsumePickerIntent, pickerIntent, workoutId]);

  useEffect(() => {
    if (!workout || sessionNoteFocused) return;
    setSessionNote(typeof workout.sessionNote === "string" ? workout.sessionNote : "");
  }, [sessionNoteFocused, workout]);

  useEffect(() => {
    if (!workout || exerciseNoteSheet) return;
    const next = workout.exerciseNotes ?? {};
    setExerciseNotes({ ...next });
  }, [exerciseNoteSheet, workout]);

  useEffect(() => {
    if (!workout || workout.finishedAt) return;
    if (resumeBannerShownRef.current) return;
    const startedAtMs = workout.startedAt ? new Date(workout.startedAt).getTime() : null;
    if (startedAtMs && Date.now() - startedAtMs > RESUME_BANNER_MINUTES_MS) {
      setShowResumeBanner(true);
      resumeBannerShownRef.current = true;
    }
  }, [workout, workout?.finishedAt, workout?.startedAt]);

  useEffect(() => {
    const enabled = settings?.rest_enabled;
    const defaultSeconds = parseRestInput(settings?.rest_default_seconds) ?? 60;
    const timerVisible = settings?.show_rest_timer;
    setRestEnabled(enabled ?? true);
    setRestDefaultSeconds(defaultSeconds);
    setShowRestTimer(timerVisible ?? true);
  }, [settings]);

  useEffect(() => {
    setRestDefaultInput(String(restDefaultSeconds));
  }, [restDefaultSeconds]);

  useEffect(() => {
    if (!restRunning) {
      setRestDuration(restDefaultSeconds);
      setRestRemaining(restDefaultSeconds);
    }
  }, [restDefaultSeconds, restRunning]);

  useEffect(() => {
    if (restEnabled) return;
    setRestRunning(false);
    setRestHint("");
    restEndsAtRef.current = null;
  }, [restEnabled]);

  useEffect(() => {
    if (showRestTimer) return;
    setRestSheetOpen(false);
  }, [showRestTimer]);

  useEffect(() => {
    if (!workoutId || workout?.finishedAt) return;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        setSessionState("backgrounded");
        lastBackgroundAtRef.current = Date.now();
        return;
      }
      const idleFor = Date.now() - lastActivityAtRef.current;
      const nextState = idleFor >= SESSION_IDLE_MS ? "idle" : "active";
      setSessionState(nextState);
      setIsProlongedIdle(idleFor >= SESSION_PROLONGED_IDLE_MS);
      if (lastBackgroundAtRef.current) {
        setShowResumeBanner(true);
        resumeBannerShownRef.current = true;
      }
    };
    const handleBlur = () => {
      if (document.visibilityState !== "hidden") {
        setSessionState("backgrounded");
        lastBackgroundAtRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("blur", handleBlur);
    };
  }, [workoutId, workout?.finishedAt]);

  useEffect(() => {
    if (!workoutId || workout?.finishedAt) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const idleFor = Date.now() - lastActivityAtRef.current;
      const nextState = idleFor >= SESSION_IDLE_MS ? "idle" : "active";
      setSessionState((prev) =>
        prev === "backgrounded" || prev === nextState ? prev : nextState
      );
      setIsProlongedIdle(idleFor >= SESSION_PROLONGED_IDLE_MS);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [workoutId, workout?.finishedAt]);

  const markSessionActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setIsProlongedIdle(false);
    setSessionState((prev) => (prev === "backgrounded" ? prev : "active"));
    setShowResumeBanner(false);
  }, []);

  const persistRestSettings = useCallback((patch) => {
    return (async () => {
      const current = await db.settings.get(1);
      const base = current ?? { id: 1 };
      await db.settings.put({ ...base, ...patch, id: 1 });
    })();
  }, []);

  const startRestTimer = useCallback(
    (seconds, hint) => {
      if (!restEnabled) return;
      const safeSeconds = Math.max(0, Math.round(seconds));
      setRestDuration(safeSeconds);
      setRestRemaining(safeSeconds);
      setRestHint(hint ?? "");
      if (safeSeconds === 0) {
        setRestRunning(false);
        restEndsAtRef.current = null;
        return;
      }
      restEndsAtRef.current = Date.now() + safeSeconds * 1000;
      setRestRunning(true);
    },
    [restEnabled]
  );

  const pauseRestTimer = useCallback(() => {
    if (!restRunning) return;
    const endsAt = restEndsAtRef.current;
    if (endsAt) {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRestRemaining(remaining);
    }
    setRestRunning(false);
    restEndsAtRef.current = null;
  }, [restRunning]);

  const resolveRestSeconds = useCallback(() => restDefaultSeconds, [restDefaultSeconds]);

  const buildNextHint = useCallback(
    (itemId, setId) => {
      const itemIndex = items.findIndex((it) => it.id === itemId);
      if (itemIndex === -1) return "";
      const currentItem = items[itemIndex];
      const setIndex = currentItem.sets?.findIndex((s) => s.id === setId) ?? -1;
      const nextSet =
        setIndex >= 0 && currentItem.sets ? currentItem.sets[setIndex + 1] : null;

      if (nextSet) {
        return `Next: Set ${nextSet.setNumber} / ${
          currentItem.exercise?.name ?? "Exercise"
        }`;
      }

      const nextItem = items[itemIndex + 1];
      if (nextItem) {
        const nextSetNumber = nextItem.sets?.[0]?.setNumber ?? 1;
        return `Next: Set ${nextSetNumber} / ${nextItem.exercise?.name ?? "Exercise"}`;
      }

      return "Next: Finish workout";
    },
    [items]
  );

  const startRestForSet = useCallback(
    (itemId, setId) => {
      const item = items.find((it) => it.id === itemId);
      const set = item?.sets?.find((s) => s.id === setId);
      if (!item || !set) return;
      const seconds = resolveRestSeconds();
      const hint = buildNextHint(itemId, setId);
      startRestTimer(seconds, hint);
    },
    [items, resolveRestSeconds, buildNextHint, startRestTimer]
  );

  const handleCompleteSet = (itemId, setId) => {
    startRestForSet(itemId, setId);
  };

  const addSetAndFocus = useCallback(
    async (itemId, options) => {
      if (!itemId) return null;
      pendingScrollRestoreRef.current = window.scrollY ?? 0;
      const setId = await addWorkoutSet(itemId, options);
      if (setId != null) {
        pendingFocusRef.current = { setId, field: "weight" };
      }
      return setId;
    },
    [addWorkoutSet]
  );

  useEffect(() => {
    if (!workoutId) return;
    // Cmd/Ctrl + Enter completes the focused set and adds a new one.
    const handleKeyDown = async (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      const active = document.activeElement;
      if (!viewRef.current || !active || !viewRef.current.contains(active)) return;

      const itemEl = active.closest?.("[data-workout-item-id]");
      if (!itemEl) return;
      const itemId = Number(itemEl.dataset.workoutItemId);
      if (!itemId || Number.isNaN(itemId)) return;

      event.preventDefault();
      const setEl = active.closest?.("[data-workout-set-id]");
      if (setEl) {
        const setId = Number(setEl.dataset.workoutSetId);
        if (setId && !Number.isNaN(setId)) {
          startRestForSet(itemId, setId);
        }
      }
      markSessionActivity();
      const item = items.find((entry) => entry.id === itemId);
      if (item) {
        const prefill = getPrefillValues(item.sets);
        await addSetAndFocus(itemId, prefill);
      } else {
        await addSetAndFocus(itemId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addSetAndFocus, items, markSessionActivity, startRestForSet, workoutId]);

  useEffect(() => {
    if (!restRunning) return;
    const tick = () => {
      const endsAt = restEndsAtRef.current;
      if (!endsAt) return;
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        setRestRemaining(restDuration);
        setRestRunning(false);
        restEndsAtRef.current = null;
        setRestHint("");
        onNotify?.("Rest complete", { tone: "success", duration: 2000 });
        return;
      }
      setRestRemaining(remaining);
    };

    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [onNotify, restDuration, restRunning]);

  const focusWorkoutField = useCallback((setId, field) => {
    if (!setId || !viewRef.current) return;
    const selector = `[data-workout-set-id="${setId}"][data-workout-set-field="${field}"]`;
    const input = viewRef.current.querySelector(selector);
    if (!input || typeof input.focus !== "function") return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  }, []);

  const resolveNextIncompleteSetId = useCallback(
    (itemId, setId) => {
      const itemIndex = items.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) return null;
      const currentSets = items[itemIndex]?.sets ?? [];
      const currentIndex = currentSets.findIndex((set) => set.id === setId);
      for (let i = currentIndex + 1; i < currentSets.length; i += 1) {
        if (!currentSets[i]?.isComplete) return currentSets[i].id;
      }
      for (let i = itemIndex + 1; i < items.length; i += 1) {
        const nextSet = (items[i]?.sets ?? []).find((set) => !set?.isComplete);
        if (nextSet) return nextSet.id;
      }
      return null;
    },
    [items]
  );

  useEffect(() => {
    if (pendingScrollRestoreRef.current != null) {
      window.scrollTo({ top: pendingScrollRestoreRef.current, behavior: "auto" });
      pendingScrollRestoreRef.current = null;
    }
    if (pendingFocusRef.current) {
      const { setId, field } = pendingFocusRef.current;
      pendingFocusRef.current = null;
      focusWorkoutField(setId, field);
    }
  }, [focusWorkoutField, items]);

  useEffect(() => {
    if (!workoutId || !items.length) return;
    if (autoScrollAppliedRef.current) return;
    if ((window.scrollY ?? 0) > 20) return;
    const active = document.activeElement;
    if (active && viewRef.current?.contains(active)) return;
    const firstIncompleteItem = items.find((item) =>
      (item.sets ?? []).some((set) => !set?.isComplete)
    );
    if (!firstIncompleteItem) {
      autoScrollAppliedRef.current = true;
      return;
    }
    const target = viewRef.current?.querySelector(
      `[data-workout-item-id="${firstIncompleteItem.id}"]`
    );
    if (!target) return;
    autoScrollAppliedRef.current = true;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [items, workoutId]);

  // Handlers
  const openReplacePicker = (workoutItem) => {
    setReplaceItem(workoutItem);
    setPickerMode("replace");
    setPickerPrefill(null);
    setPickerOpen(true);
    setMenuItemId(null);
  };

  const handleToggleRestEnabled = () => {
    const next = !restEnabled;
    setRestEnabled(next);
    if (!next) {
      setRestRunning(false);
      setRestHint("");
      restEndsAtRef.current = null;
      setRestDuration(restDefaultSeconds);
      setRestRemaining(restDefaultSeconds);
    }
    void persistRestSettings({ rest_enabled: next });
  };

  const handleRestDefaultChange = (event) => {
    const nextValue = event.target.value;
    setRestDefaultInput(nextValue);
    const parsed = parseRestInput(nextValue);
    if (parsed == null) return;
    setRestDefaultSeconds(parsed);
    void persistRestSettings({ rest_default_seconds: parsed });
  };

  const handleStartPauseRest = () => {
    if (!restEnabled) return;
    if (restRunning) {
      pauseRestTimer();
      return;
    }
    const seconds = restRemaining > 0 ? restRemaining : restDuration;
    let hint = restHint;
    if (!hint) {
      const activeItem =
        typeof activeExerciseIndex === "number" ? items[activeExerciseIndex] : items[0];
      if (activeItem) {
        const nextSetNumber = activeItem.sets?.[0]?.setNumber ?? 1;
        hint = `Next: Set ${nextSetNumber} / ${activeItem.exercise?.name ?? "Exercise"}`;
      }
    }
    startRestTimer(seconds, hint);
  };

  const longPressDoneAddsNext = settings?.long_press_done_adds_next ?? false;

  const handleAddSet = useCallback(
    async (item) => {
      if (!item) return;
      const prefill = getPrefillValues(item.sets);
      markSessionActivity();
      await addSetAndFocus(item.id, prefill);
    },
    [addSetAndFocus, markSessionActivity]
  );

  const handleDuplicateLastSet = useCallback(
    async (item) => {
      if (!item) return;
      const lastSet = getLastWorkoutSet(item.sets);
      if (!lastSet) return;
      markSessionActivity();
      await addSetAndFocus(item.id, {
        weight: lastSet.weight ?? "",
        reps: lastSet.reps ?? "",
        isWarmup: lastSet.isWarmup ?? false,
      });
    },
    [addSetAndFocus, markSessionActivity]
  );

  const handleCompleteAndAddSet = useCallback(
    async (itemId, set) => {
      if (!itemId || !set || set.isComplete) return;
      markSessionActivity();
      await updateWorkoutSet(set.id, { isComplete: true });
      handleCompleteSet(itemId, set.id);
      const weight = set.weight ?? "";
      const reps = set.reps ?? "";
      await addSetAndFocus(itemId, {
        weight: weight === "" ? undefined : weight,
        reps: reps === "" ? undefined : reps,
        isWarmup: set.isWarmup ?? false,
      });
    },
    [addSetAndFocus, handleCompleteSet, markSessionActivity, updateWorkoutSet]
  );

  const clearLongPress = useCallback((setId) => {
    const timer = longPressTimeoutsRef.current.get(setId);
    if (timer) {
      window.clearTimeout(timer);
      longPressTimeoutsRef.current.delete(setId);
    }
  }, []);

  const startLongPress = useCallback(
    (itemId, set) => {
      if (!longPressDoneAddsNext || !itemId || !set || set.isComplete) return;
      clearLongPress(set.id);
      const timer = window.setTimeout(() => {
        longPressTriggeredRef.current.add(set.id);
        void handleCompleteAndAddSet(itemId, set);
      }, 450);
      longPressTimeoutsRef.current.set(set.id, timer);
    },
    [clearLongPress, handleCompleteAndAddSet, longPressDoneAddsNext]
  );

  const cancelLongPress = useCallback(
    (setId) => {
      clearLongPress(setId);
    },
    [clearLongPress]
  );

  const handleWorkoutSetUpdate = useCallback(
    (setId, patch) => {
      markSessionActivity();
      void updateWorkoutSet(setId, patch);
    },
    [markSessionActivity, updateWorkoutSet]
  );

  const handleRemoveWorkoutSet = useCallback(
    (itemId, setId) => {
      const item = items.find((entry) => entry.id === itemId);
      const removedSet = item?.sets?.find((set) => set.id === setId);
      markSessionActivity();
      void removeWorkoutSet(itemId, setId);
      if (!removedSet) return;
      onNotify?.(`Set ${removedSet.setNumber ?? ""} removed.`, {
        tone: "info",
        duration: 5000,
        actionLabel: "Undo",
        onAction: async () => {
          await restoreWorkoutSet(itemId, removedSet);
          onNotify?.("Set restored ✅", { tone: "success", duration: 2000 });
        },
      });
    },
    [items, markSessionActivity, onNotify, removeWorkoutSet]
  );

  const handleToggleWorkoutSetComplete = useCallback(
    (itemId, setId, checked) => {
      if (longPressTriggeredRef.current.has(setId)) {
        longPressTriggeredRef.current.delete(setId);
        return;
      }
      markSessionActivity();
      void updateWorkoutSet(setId, { isComplete: checked });
      if (checked) {
        handleCompleteSet(itemId, setId);
        const nextSetId = resolveNextIncompleteSetId(itemId, setId);
        if (nextSetId) {
          pendingFocusRef.current = { setId: nextSetId, field: "weight" };
        }
      }
    },
    [handleCompleteSet, markSessionActivity, resolveNextIncompleteSetId, updateWorkoutSet]
  );

  const handleResetRest = () => {
    restEndsAtRef.current = null;
    setRestRunning(false);
    setRestRemaining(restDuration);
    setRestHint("");
  };

  const handleOpenExerciseHistory = (item) => {
    if (!item?.exerciseId) return;
    setHistoryExercise({
      id: item.exerciseId,
      name: item.exercise?.name ?? "Exercise",
      stickyNote: item.exercise?.stickyNote ?? "",
    });
  };

  const handleOpenExerciseDetail = (exerciseId) => {
    if (!exerciseId) return;
    setHistoryExercise(null);
    scrollRestoreRef.current = window.scrollY ?? 0;
    setDetailExerciseId(exerciseId);
  };

  const handleCloseExerciseDetail = () => {
    setDetailExerciseId(null);
    window.setTimeout(() => {
      window.scrollTo({ top: scrollRestoreRef.current, behavior: "auto" });
    }, 0);
  };

  const openExerciseNoteSheet = (item) => {
    if (!item) return;
    setExerciseNoteSheet({ type: "note", itemId: item.id, exerciseId: item.exerciseId });
    setExerciseNoteDraft(exerciseNotes?.[item.exerciseId] ?? "");
    setMenuItemId(null);
  };

  const openStickyNoteSheet = (item) => {
    if (!item) return;
    setExerciseNoteSheet({ type: "sticky", itemId: item.id, exerciseId: item.exerciseId });
    setExerciseNoteDraft(item.exercise?.stickyNote ?? "");
    setMenuItemId(null);
  };

  const handleSaveExerciseNote = async () => {
    if (!exerciseNoteSheet) return;
    const trimmed = exerciseNoteDraft.trim();
    if (exerciseNoteSheet.type === "note") {
      if (!workoutId) return;
      const next = { ...(workout?.exerciseNotes ?? {}) };
      if (trimmed) {
        next[exerciseNoteSheet.exerciseId] = trimmed;
      } else {
        delete next[exerciseNoteSheet.exerciseId];
      }
      setExerciseNotes({ ...next });
      await updateWorkoutSession(workoutId, { exerciseNotes: next });
    } else {
      await db.table("exercises").update(exerciseNoteSheet.exerciseId, {
        stickyNote: trimmed,
      });
    }
    setExerciseNoteSheet(null);
    setExerciseNoteDraft("");
  };

  const handleAddWarmup = async (itemId) => {
    if (!itemId) return;
    await addWarmupSets(itemId, 2);
    onNotify?.("Warm-up sets added ✅", { tone: "success" });
    setMenuItemId(null);
  };

  const handleDeleteExercise = async (item) => {
    if (!item) return;
    const hasNote = Boolean(exerciseNotes?.[item.exerciseId]?.trim());
    const hasSticky = Boolean(item.exercise?.stickyNote?.trim());
    const supersetGroupId = item.supersetGroupId;
    const supersetItemIds = supersetGroupId
      ? items
          .filter((entry) => entry.supersetGroupId === supersetGroupId)
          .map((entry) => entry.id)
      : [];
    const workoutItemRecord = { ...item };
    delete workoutItemRecord.exercise;
    delete workoutItemRecord.sets;
    const setRecords = item.sets?.map((set) => ({
      ...set,
      workoutItemId: item.id,
    }));
    const noteValue = hasNote ? exerciseNotes?.[item.exerciseId] : null;
    if (item.supersetGroupId) {
      await clearSupersetGroup(item.supersetGroupId);
    }
    await removeWorkoutItem(item.id);
    setMenuItemId(null);
    if (hasNote && workoutId) {
      const next = { ...(workout?.exerciseNotes ?? {}) };
      delete next[item.exerciseId];
      setExerciseNotes({ ...next });
      await updateWorkoutSession(workoutId, { exerciseNotes: next });
    }
    if (hasSticky) {
      onNotify?.("Sticky note preserved for this exercise.", { tone: "info" });
    }
    onNotify?.("Exercise removed.", {
      tone: "info",
      duration: 6000,
      actionLabel: "Undo",
      onAction: async () => {
        try {
          await db.transaction(
            "rw",
            db.table("workoutItems"),
            db.table("workoutSets"),
            async () => {
              await db.table("workoutItems").add(workoutItemRecord);
              if (Array.isArray(setRecords) && setRecords.length) {
                await db.table("workoutSets").bulkAdd(setRecords);
              }
            }
          );
          if (noteValue && workoutId) {
            const nextNotes = { ...(workout?.exerciseNotes ?? {}) };
            nextNotes[item.exerciseId] = noteValue;
            setExerciseNotes({ ...nextNotes });
            await updateWorkoutSession(workoutId, { exerciseNotes: nextNotes });
          }
          if (supersetGroupId && supersetItemIds.length) {
            await db.transaction("rw", db.table("workoutItems"), async () => {
              for (const entryId of supersetItemIds) {
                await db
                  .table("workoutItems")
                  .update(entryId, { supersetGroupId });
              }
            });
          }
          onNotify?.("Exercise restored ✅", { tone: "success", duration: 2000 });
        } catch (error) {
          onNotify?.("Unable to restore exercise.", { tone: "error" });
        }
      },
    });
  };

  const clearSupersetGroup = useCallback(
    async (groupId) => {
      if (!groupId || !workoutId) return;
      await db
        .table("workoutItems")
        .where({ workoutId, supersetGroupId: groupId })
        .modify({ supersetGroupId: null });
    },
    [workoutId]
  );

  const handleCreateSuperset = useCallback(
    async (primaryId, partnerId) => {
      const primary = items.find((it) => it.id === primaryId);
      const partner = items.find((it) => it.id === partnerId);
      if (!primary || !partner || !workoutId) return;
      const groupId = `superset-${Date.now()}`;
      const groupsToClear = new Set(
        [primary.supersetGroupId, partner.supersetGroupId].filter(Boolean)
      );
      await db.transaction("rw", db.table("workoutItems"), async () => {
        for (const existingGroup of groupsToClear) {
          await db
            .table("workoutItems")
            .where({ workoutId, supersetGroupId: existingGroup })
            .modify({ supersetGroupId: null });
        }
        await db.table("workoutItems").update(primaryId, { supersetGroupId: groupId });
        await db.table("workoutItems").update(partnerId, { supersetGroupId: groupId });
      });
      setSupersetSheetItemId(null);
      setMenuItemId(null);
      onNotify?.("Superset created ✅", { tone: "success" });
    },
    [items, onNotify, workoutId]
  );

  const handleRemoveSuperset = useCallback(
    async (groupId) => {
      if (!groupId) return;
      const groupItems = items
        .filter((item) => item.supersetGroupId === groupId)
        .map((item) => item.id);
      await clearSupersetGroup(groupId);
      setSupersetSheetItemId(null);
      setMenuItemId(null);
      onNotify?.("Superset unlinked.", {
        tone: "info",
        duration: 5000,
        actionLabel: "Undo",
        onAction: async () => {
          if (!groupItems.length) return;
          await db.transaction("rw", db.table("workoutItems"), async () => {
            for (const itemId of groupItems) {
              await db.table("workoutItems").update(itemId, { supersetGroupId: groupId });
            }
          });
          onNotify?.("Superset restored ✅", { tone: "success", duration: 2000 });
        },
      });
    },
    [clearSupersetGroup, items, onNotify]
  );

  const handleSelectExercise = async (exerciseId) => {
    if (!exerciseId || !workoutId) return false;
    try {
      if (pickerMode === "replace" && replaceItem) {
        if (exerciseId === replaceItem.exerciseId) {
          setPickerOpen(false);
          setPickerPrefill(null);
          setPickerMode("add");
          setReplaceItem(null);
          return true;
        }
        await replaceWorkoutExercise(replaceItem.id, exerciseId);
      } else {
        await addExerciseToWorkout(workoutId, exerciseId);
      }
      setPickerOpen(false);
      setPickerPrefill(null);
      setPickerMode("add");
      setReplaceItem(null);
      return true;
    } catch (err) {
      const fallback =
        pickerMode === "replace"
          ? "Could not replace exercise."
          : "Could not add exercise.";
      onNotify?.(err?.message ?? fallback, { tone: "error" });
      return false;
    }
  };

  const handleFinish = async () => {
    if (items.length === 0) {
      setFinishMessage("Add at least one exercise before finishing.");
      return;
    }
    if (totalSets === 0) {
      setFinishMessage("Add at least one set before finishing.");
      return;
    }
    setFinishMessage("");
    const startedAt = workout?.startedAt ?? null;
    const startedMs = startedAt ? new Date(startedAt).getTime() : null;
    const durationMs = startedMs && !Number.isNaN(startedMs) ? Date.now() - startedMs : null;
    const estimatedMinutes = durationMs ? Math.max(1, Math.round(durationMs / 60000)) : null;

    const summary = {
      workoutId,
      totalExercises: items.length,
      totalSets,
      estimatedMinutes,
    };

    try {
      await finishWorkout(workoutId);
    } catch {
      setFinishMessage("Unable to finish workout. Try again.");
      return;
    }
    onNotify?.("Workout finished ✅", { tone: "success" });
    setWorkoutId(null);
    onFinish?.(summary);
  };

  const handleDeleteWorkout = async () => {
    if (!window.confirm("Delete this workout? This cannot be undone.")) return;
    await deleteWorkout(workoutId);
    setWorkoutId(null);
  };

  const handleSessionNoteBlur = async () => {
    setSessionNoteFocused(false);
    if (!workoutId) return;
    const nextNote = sessionNote.trim();
    await updateWorkoutSession(workoutId, { sessionNote: nextNote });
  };

  const pickerTitle =
    pickerMode === "replace" ? "Replace exercise" : "Add exercise";
  const pickerSubtitle =
    pickerMode === "replace"
      ? "Choose a new exercise to swap in."
      : "Pick an exercise to add to this workout.";

  if (detailExerciseId) {
    return (
      <ExerciseDetailView
        exerciseId={detailExerciseId}
        onBack={handleCloseExerciseDetail}
        onOpenExercise={(nextId) => setDetailExerciseId(nextId)}
      />
    );
  }

  if (pickerOpen) {
    return (
      <ExercisePickerView
        title={pickerTitle}
        subtitle={pickerSubtitle}
        exercises={allExercises}
        equipmentList={equipmentList}
        usageStats={exerciseUsageCounts}
        activeSpace={pickerSpace}
        settings={settings}
        excludeExerciseIds={pickerExcludeIds}
        prefillExercise={pickerPrefill}
        onSelectExercise={handleSelectExercise}
        onClose={() => {
          setPickerOpen(false);
          setPickerPrefill(null);
          setPickerMode("add");
          setReplaceItem(null);
        }}
      />
    );
  }

  // NOW safe to early-return UI
  if (!workoutId) {
    return (
      <div className="page" ref={viewRef}>
        <PageHeader
          title="Workout"
          subtitle="Track your session and log sets with ease."
        />

        <Card>
          <CardBody>
            <div className="empty-state">
              No active workout yet. Create an empty workout to get started.
            </div>
            {workoutSpaces && workoutSpaces.length ? (
              <div className="ui-stack">
                <Label htmlFor="active-space-select">Active workout space</Label>
                <Select
                  id="active-space-select"
                  value={activeSpaceSelectValue}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    const nextId = nextValue ? Number(nextValue) : null;
                    void setActiveWorkoutSpace(Number.isNaN(nextId) ? null : nextId);
                  }}
                >
                  <option value="">
                    Use default space{activeSpace?.name ? ` (${activeSpace.name})` : ""}
                  </option>
                  {workoutSpaces.map((space) => (
                    <option key={space.id} value={String(space.id)}>
                      {space.name ?? "Untitled Space"}
                    </option>
                  ))}
                </Select>
                <div className="template-meta">
                  Active space is saved and used for equipment-aware planning.
                </div>
              </div>
            ) : (
                <div className="template-meta">
                  Add gyms in Library to tailor equipment availability.
                </div>
            )}
          </CardBody>
          <CardFooter>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={async () => {
                const id = await createEmptyWorkout({ spaceId: startSpaceId });
                setWorkoutId(id);
              }}
            >
              New Empty Workout
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!workout) {
    return (
      <div className="page" ref={viewRef}>
        <PageHeader title="Workout" subtitle="Loading your current session." />
        <Card>
          <CardBody className="ui-muted">Loading workout…</CardBody>
        </Card>
      </div>
    );
  }

  const startedLabel = workout.startedAt
    ? new Date(workout.startedAt).toLocaleString()
    : "—";
  const templateLabel = workout.templateId ? `#${workout.templateId}` : "Custom";
  const spaceLabel = workoutSpace?.name ?? "Default";

  const workoutSubtitle = (
    <span>
      Started {startedLabel}
      {workout.templateId ? ` · Template #${workout.templateId}` : ""}
    </span>
  );
  const supersetSheetItem = supersetSheetItemId
    ? items.find((item) => item.id === supersetSheetItemId) ?? null
    : null;
  const supersetGroupItems = supersetSheetItem?.supersetGroupId
    ? items.filter((item) => item.supersetGroupId === supersetSheetItem.supersetGroupId)
    : [];
  const supersetPartnerOptions = supersetSheetItem
    ? items.filter((item) => item.id !== supersetSheetItem.id)
    : [];

  return (
    <div className="page" ref={viewRef}>
      <PageHeader
        title="Workout"
        subtitle={workoutSubtitle}
        actions={
          <Button variant="destructive" size="sm" onClick={handleDeleteWorkout}>
            Delete
          </Button>
        }
      />

      {showResumeBanner ? (
        <div className="workout-resume-banner" role="status">
          <div>
            <div className="ui-strong">Resume workout</div>
            <div className="template-meta">Your session is still active.</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              markSessionActivity();
              setShowResumeBanner(false);
            }}
          >
            Resume
          </Button>
        </div>
      ) : null}

      <div className="workout-stats-bar">
        <div className="workout-stats-title">
          <span className="ui-section-title">Session</span>
          {workoutSpace?.name ? <span className="pill">{workoutSpace.name}</span> : null}
        </div>
        <div className="workout-stats-chips">
          <span className="stat-chip">
            <span className="stat-chip__label">Exercises</span>
            <span className="stat-chip__value">{items.length}</span>
          </span>
          <span className="stat-chip">
            <span className="stat-chip__label">Sets</span>
            <span className="stat-chip__value">{totalSets}</span>
          </span>
          <span className="stat-chip">
            <span className="stat-chip__label">Template</span>
            <span className="stat-chip__value">{templateLabel}</span>
          </span>
          <span className="stat-chip">
            <span className="stat-chip__label">Space</span>
            <span className="stat-chip__value">{spaceLabel}</span>
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="ui-row ui-row--between">
            <div className="ui-section-title">Workout notes</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSessionNoteOpen((prev) => !prev)}
            >
              {sessionNoteOpen ? "Hide" : sessionNote ? "Edit" : "Add note"}
            </Button>
          </div>
          {!sessionNoteOpen && sessionNote ? (
            <div className="template-meta">Note saved</div>
          ) : null}
        </CardHeader>
        {sessionNoteOpen ? (
          <CardBody className="ui-stack">
            <div>
              <Label htmlFor="session-note">Workout note</Label>
              <textarea
                id="session-note"
                className="ui-input ui-textarea"
                rows={3}
                maxLength={SESSION_NOTE_LIMIT}
                placeholder="Optional thoughts about today's session."
                value={sessionNote}
                onFocus={() => setSessionNoteFocused(true)}
                onBlur={handleSessionNoteBlur}
                onChange={(e) => setSessionNote(e.target.value)}
              />
              {sessionNoteFocused ? (
                <div className="template-meta">
                  Optional | {sessionNote.length}/{SESSION_NOTE_LIMIT}
                </div>
              ) : null}
            </div>
          </CardBody>
        ) : null}
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <div className="empty-state">No exercises yet. Add your first exercise below.</div>
          </CardBody>
        </Card>
      ) : (
        <div className="ui-stack">
          {items.map((it, index) => {
            const missingEquipment = missingEquipmentByItem.get(it.id) ?? [];
            const previousEntry = previousSetsByExercise?.get(it.exerciseId) ?? null;
            const previousWorkingSets = (previousEntry?.sets ?? []).filter(
              (set) => !set.isWarmup
            );
            const supersetLabel = it.supersetGroupId
              ? supersetLabels.get(it.supersetGroupId)
              : null;
            const hasWorkoutNote = Boolean(exerciseNotes?.[it.exerciseId]?.trim());
            const hasStickyNote = Boolean(it.exercise?.stickyNote?.trim());
            let warmupIndex = 0;
            let workingIndex = 0;
            return (
              <Card
                key={it.id}
                data-workout-item-id={it.id}
                onFocusCapture={() => setActiveExerciseIndex(index)}
                className={`workout-exercise-card${
                  supersetLabel ? " workout-exercise-card--superset" : ""
                }`}
              >
                <CardHeader className="workout-exercise-header">
                  <div className="workout-exercise-title">
                    <button
                      type="button"
                      className="workout-exercise-name"
                      title={it.exercise?.name ?? "Unknown Exercise"}
                      onClick={() => handleOpenExerciseHistory(it)}
                    >
                      {it.exercise?.name ?? "Unknown Exercise"}
                    </button>
                    <div className="workout-exercise-meta">
                      <span className="pill pill--muted">
                        {it.exercise?.muscle_group ?? "Unknown"}
                      </span>
                      {supersetLabel ? (
                        <span className="pill pill--superset">{supersetLabel}</span>
                      ) : null}
                      {hasStickyNote ? (
                        <span className="pill pill--muted">Sticky</span>
                      ) : null}
                      {hasWorkoutNote ? (
                        <span className="pill pill--muted">Note</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="workout-exercise-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="tap-target"
                      onClick={() => handleAddSet(it)}
                    >
                      + Set
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="icon-button"
                      aria-label={`Duplicate last set for ${it.exercise?.name ?? "exercise"}`}
                      title="Duplicate last set"
                      onClick={() => handleDuplicateLastSet(it)}
                      disabled={it.sets.length === 0}
                    >
                      <Copy size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="icon-button"
                      aria-label={`View history for ${it.exercise?.name ?? "exercise"}`}
                      onClick={() => handleOpenExerciseHistory(it)}
                    >
                      <History size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="icon-button"
                      aria-label="Exercise actions"
                      onClick={() => setMenuItemId(it.id)}
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </div>
                </CardHeader>

                <CardBody className="workout-exercise-body">
                  {missingEquipment.length ? (
                    <div className="equipment-warning">
                      Missing equipment:{" "}
                      {missingEquipment.map((item) => item?.name ?? "Unknown").join(", ")}
                    </div>
                  ) : null}

                  {it.sets.length === 0 ? (
                    <div className="ui-muted">No sets yet. Add a set above.</div>
                  ) : (
                    <div className="workout-sets-grid">
                      <div className="workout-sets-header-row">
                        <div>Set</div>
                        <div>Prev</div>
                        <div>Kg</div>
                        <div>Reps</div>
                        <div>Done</div>
                      </div>
                      {it.sets.map((s) => {
                        const isWarmup = Boolean(s.isWarmup);
                        const label = isWarmup
                          ? `W${(warmupIndex += 1)}`
                          : `${(workingIndex += 1)}`;
                        const previousSet = isWarmup
                          ? null
                          : previousWorkingSets[workingIndex - 1];
                        const previousText = isWarmup
                          ? "—"
                          : formatSetValue(previousSet);
                        const comparisonStatus = isWarmup
                          ? null
                          : compareWorkoutSet(s, previousSet);
                        return (
                          <WorkoutSetRow
                            key={s.id}
                            set={s}
                            label={label}
                            previousText={previousText}
                            comparisonStatus={comparisonStatus}
                            isWarmup={isWarmup}
                            itemId={it.id}
                            onUpdateSet={handleWorkoutSetUpdate}
                            onRemoveSet={handleRemoveWorkoutSet}
                            onToggleComplete={handleToggleWorkoutSetComplete}
                            onStartLongPress={startLongPress}
                            onCancelLongPress={cancelLongPress}
                          />
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="ui-section-title">Add exercise</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div className="template-meta">
            Open the full-page picker to search, filter, and add exercises fast.
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setPickerPrefill(null);
              setPickerOpen(true);
            }}
            className="w-full"
          >
            Open Exercise Picker
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <Button
            variant="primary"
            size="lg"
            onClick={handleFinish}
            className="w-full workout-finish-button"
            data-idle={isProlongedIdle ? "true" : "false"}
          >
            Finish Workout
          </Button>
          {finishMessage ? <div className="ui-muted">{finishMessage}</div> : null}
        </CardBody>
      </Card>

      {showRestTimer ? (
        <>
          <button
            type="button"
            className="rest-chip"
            data-running={restRunning ? "true" : "false"}
            data-idle={isIdle ? "true" : "false"}
            onClick={() => setRestSheetOpen(true)}
          >
            <span className="rest-chip__label">Rest</span>
            <span className="rest-chip__time">
              {restEnabled ? formatRestTime(restRemaining) : "Off"}
            </span>
            {restRunning && restHint ? (
              <span className="rest-chip__hint">{restHint}</span>
            ) : null}
          </button>

          {restSheetOpen ? (
            <div className="modal">
              <button
                type="button"
                className="modal__backdrop"
                onClick={() => setRestSheetOpen(false)}
                aria-label="Close rest timer"
              />
              <div className="modal__panel rest-sheet">
                <div className="ui-stack">
                  <div className="ui-row ui-row--between">
                    <div>
                      <div className="ui-strong">Rest timer</div>
                      <div className="template-meta">
                        Keep recovery consistent between sets.
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestSheetOpen(false)}
                    >
                      Close
                    </Button>
                  </div>

                  <div className="rest-time">{formatRestTime(restRemaining)}</div>
                  {restRunning && restHint ? (
                    <div className="rest-hint">{restHint}</div>
                  ) : null}

                  <div className="rest-toggle">
                    <div>
                      <div className="ui-strong">Rest enabled</div>
                      <div className="template-meta">
                        Auto-starts when you complete a set.
                      </div>
                    </div>
                    <Button
                      variant={restEnabled ? "primary" : "secondary"}
                      size="sm"
                      onClick={handleToggleRestEnabled}
                    >
                      {restEnabled ? "On" : "Off"}
                    </Button>
                  </div>

                  <div>
                    <Label htmlFor={`${restFieldId}-default`}>Default rest (sec)</Label>
                    <Input
                      id={`${restFieldId}-default`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={restDefaultInput}
                      onChange={handleRestDefaultChange}
                      onBlur={() => {
                        if (restDefaultInput.trim() === "") {
                          setRestDefaultInput(String(restDefaultSeconds));
                        }
                      }}
                    />
                  </div>

                  <div className="ui-row ui-row--wrap">
                    <Button
                      variant="primary"
                      size="md"
                      className="flex-1"
                      onClick={handleStartPauseRest}
                      disabled={!restEnabled}
                    >
                      {restRunning ? "Pause" : "Start"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      className="flex-1"
                      onClick={handleResetRest}
                      disabled={!restEnabled}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <ExerciseHistoryDrawer
        open={Boolean(historyExercise)}
        exerciseId={historyExercise?.id ?? null}
        exerciseName={historyExercise?.name ?? null}
        stickyNote={historyExercise?.stickyNote ?? null}
        onClose={() => setHistoryExercise(null)}
      />

      {activeMenuItem ? (
        <div className="modal">
          <button
            type="button"
            className="modal__backdrop"
            onClick={() => setMenuItemId(null)}
            aria-label="Close exercise menu"
          />
          <div className="modal__panel exercise-menu">
            <div className="ui-stack">
              <div className="ui-row ui-row--between">
                <div>
                  <div className="ui-strong">
                    {activeMenuItem.exercise?.name ?? "Exercise"}
                  </div>
                  <div className="template-meta">Exercise actions</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setMenuItemId(null)}>
                  Close
                </Button>
              </div>

              <div className="exercise-menu__list">
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => {
                    handleOpenExerciseDetail(activeMenuItem.exerciseId);
                    setMenuItemId(null);
                  }}
                >
                  <Info size={16} />
                  Exercise details
                </button>
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => openReplacePicker(activeMenuItem)}
                >
                  <RefreshCcw size={16} />
                  Replace exercise
                </button>
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => handleAddWarmup(activeMenuItem.id)}
                >
                  <Flame size={16} />
                  Add warm-up sets
                </button>
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => openExerciseNoteSheet(activeMenuItem)}
                >
                  <FileText size={16} />
                  Note
                </button>
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => openStickyNoteSheet(activeMenuItem)}
                >
                  <StickyNote size={16} />
                  Sticky note
                </button>
                <button
                  type="button"
                  className="exercise-menu__item"
                  onClick={() => {
                    setSupersetSheetItemId(activeMenuItem.id);
                    setMenuItemId(null);
                  }}
                >
                  <Link2 size={16} />
                  {activeMenuItem.supersetGroupId ? "Manage superset" : "Make superset"}
                </button>
                <button
                  type="button"
                  className="exercise-menu__item exercise-menu__item--danger"
                  onClick={() => handleDeleteExercise(activeMenuItem)}
                >
                  <Trash2 size={16} />
                  Delete exercise
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {exerciseNoteSheet ? (
        <div className="modal">
          <button
            type="button"
            className="modal__backdrop"
            onClick={() => {
              setExerciseNoteSheet(null);
              setExerciseNoteDraft("");
            }}
            aria-label="Close note editor"
          />
          <div className="modal__panel note-sheet">
            <div className="ui-stack">
              <div className="ui-row ui-row--between">
                <div>
                  <div className="ui-strong">
                    {exerciseNoteSheet.type === "sticky" ? "Sticky note" : "Exercise note"}
                  </div>
                  <div className="template-meta">
                    {exerciseNoteSheet.type === "sticky"
                      ? "Saved on the exercise and reused each workout."
                      : "Saved with this workout only."}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExerciseNoteSheet(null);
                    setExerciseNoteDraft("");
                  }}
                >
                  Close
                </Button>
              </div>

              <div>
                <Label htmlFor="exercise-note-editor">Note</Label>
                <textarea
                  id="exercise-note-editor"
                  className="ui-input ui-textarea"
                  rows={3}
                  maxLength={EXERCISE_NOTE_LIMIT}
                  placeholder="Add a quick note..."
                  value={exerciseNoteDraft}
                  onChange={(e) => setExerciseNoteDraft(e.target.value)}
                />
                <div className="template-meta">
                  {exerciseNoteDraft.length}/{EXERCISE_NOTE_LIMIT}
                </div>
              </div>

              <div className="ui-row">
                <Button
                  variant="secondary"
                  size="md"
                  className="flex-1"
                  onClick={() => {
                    setExerciseNoteSheet(null);
                    setExerciseNoteDraft("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={handleSaveExerciseNote}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {supersetSheetItem ? (
        <div className="modal">
          <button
            type="button"
            className="modal__backdrop"
            onClick={() => setSupersetSheetItemId(null)}
            aria-label="Close superset menu"
          />
          <div className="modal__panel superset-sheet">
            <div className="ui-stack">
              <div className="ui-row ui-row--between">
                <div>
                  <div className="ui-strong">Superset</div>
                  <div className="template-meta">
                    Pair {supersetSheetItem.exercise?.name ?? "exercise"} with another.
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSupersetSheetItemId(null)}>
                  Close
                </Button>
              </div>

              {supersetGroupItems.length ? (
                <div className="ui-stack">
                  <div className="template-meta">Current group</div>
                  <div className="superset-group-list">
                    {supersetGroupItems.map((item) => (
                      <div key={item.id} className="superset-group-item">
                        {item.exercise?.name ?? "Exercise"}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemoveSuperset(supersetSheetItem.supersetGroupId)}
                  >
                    Remove superset
                  </Button>
                </div>
              ) : null}

              <div className="ui-stack">
                <div className="template-meta">Pair with</div>
                {supersetPartnerOptions.length ? (
                  <div className="superset-options">
                    {supersetPartnerOptions.map((option) => {
                      const isSameGroup =
                        option.supersetGroupId &&
                        option.supersetGroupId === supersetSheetItem.supersetGroupId;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className="superset-option"
                          onClick={() => handleCreateSuperset(supersetSheetItem.id, option.id)}
                          disabled={isSameGroup}
                        >
                          <span>{option.exercise?.name ?? "Exercise"}</span>
                          {isSameGroup ? (
                            <span className="pill pill--muted">Paired</span>
                          ) : option.supersetGroupId ? (
                            <span className="pill pill--muted">In superset</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">Add another exercise to create a superset.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {import.meta.env.DEV ? (
        <Card className="dev-panel">
          <CardHeader>
            <div className="ui-section-title">Dev panel</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDevPanel((prev) => !prev)}
            >
              {showDevPanel ? "Hide" : "Show"}
            </Button>
          </CardHeader>
          {showDevPanel ? (
            <CardBody className="ui-stack">
              <div>
                <span className="ui-muted">Current workout:</span>{" "}
                {workout
                  ? `id ${workout.id ?? "—"} · started ${workout.startedAt ?? "—"} · finished ${
                      workout.finishedAt ?? "—"
                    }`
                  : "none"}
              </div>
              <div>
                <span className="ui-muted">Active exercise index:</span>{" "}
                {activeExerciseIndex == null ? "—" : activeExerciseIndex}
              </div>
              <div>
                <span className="ui-muted">Raw data snapshot:</span>
                <pre>{JSON.stringify(workoutBundle, null, 2)}</pre>
              </div>
            </CardBody>
          ) : null}
        </Card>
      ) : null}

    </div>
  );
}


function HistoryView() {
  const workouts = useLiveQuery(() => listFinishedWorkouts(), []);
  const [openId, setOpenId] = useState(null);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);

  const openDetails = useLiveQuery(() => (openId ? getWorkoutWithDetails(openId) : null), [openId]);
  const sessionNote = openDetails?.workout?.sessionNote?.trim() ?? "";
  const exerciseNotes = openDetails?.workout?.exerciseNotes ?? {};
  const spaceMap = useMemo(
    () => new Map((workoutSpaces ?? []).map((space) => [space.id, space])),
    [workoutSpaces]
  );

  if (!workouts) {
    return (
      <div className="page">
        <PageHeader title="History" subtitle="Review your finished workouts." />
        <Card>
          <CardBody className="ui-muted">Loading…</CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="History" subtitle="Your finished workouts, ready to review." />

      {workouts.length === 0 ? (
        <Card>
          <CardBody>
            <div className="empty-state">
              No finished workouts yet. Finish a workout to see it here.
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="ui-stack">
          {workouts.map((w) => {
            const isOpen = openId === w.id;
            const spaceLabel = w.spaceId ? spaceMap.get(w.spaceId)?.name : null;
            return (
              <Card key={w.id}>
                <CardHeader>
                  <button
                    onClick={() => setOpenId(isOpen ? null : w.id)}
                    className="history-toggle"
                    type="button"
                  >
                    <div className="ui-strong">
                      {w.finishedAt ? new Date(w.finishedAt).toLocaleString() : "—"}
                    </div>
                    <div className="template-meta">
                      Started: {new Date(w.startedAt).toLocaleString()}
                      {w.templateId ? ` · Template #${w.templateId}` : ""}
                      {spaceLabel ? ` · Space: ${spaceLabel}` : ""}
                    </div>
                  </button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      if (window.confirm("Delete this finished workout?")) {
                        await deleteWorkout(w.id);
                        if (openId === w.id) setOpenId(null);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </CardHeader>

                {isOpen ? (
                  openDetails?.workout?.id === w.id ? (
                    <CardBody className="ui-stack">
                      {sessionNote ? (
                        <div className="ui-stack">
                          <div className="ui-section-title">Workout notes</div>
                          <div>{sessionNote}</div>
                        </div>
                      ) : null}
                      {openDetails.items.map((it) => (
                        <div key={it.id} className="ui-stack">
                          <div className="ui-strong">
                            {it.exercise?.name ?? "Unknown Exercise"}
                          </div>
                          <div>
                            <span className="pill pill--muted">
                              {it.exercise?.muscle_group ?? "Unknown"}
                            </span>
                          </div>
                          <div className="ui-stack">
                            {it.sets.map((s) => (
                              <div key={s.id} className="ui-row ui-row--between">
                                <div className="template-meta">Set {s.setNumber}</div>
                                <div>
                                  {s.weight ?? "—"} x {s.reps ?? "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                          {exerciseNotes?.[it.exerciseId]?.trim() ? (
                            <div className="ui-stack">
                              <div className="template-meta">Exercise note</div>
                              <div>{exerciseNotes[it.exerciseId]}</div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </CardBody>
                  ) : (
                    <CardBody className="ui-muted">Unable to load workout details.</CardBody>
                  )
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsForm({ settings, onNotify, themeMode, resolvedTheme, setThemeMode }) {
  const [persona, setPersona] = useState(settings?.coach_persona ?? "");
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState("");
  const [openAiEditing, setOpenAiEditing] = useState(!settings?.openai_api_key);
  const [openAiTesting, setOpenAiTesting] = useState(false);
  const [openAiTestResult, setOpenAiTestResult] = useState(null);
  const [coachMemoryEnabled, setCoachMemoryEnabled] = useState(
    settings?.coach_memory_enabled ?? false
  );
  const [coachMemory, setCoachMemory] = useState(() =>
    normalizeCoachMemory(settings?.coach_memory ?? getDefaultCoachMemory())
  );
  const [exercisePickerAutoFocus, setExercisePickerAutoFocus] = useState(
    settings?.exercise_picker_auto_focus ?? true
  );
  const [exercisePickerFilterActiveGym, setExercisePickerFilterActiveGym] = useState(
    settings?.exercise_picker_filter_active_gym ?? true
  );
  const [exercisePickerMostUsedFirst, setExercisePickerMostUsedFirst] = useState(
    settings?.exercise_picker_most_used_first ?? true
  );
  const [showRestTimer, setShowRestTimer] = useState(
    settings?.show_rest_timer ?? true
  );
  const [longPressDoneAddsNext, setLongPressDoneAddsNext] = useState(
    settings?.long_press_done_adds_next ?? false
  );
  const [memoryViewOpen, setMemoryViewOpen] = useState(false);
  const [memoryEditOpen, setMemoryEditOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryError, setMemoryError] = useState("");
  const personaId = useId();
  const appearanceId = useId();
  const openAiKeyId = useId();
  const memoryId = useId();
  const resolvedLabel = resolvedTheme === "dark" ? "Dark" : "Light";
  const trimmedOpenAiKey = openAiKeyDraft.trim();
  const looksLikeOpenAiKey =
    trimmedOpenAiKey.length === 0 || trimmedOpenAiKey.startsWith("sk-");
  const maskedOpenAiKey = getOpenAIKeyMasked(settings?.openai_api_key);
  const openAiKeyStatus = settings?.openai_api_key_status ?? "missing";

  useEffect(() => {
    if (memoryEditOpen) return;
    setCoachMemoryEnabled(settings?.coach_memory_enabled ?? false);
    setCoachMemory(normalizeCoachMemory(settings?.coach_memory ?? getDefaultCoachMemory()));
  }, [memoryEditOpen, settings]);

  useEffect(() => {
    if (settings?.openai_api_key) {
      setOpenAiEditing(false);
      setOpenAiKeyDraft("");
    } else {
      setOpenAiEditing(true);
    }
    setOpenAiTestResult(null);
  }, [settings?.openai_api_key]);

  const saveSettings = async () => {
    await updateSettings({
      coach_persona: persona,
      coach_memory_enabled: coachMemoryEnabled,
      coach_memory: coachMemory,
      exercise_picker_auto_focus: exercisePickerAutoFocus,
      exercise_picker_filter_active_gym: exercisePickerFilterActiveGym,
      exercise_picker_most_used_first: exercisePickerMostUsedFirst,
      show_rest_timer: showRestTimer,
      long_press_done_adds_next: longPressDoneAddsNext,
    });
    onNotify?.("Saved locally ✅", { tone: "success" });
  };

  const handleSaveOpenAiKey = async () => {
    if (!trimmedOpenAiKey) {
      setOpenAiTestResult({
        tone: "error",
        message: "Enter an OpenAI API key to save.",
      });
      return;
    }
    if (!looksLikeOpenAiKey) {
      setOpenAiTestResult({
        tone: "error",
        message: 'Keys usually start with \"sk-\". Check for typos.',
      });
      return;
    }
    await setOpenAIKey(trimmedOpenAiKey);
    setOpenAiEditing(false);
    setOpenAiKeyDraft("");
    setOpenAiTestResult({
      tone: "success",
      message: "Key saved locally.",
    });
    onNotify?.("OpenAI key saved locally ✅", { tone: "success" });
  };

  const handleRemoveOpenAiKey = async () => {
    if (!window.confirm("Remove the saved OpenAI API key from this device?")) return;
    await clearOpenAIKey();
    setOpenAiKeyDraft("");
    setOpenAiEditing(true);
    setOpenAiTestResult({
      tone: "success",
      message: "Key removed.",
    });
    onNotify?.("OpenAI key removed.", { tone: "success" });
  };

  const handleTestOpenAiKey = async () => {
    if (!settings?.openai_api_key) {
      setOpenAiTestResult({
        tone: "error",
        message: "Save a key first, then run the test.",
      });
      return;
    }
    setOpenAiTesting(true);
    const result = await testOpenAIKey();
    setOpenAiTestResult({
      tone: result.ok ? "success" : "error",
      message: result.message,
    });
    setOpenAiTesting(false);
  };

  const handleEditMemory = () => {
    setMemoryDraft(formatCoachMemory(coachMemory));
    setMemoryError("");
    setMemoryEditOpen(true);
    setMemoryViewOpen(false);
  };

  const handleSaveMemoryDraft = () => {
    try {
      const parsed = JSON.parse(memoryDraft || "{}");
      const normalized = normalizeCoachMemory(parsed);
      setCoachMemory(normalized);
      setMemoryEditOpen(false);
      setMemoryError("");
    } catch {
      setMemoryError("Memory must be valid JSON.");
    }
  };

  const handleClearMemory = () => {
    setCoachMemory(getDefaultCoachMemory());
    setMemoryEditOpen(false);
    setMemoryViewOpen(false);
    setMemoryError("");
  };

  return (
    <Card>
      <CardBody className="ui-stack">
        <div>
          <Label htmlFor={personaId}>Coach persona</Label>
          <Input
            id={personaId}
            type="text"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={appearanceId}>Appearance</Label>
          <Select
            id={appearanceId}
            value={themeMode}
            onChange={(e) => setThemeMode?.(e.target.value)}
          >
            <option value="system">System (Default)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
          {themeMode === "system" ? (
            <div className="template-meta">Currently following {resolvedLabel} mode.</div>
          ) : null}
        </div>

        <hr className="ui-divider" />

        <div className="ui-section-title">Workout logging</div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Show rest timer</div>
            <div className="template-meta">Toggle the floating rest timer chip.</div>
          </div>
          <Button
            variant={showRestTimer ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setShowRestTimer((prev) => !prev)}
            aria-pressed={showRestTimer}
          >
            {showRestTimer ? "On" : "Off"}
          </Button>
        </div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Long-press done adds next set</div>
            <div className="template-meta">
              Hold the done checkbox to complete the set and add a new one.
            </div>
          </div>
          <Button
            variant={longPressDoneAddsNext ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setLongPressDoneAddsNext((prev) => !prev)}
            aria-pressed={longPressDoneAddsNext}
          >
            {longPressDoneAddsNext ? "On" : "Off"}
          </Button>
        </div>

        <hr className="ui-divider" />

        <div className="ui-section-title">AI Coach</div>

        <div>
          <Label htmlFor={openAiKeyId}>OpenAI API key</Label>
          {openAiEditing ? (
            <div className="ui-stack">
              <Input
                id={openAiKeyId}
                type="password"
                value={openAiKeyDraft}
                onChange={(e) => setOpenAiKeyDraft(e.target.value)}
                autoComplete="off"
                className="flex-1"
                placeholder="sk-..."
              />
              {!looksLikeOpenAiKey && trimmedOpenAiKey ? (
                <div className="chat-error">Keys usually start with "sk-".</div>
              ) : null}
              <div className="ui-row ui-row--wrap">
                <Button variant="primary" size="sm" type="button" onClick={handleSaveOpenAiKey}>
                  Save key
                </Button>
                {settings?.openai_api_key ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setOpenAiEditing(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="ui-stack">
              <div className="ui-row ui-row--between ui-row--wrap">
                <div>
                  <div className="ui-strong">Saved key</div>
                  <div className="template-meta">
                    {maskedOpenAiKey ? maskedOpenAiKey : "No key saved yet."}
                  </div>
                </div>
                <div className="ui-row ui-row--wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => setOpenAiEditing(true)}
                  >
                    Replace key
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    onClick={handleRemoveOpenAiKey}
                    disabled={!settings?.openai_api_key}
                  >
                    Remove key
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className="template-meta">
            Unlocks AI Coach chat and tool-powered coaching. Stored locally on this device.
          </div>
          <div className="template-meta">
            Status:{" "}
            {openAiKeyStatus === "valid"
              ? "Verified"
              : openAiKeyStatus === "invalid"
                ? "Invalid"
                : openAiKeyStatus === "missing"
                  ? "Missing"
                  : "Not tested"}
          </div>
          <div className="ui-row ui-row--wrap">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleTestOpenAiKey}
              loading={openAiTesting}
              disabled={!settings?.openai_api_key}
            >
              Test API Key
            </Button>
          </div>
          {openAiTestResult ? (
            <div
              className={openAiTestResult.tone === "error" ? "chat-error" : "template-meta"}
            >
              {openAiTestResult.message}
            </div>
          ) : null}
        </div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Enable Coach Memory</div>
            <div className="template-meta">Let the coach remember preferences.</div>
          </div>
          <Button
            variant={coachMemoryEnabled ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setCoachMemoryEnabled((prev) => !prev)}
          >
            {coachMemoryEnabled ? "On" : "Off"}
          </Button>
        </div>

        <div className="ui-stack">
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" type="button" onClick={handleEditMemory}>
              Edit memory
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setMemoryViewOpen((prev) => !prev)}
            >
              {memoryViewOpen ? "Hide memory" : "View memory"}
            </Button>
            <Button variant="destructive" size="sm" type="button" onClick={handleClearMemory}>
              Clear memory
            </Button>
          </div>
          <div className="template-meta">
            Memory stays on this device and is shared only when enabled.
          </div>

          {memoryViewOpen ? (
            <pre className="coach-preview">{formatCoachMemory(coachMemory)}</pre>
          ) : null}

        {memoryEditOpen ? (
          <div>
            <Label htmlFor={memoryId}>Coach memory JSON</Label>
            <textarea
              id={memoryId}
                className="ui-input ui-textarea"
                rows={6}
                value={memoryDraft}
                onChange={(e) => setMemoryDraft(e.target.value)}
              />
              {memoryError ? <div className="chat-error">{memoryError}</div> : null}
              <div className="template-meta">Click Save Settings to persist changes.</div>
              <div className="ui-row ui-row--wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={handleSaveMemoryDraft}
                >
                  Apply memory
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setMemoryEditOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <hr className="ui-divider" />

        <div className="ui-section-title">Exercise Picker Preferences</div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Auto-focus search on open</div>
            <div className="template-meta">
              Automatically focus the search bar and open the keyboard when adding an
              exercise.
            </div>
          </div>
          <Button
            variant={exercisePickerAutoFocus ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setExercisePickerAutoFocus((prev) => !prev)}
            aria-pressed={exercisePickerAutoFocus}
          >
            {exercisePickerAutoFocus ? "On" : "Off"}
          </Button>
        </div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Filter by active gym equipment</div>
            <div className="template-meta">
              Only show exercises available at the active gym by default.
            </div>
          </div>
          <Button
            variant={exercisePickerFilterActiveGym ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setExercisePickerFilterActiveGym((prev) => !prev)}
            aria-pressed={exercisePickerFilterActiveGym}
          >
            {exercisePickerFilterActiveGym ? "On" : "Off"}
          </Button>
        </div>

        <div className="ui-row ui-row--between ui-row--wrap">
          <div>
            <div className="ui-strong">Show most-used exercises first</div>
            <div className="template-meta">
              Prioritize frequently used exercises when opening the picker.
            </div>
          </div>
          <Button
            variant={exercisePickerMostUsedFirst ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => setExercisePickerMostUsedFirst((prev) => !prev)}
            aria-pressed={exercisePickerMostUsedFirst}
          >
            {exercisePickerMostUsedFirst ? "On" : "Off"}
          </Button>
        </div>

        <Button variant="primary" size="md" onClick={saveSettings} className="w-full">
          Save Settings
        </Button>
      </CardBody>
    </Card>
  );
}

function MoreView({
  onLaunchCoach,
  onAddExerciseToWorkout,
  exerciseSeedState,
  onReseedExercises,
  onNotify,
  themeMode,
  resolvedTheme,
  setThemeMode,
  pendingNavigation,
  onPendingNavigationConsumed,
  debugPanelEnabled,
  diagnosticsEnabled,
  onToggleDebugPanel,
  onOpenDebugPanel,
}) {
  const [section, setSection] = useState("home");
  const [gymInitialView, setGymInitialView] = useState(null);

  useEffect(() => {
    if (!pendingNavigation) return;
    setSection(pendingNavigation.section ?? "home");
    setGymInitialView(pendingNavigation.gymView ?? null);
    onPendingNavigationConsumed?.();
  }, [pendingNavigation, onPendingNavigationConsumed]);

  useEffect(() => {
    if (section !== "gyms") return;
    if (!gymInitialView) return;
    setGymInitialView(null);
  }, [gymInitialView, section]);

  if (section === "exercises") {
    return (
      <ExercisesExplorer
        onBack={() => setSection("home")}
        onLaunchCoach={onLaunchCoach}
        onAddToWorkout={onAddExerciseToWorkout}
        isSeeding={exerciseSeedState?.status === "loading"}
        onReseed={onReseedExercises}
      />
    );
  }

  if (section === "gyms") {
    return (
      <GymsView
        onBack={() => setSection("home")}
        onLaunchCoach={onLaunchCoach}
        initialView={gymInitialView}
      />
    );
  }

  if (section === "settings") {
    return (
      <SettingsView
        onNotify={onNotify}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        setThemeMode={setThemeMode}
        debugPanelEnabled={debugPanelEnabled}
        onToggleDebugPanel={onToggleDebugPanel}
        onOpenDebugPanel={onOpenDebugPanel}
        onBack={() => setSection("home")}
      />
    );
  }

  if (section === "debug") {
    return <SeedDebugPanel onBack={() => setSection("home")} />;
  }

  if (section === "diagnostics") {
    return <DiagnosticsHub onBack={() => setSection("home")} />;
  }

  return (
    <div className="page">
      <PageHeader title="More" subtitle="Library tools, gyms, and preferences." />

      <div className="library-grid">
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Exercise library</div>
            <div className="template-meta">
              Browse exercises, cues, history, and training details.
            </div>
            <Button variant="primary" size="sm" onClick={() => setSection("exercises")}>
              Open library
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Gyms</div>
            <div className="template-meta">
              Manage workout spaces, equipment, and templates.
            </div>
            <Button variant="primary" size="sm" onClick={() => setSection("gyms")}>
              Open gyms
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Settings</div>
            <div className="template-meta">Adjust logging, Coach, and display options.</div>
            <Button variant="secondary" size="sm" onClick={() => setSection("settings")}>
              Open settings
            </Button>
          </CardBody>
        </Card>
        {debugPanelEnabled ? (
          <Card>
            <CardBody className="ui-stack">
              <div className="ui-strong">Debug tools</div>
              <div className="template-meta">Seed diagnostics and controls.</div>
              <Button variant="secondary" size="sm" onClick={() => setSection("debug")}>
                Open debug
              </Button>
            </CardBody>
          </Card>
        ) : null}
        {diagnosticsEnabled ? (
          <Card>
            <CardBody className="ui-stack">
              <div className="ui-strong">Diagnostics</div>
              <div className="template-meta">Local diagnostics report.</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSection("diagnostics")}
              >
                Open diagnostics
              </Button>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SettingsView({
  onNotify,
  themeMode,
  resolvedTheme,
  setThemeMode,
  debugPanelEnabled,
  onToggleDebugPanel,
  onOpenDebugPanel,
  onBack,
}) {
  const { settings } = useSettings();
  const settingsKey = settings
    ? `${settings.coach_persona ?? ""}::${settings.openai_api_key ?? ""}::${
        settings.openai_api_key_status ?? ""
      }::${settings.coach_memory_enabled ?? ""}::${
        settings.exercise_picker_auto_focus ?? ""
      }::${settings.exercise_picker_filter_active_gym ?? ""}::${
        settings.exercise_picker_most_used_first ?? ""
      }::${settings.show_rest_timer ?? ""}::${
        settings.long_press_done_adds_next ?? ""
      }`
    : "loading";

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Manage your local preferences."
        actions={
          onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null
        }
      />
      <SettingsForm
        key={settingsKey}
        settings={settings}
        onNotify={onNotify}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        setThemeMode={setThemeMode}
      />
      <Card>
        <CardBody className="ui-stack">
          <div className="ui-strong">Debug tools</div>
          <div className="template-meta">
            Enable the seed debug panel for diagnostics and manual imports.
          </div>
          <div className="ui-row ui-row--between ui-row--wrap">
            <div className="template-meta">
              Debug panel: {debugPanelEnabled ? "Enabled" : "Disabled"}
            </div>
            <Button
              variant={debugPanelEnabled ? "secondary" : "primary"}
              size="sm"
              onClick={() => onToggleDebugPanel?.(!debugPanelEnabled)}
            >
              {debugPanelEnabled ? "Disable" : "Enable"}
            </Button>
          </div>
          {debugPanelEnabled ? (
            <Button variant="secondary" size="sm" onClick={onOpenDebugPanel}>
              Open debug panel
            </Button>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryView({ summary, onBackToWorkout, onViewHistory }) {
  const details = useLiveQuery(
    () => (summary?.workoutId ? getWorkoutWithDetails(summary.workoutId) : null),
    [summary?.workoutId]
  );
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const exerciseIds = useMemo(
    () =>
      (details?.items ?? [])
        .map((item) => item.exerciseId)
        .filter((id) => id != null),
    [details?.items]
  );
  const previousSetsMap = useLiveQuery(
    () => getPreviousWorkoutSetsByExercise(exerciseIds, summary?.workoutId),
    [exerciseIds.join("|"), summary?.workoutId]
  );
  const sessionNote = details?.workout?.sessionNote?.trim() ?? "";
  const exerciseNotes = details?.workout?.exerciseNotes ?? {};
  const [sessionReflection, setSessionReflection] = useState("");
  const exerciseNotesList = details?.items?.filter((it) =>
    Boolean(exerciseNotes?.[it.exerciseId]?.trim())
  );
  const spaceMap = useMemo(
    () => new Map((workoutSpaces ?? []).map((space) => [space.id, space])),
    [workoutSpaces]
  );
  const spaceLabel = details?.workout?.spaceId
    ? spaceMap.get(details.workout.spaceId)?.name
    : null;

  useEffect(() => {
    setSessionReflection(details?.workout?.sessionReflection?.trim() ?? "");
  }, [details?.workout?.sessionReflection, summary?.workoutId]);

  const comparisons = useMemo(() => {
    const sections = {
      improved: [],
      same: [],
      regressed: [],
    };
    if (!details?.items?.length) return sections;
    const lookup = previousSetsMap ?? new Map();

    details.items.forEach((item) => {
      const currentBest = getBestComparableSet(item.sets);
      const previous = lookup.get(item.exerciseId) ?? null;
      const previousBest = getBestComparableSet(previous?.sets);
      const status = compareWorkoutSet(currentBest, previousBest) ?? "same";
      const name = item.exercise?.name ?? "Unknown Exercise";
      const stickyNote = item.exercise?.stickyNote?.trim() ?? "";
      let comparisonLine = currentBest
        ? `Best set ${formatSetValue(currentBest)}`
        : "No logged sets";
      if (previousBest) {
        comparisonLine += ` vs ${formatSetValue(previousBest)} last time`;
      } else if (currentBest) {
        comparisonLine += " · first time logged";
      }

      const payload = {
        id: item.id,
        name,
        comparisonLine,
        status,
        stickyNote,
      };

      if (status === "improved") {
        sections.improved.push(payload);
      } else if (status === "worse") {
        sections.regressed.push(payload);
      } else {
        sections.same.push(payload);
      }
    });

    return sections;
  }, [details?.items, previousSetsMap]);

  const recapLine = useMemo(() => {
    if (!summary) return "";
    const parts = [
      `${summary.totalExercises} exercises`,
      `${summary.totalSets} sets`,
      summary.estimatedMinutes != null ? `${summary.estimatedMinutes} min` : null,
      spaceLabel,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [summary, spaceLabel]);

  const handleReflectionSelect = useCallback(
    async (value) => {
      if (!summary?.workoutId) return;
      const nextValue = sessionReflection === value ? "" : value;
      setSessionReflection(nextValue);
      await updateWorkoutSession(summary.workoutId, { sessionReflection: nextValue });
    },
    [sessionReflection, summary?.workoutId]
  );

  const renderExerciseList = (items, muted = false) => {
    if (!items.length) return null;
    return (
      <div className={`summary-list ${muted ? "summary-list--muted" : ""}`}>
        {items.map((item) => (
          <div
            key={item.id}
            className={`summary-item ${muted ? "summary-item--muted" : ""}`}
          >
            <div className="summary-item__title">{item.name}</div>
            <div className="summary-item__meta">{item.comparisonLine}</div>
            {muted && item.stickyNote ? (
              <div className="summary-item__note">Sticky note: {item.stickyNote}</div>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  if (!summary) {
    return (
      <div className="page">
        <PageHeader title="Workout Summary" subtitle="A quick recap of your last session." />
        <Card>
          <CardBody>
            <div className="empty-state">
              No recent workout summary yet. Finish a workout to see it here.
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Workout Summary" subtitle="Great work — here’s what moved." />

      <Card>
        <CardBody className="ui-stack">
          <div className="summary-kicker">You stayed consistent today.</div>
          <div className="summary-recap">{recapLine}</div>
        </CardBody>
        <CardFooter className="ui-row ui-row--wrap">
          <Button variant="secondary" size="md" onClick={onBackToWorkout} className="flex-1">
            Back to Workout
          </Button>
          <Button variant="primary" size="md" onClick={onViewHistory} className="flex-1">
            View History
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Exercise check-in</div>
        </CardHeader>
        <CardBody className="ui-stack summary-sections">
          {comparisons.improved.length ? (
            <div className="summary-section">
              <div className="summary-section__title">Improved exercises ↑</div>
              {renderExerciseList(comparisons.improved)}
            </div>
          ) : null}
          {comparisons.same.length ? (
            <div className="summary-section">
              <div className="summary-section__title">Same</div>
              {renderExerciseList(comparisons.same)}
            </div>
          ) : null}
          {comparisons.regressed.length ? (
            <div className="summary-section summary-section--muted">
              <div className="summary-section__title">Regressed</div>
              {renderExerciseList(comparisons.regressed, true)}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Quick reflection (optional)</div>
        </CardHeader>
        <CardBody className="summary-reflection ui-stack">
          <div className="summary-reflection__options">
            {["Felt strong", "Felt tired", "Felt rushed"].map((option) => (
              <Button
                key={option}
                variant={sessionReflection === option ? "primary" : "secondary"}
                size="sm"
                onClick={() => handleReflectionSelect(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <div className="ui-muted">
            Tap once to save, tap again to clear. Totally optional.
          </div>
        </CardBody>
      </Card>

      {sessionNote || (exerciseNotesList && exerciseNotesList.length) ? (
        <Card>
          <CardHeader>
            <div className="ui-section-title">Workout notes</div>
          </CardHeader>
          <CardBody className="ui-stack">
            {sessionNote ? (
              <div className="ui-stack">
                <div className="template-meta">Session</div>
                <div>{sessionNote}</div>
              </div>
            ) : null}
            {exerciseNotesList?.length ? (
              <div className="ui-stack">
                <div className="template-meta">Exercises</div>
                {exerciseNotesList.map((it) => (
                  <div key={it.id} className="ui-stack">
                    <div className="ui-strong">
                      {it.exercise?.name ?? "Unknown Exercise"}
                    </div>
                    <div>{exerciseNotes[it.exerciseId]}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("workout");
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [workoutId, setWorkoutId] = useState(null);
  const [exercisePickerIntent, setExercisePickerIntent] = useState(null);
  const [lastSummary, setLastSummary] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [coachLaunchContext, setCoachLaunchContext] = useState(null);
  const [pendingMoreNavigation, setPendingMoreNavigation] = useState(null);
  const [exerciseSeedState, setExerciseSeedState] = useState({ status: "idle" });
  const [dbHealth, setDbHealth] = useState({ status: "idle" });
  const [debugPanelEnabled, setDebugPanelEnabled] = useState(() => {
    if (import.meta.env.DEV) return true;
    return window.localStorage.getItem("ironai.debugPanelEnabled") === "true";
  });
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(() => {
    if (import.meta.env.DEV) return true;
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("debug") === "1" ||
      window.localStorage.getItem("ironai.diagnosticsEnabled") === "true"
    );
  });
  const [seedDebugEnabled, setSeedDebugEnabled] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("debug") === "1" ||
      window.localStorage.getItem("debugSeed") === "1"
    );
  });
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map());
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();
  const isDev = import.meta.env.DEV;

  const seedMeta = useLiveQuery(
    () =>
      db
        .table("meta")
        .where("key")
        .anyOf(["seed.lastSeedStatus", "seed.lastSeedMessage"])
        .toArray(),
    []
  );
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);

  const seedStatusMap = useMemo(
    () => new Map((seedMeta ?? []).map((item) => [item.key, item.value])),
    [seedMeta]
  );
  const seedLastStatus = seedStatusMap.get("seed.lastSeedStatus");
  const seedLastMessage = seedStatusMap.get("seed.lastSeedMessage");

  const dismissToast = useCallback((toastId) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    const timer = toastTimersRef.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(toastId);
    }
  }, []);

  const notify = useCallback(
    (message, options = {}) => {
      const id = toastIdRef.current + 1;
      toastIdRef.current = id;
      const tone = options.tone || "info";
      const duration = options.duration ?? 3200;
      const actionLabel = options.actionLabel;
      const onAction = options.onAction;

      setToasts((prev) => [
        ...prev,
        { id, message, tone, actionLabel, onAction },
      ]);

      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        toastTimersRef.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  const handleToggleDebugPanel = useCallback((nextEnabled) => {
    setDebugPanelEnabled(nextEnabled);
    window.localStorage.setItem(
      "ironai.debugPanelEnabled",
      nextEnabled ? "true" : "false"
    );
  }, []);

  const openMoreSection = useCallback((section) => {
    setPendingMoreNavigation({ section });
    setTab("more");
  }, []);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") {
      window.localStorage.setItem("ironai.diagnosticsEnabled", "true");
      window.localStorage.setItem("debugSeed", "1");
      setDiagnosticsEnabled(true);
      setSeedDebugEnabled(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkDb = async () => {
      try {
        await db.open();
        const tables = db.tables.map((table) => table.name);
        console.info("Dexie DB opened", { version: db.verno, tables });
        if (!cancelled) {
          setDbHealth({ status: "ok", version: db.verno, tables });
        }
      } catch (error) {
        console.error("Failed to open Dexie DB:", error);
        if (!cancelled) {
          setDbHealth({ status: "error", error });
        }
      }
    };
    checkDb();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      // Prefer localStorage to restore the last active workout after reload.
      const stored = window.localStorage.getItem("ironai.activeWorkoutId");
      const storedId = stored ? Number(stored) : null;
      if (storedId && !Number.isNaN(storedId)) {
        setWorkoutId(storedId);
        return;
      }

      const id = await getMostRecentActiveWorkoutId();
      if (id) setWorkoutId(id);
    })();
  }, []);

  useEffect(() => {
    // Keep localStorage in sync with the current active workout.
    if (workoutId == null) {
      window.localStorage.removeItem("ironai.activeWorkoutId");
      return;
    }
    window.localStorage.setItem("ironai.activeWorkoutId", String(workoutId));
  }, [workoutId]);

  useEffect(() => {
    if (tab !== "coach" && coachLaunchContext) {
      setCoachLaunchContext(null);
    }
  }, [coachLaunchContext, tab]);

  useEffect(() => {
    if (tab === "library" || tab === "settings") {
      setTab("more");
    }
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    const runSeed = async () => {
      setExerciseSeedState({ status: "loading" });
      const result = await seedExercisesIfNeeded();
      if (result?.status === "success" || result?.status === "fallback") {
        await repairSeededExercises({ force: false });
      }
      if (cancelled) return;
      setExerciseSeedState({
        status: result?.status ?? "error",
        error: result?.error ?? null,
      });
    };
    runSeed();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReseedExercises = useCallback(async () => {
    setExerciseSeedState({ status: "loading" });
    await resetExerciseSeedVersion();
    const result = await seedExercisesIfNeeded();
    setExerciseSeedState({
      status: result?.status ?? "error",
      error: result?.error ?? null,
    });
  }, []);

  const handleStartWorkoutFromTemplate = async (templateId, options = {}) => {
    const id = await startWorkoutFromTemplate(templateId, options);
    setWorkoutId(id);
    setTab("workout");
  };

  const handleOpenWorkout = (id) => {
    if (!id) return;
    setWorkoutId(id);
    setTab("workout");
  };

  const handleOpenTemplate = (id) => {
    setActiveTemplateId(id);
    setTab("templates");
  };

  const handleCreateTemplateAndEdit = (id) => {
    setActiveTemplateId(id);
    setTab("templates");
  };

  const handleBackToTemplatesList = () => {
    setActiveTemplateId(null);
  };

  const handleTabChange = (nextTab) => {
    const normalized =
      nextTab === "library" || nextTab === "settings" ? "more" : nextTab;
    if (nextTab === "templates") {
      setActiveTemplateId(null);
    }
    setTab(normalized);
  };

  const handleAddExerciseFromLibrary = async (exerciseId) => {
    if (!exerciseId) return;
    try {
      let currentWorkoutId = workoutId;
      if (!currentWorkoutId) {
        currentWorkoutId = await createEmptyWorkout({ spaceId: null });
        setWorkoutId(currentWorkoutId);
      }
      const exercise = await db.table("exercises").get(exerciseId);
      setExercisePickerIntent({
        id: exerciseId,
        name: exercise?.name ?? "",
      });
      setTab("workout");
    } catch (err) {
      notify(err?.message ?? "Unable to add exercise right now.", { tone: "error" });
    }
  };

  return (
    <div className="app-shell">
      <main>
        {(isDev || debugPanelEnabled) &&
        seedLastStatus === "FAILURE" &&
        (exerciseCount ?? 0) < SEED_MIN_COUNT ? (
          <div className="db-health-banner" role="alert">
            <div className="db-health-banner__copy">
              <strong>Exercise seeding failed.</strong>
              <span className="ui-muted">
                {seedLastMessage ?? "Open debug tools for details."}
              </span>
            </div>
            <Button onClick={() => openMoreSection("debug")}>Open debug</Button>
          </div>
        ) : null}
        {dbHealth.status === "error" && (
          <div className="db-health-banner" role="alert">
            <div className="db-health-banner__copy">
              <strong>Local database failed to open.</strong>
              <span className="ui-muted">
                You can try reloading the app. Your local data might be out of sync.
              </span>
              {isDev ? (
                <span className="ui-muted">
                  Dev hint: reset local data in the browser devtools (Application →
                  IndexedDB) and reload.
                </span>
              ) : null}
            </div>
            <Button onClick={() => window.location.reload()}>Reload app</Button>
          </div>
        )}
        {tab === "workout" && (
          <WorkoutView
            key={workoutId ?? "none"}
            workoutId={workoutId}
            setWorkoutId={setWorkoutId}
            pickerIntent={exercisePickerIntent}
            onConsumePickerIntent={() => setExercisePickerIntent(null)}
            onFinish={(summary) => {
              setLastSummary(summary);
              setTab("summary");
            }}
            onNotify={notify}
          />
        )}
        {tab === "coach" && (
          <CoachView
            launchContext={coachLaunchContext}
            onLaunchContextConsumed={() => setCoachLaunchContext(null)}
            onNotify={notify}
            onOpenTemplate={handleOpenTemplate}
            onOpenWorkout={handleOpenWorkout}
            onNavigateToGyms={(options = {}) => {
              const gymView = options.spaceId
                ? { type: "detail", spaceId: options.spaceId }
                : options.create
                  ? { type: "form", mode: "create", spaceId: null }
                  : null;
              setPendingMoreNavigation({
                section: "gyms",
                gymView,
              });
              setTab("more");
            }}
            diagnosticsEnabled={diagnosticsEnabled}
          />
        )}
        {tab === "history" && <HistoryView />}
        {tab === "summary" && (
          <SummaryView
            summary={lastSummary}
            onBackToWorkout={() => setTab("workout")}
            onViewHistory={() => setTab("history")}
          />
        )}

        {tab === "templates" &&
          (activeTemplateId ? (
            <TemplateEditor
              templateId={activeTemplateId}
              onBack={handleBackToTemplatesList}
              onStartWorkout={handleStartWorkoutFromTemplate}
              onNotify={notify}
            />
          ) : (
            <TemplatesList
              onSelectTemplate={handleOpenTemplate}
              onCreateTemplateAndEdit={handleCreateTemplateAndEdit}
              onNotify={notify}
            />
          ))}

        {tab === "more" && (
          <MoreView
            onLaunchCoach={(context) => {
              setCoachLaunchContext(context);
              setTab("coach");
            }}
            onAddExerciseToWorkout={handleAddExerciseFromLibrary}
            exerciseSeedState={exerciseSeedState}
            onReseedExercises={handleReseedExercises}
            onNotify={notify}
            themeMode={themeMode}
            resolvedTheme={resolvedTheme}
            setThemeMode={setThemeMode}
            pendingNavigation={pendingMoreNavigation}
            onPendingNavigationConsumed={() => setPendingMoreNavigation(null)}
            debugPanelEnabled={debugPanelEnabled}
            diagnosticsEnabled={diagnosticsEnabled}
            onToggleDebugPanel={handleToggleDebugPanel}
            onOpenDebugPanel={() => openMoreSection("debug")}
          />
        )}
        {!KNOWN_TABS.has(tab) && <NotFoundView onGoHome={() => setTab("workout")} />}
      </main>

      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <nav className="tabbar">
        <div className="tabbar__inner" style={{ "--tab-count": NAV_ITEMS.length }}>
          {NAV_ITEMS.map((item) => (
            <TabButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={tab === item.id}
              onClick={() => handleTabChange(item.id)}
            />
          ))}
        </div>
      </nav>
      {seedDebugEnabled ? <SeedDebugMiniPanel /> : null}
    </div>
  );
}
