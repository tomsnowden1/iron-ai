import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Dumbbell,
  History,
  LayoutTemplate,
  MessageSquare,
  MoreHorizontal,
  MoreVertical,
  RefreshCcw,
  StickyNote,
  FileText,
  Flame,
  Link2,
  Trash2,
} from "lucide-react";

import CoachView from "./features/coach/CoachView";
import ExerciseDetailView from "./features/exercises/ExerciseDetailView";
import ExercisePickerView from "./features/exercises/ExercisePickerView";
import ExercisesExplorer from "./features/exercises/ExercisesExplorer";
import GymsView from "./features/gyms/GymsView";
import TemplatesList from "./features/templates/TemplatesList";
import TemplateEditor from "./features/templates/TemplateEditor";
import useTheme from "./utils/useTheme";
import { resetExerciseSeedVersion, seedExercisesIfNeeded } from "./seed/exerciseSeed";
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
  setActiveWorkoutSpace,
  startWorkoutFromTemplate,
  updateWorkoutSession,
  updateWorkoutSet,
} from "./db";

const SESSION_NOTE_LIMIT = 500;
const EXERCISE_NOTE_LIMIT = 250;
const NAV_ITEMS = [
  { id: "workout", label: "Workout", icon: Dumbbell },
  { id: "coach", label: "Coach", icon: MessageSquare },
  { id: "history", label: "History", icon: History },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "more", label: "More", icon: MoreHorizontal },
];

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tabbar__button"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
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
  const [supersetSheetItemId, setSupersetSheetItemId] = useState(null);
  const [detailExerciseId, setDetailExerciseId] = useState(null);
  const scrollRestoreRef = useRef(0);

  // Safe defaults so we can compute memos without crashing
  const workout = workoutBundle?.workout ?? null;
  const items = useMemo(
    () => (Array.isArray(workoutBundle?.items) ? workoutBundle.items : []),
    [workoutBundle]
  );
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

  useEffect(() => {
    if (!workoutId) return;
    // Cmd/Ctrl + Enter completes the focused set and adds a new one.
    const handleKeyDown = (event) => {
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
      addWorkoutSet(itemId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [startRestForSet, workoutId]);

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

  const handleResetRest = () => {
    restEndsAtRef.current = null;
    setRestRunning(false);
    setRestRemaining(restDuration);
    setRestHint("");
  };

  const handleCompleteSet = (itemId, setId) => {
    startRestForSet(itemId, setId);
  };

  const handleOpenExerciseDetail = (exerciseId) => {
    if (!exerciseId) return;
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
    const confirmText = hasNote
      ? "Delete this exercise and its workout note? This cannot be undone."
      : "Delete this exercise? This cannot be undone.";
    if (!window.confirm(confirmText)) return;
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
      await clearSupersetGroup(groupId);
      setSupersetSheetItemId(null);
      setMenuItemId(null);
      onNotify?.("Superset removed ✅", { tone: "success" });
    },
    [clearSupersetGroup, onNotify]
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
                      onClick={() => handleOpenExerciseDetail(it.exerciseId)}
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
                      onClick={() => addWorkoutSet(it.id)}
                    >
                      + Set
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="icon-button"
                      aria-label="Exercise actions"
                      onClick={() => setMenuItemId(it.id)}
                    >
                      <MoreVertical size={18} />
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
                          <div
                            key={s.id}
                            className={`workout-set-row${
                              isWarmup ? " workout-set-row--warmup" : ""
                            }`}
                            data-workout-set-id={s.id}
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
                              value={s.weight ?? ""}
                              onChange={(e) =>
                                updateWorkoutSet(s.id, { weight: e.target.value })
                              }
                            />
                            <Input
                              inputMode="numeric"
                              placeholder="reps"
                              value={s.reps ?? ""}
                              onChange={(e) => updateWorkoutSet(s.id, { reps: e.target.value })}
                            />
                            <div className="set-actions">
                              <label className="set-done">
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.isComplete)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    void updateWorkoutSet(s.id, { isComplete: checked });
                                    if (checked) {
                                      handleCompleteSet(it.id, s.id);
                                    }
                                  }}
                                  aria-label={`Mark set ${label} complete`}
                                />
                                <span>Done</span>
                              </label>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="set-remove-button"
                                aria-label={`Remove set ${label}`}
                                onClick={() => removeWorkoutSet(it.id, s.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
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
          <Button variant="primary" size="lg" onClick={handleFinish} className="w-full">
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
  const [apiKey, setApiKey] = useState(settings?.api_key ?? "");
  const [persona, setPersona] = useState(settings?.coach_persona ?? "");
  const [openAiKey, setOpenAiKey] = useState(settings?.openai_api_key ?? "");
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);
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
  const [memoryViewOpen, setMemoryViewOpen] = useState(false);
  const [memoryEditOpen, setMemoryEditOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryError, setMemoryError] = useState("");
  const apiKeyId = useId();
  const personaId = useId();
  const appearanceId = useId();
  const openAiKeyId = useId();
  const memoryId = useId();
  const resolvedLabel = resolvedTheme === "dark" ? "Dark" : "Light";
  const trimmedOpenAiKey = openAiKey.trim();
  const looksLikeOpenAiKey =
    trimmedOpenAiKey.length === 0 || trimmedOpenAiKey.startsWith("sk-");

  useEffect(() => {
    if (memoryEditOpen) return;
    setCoachMemoryEnabled(settings?.coach_memory_enabled ?? false);
    setCoachMemory(normalizeCoachMemory(settings?.coach_memory ?? getDefaultCoachMemory()));
  }, [memoryEditOpen, settings]);

  const saveSettings = async () => {
    await db.settings.put({
      ...(settings ?? {}),
      id: 1,
      api_key: apiKey,
      coach_persona: persona,
      openai_api_key: trimmedOpenAiKey,
      coach_memory_enabled: coachMemoryEnabled,
      coach_memory: coachMemory,
      exercise_picker_auto_focus: exercisePickerAutoFocus,
      exercise_picker_filter_active_gym: exercisePickerFilterActiveGym,
      exercise_picker_most_used_first: exercisePickerMostUsedFirst,
      show_rest_timer: showRestTimer,
    });
    onNotify?.("Saved locally ✅", { tone: "success" });
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
          <Label htmlFor={apiKeyId}>API Key</Label>
          <Input
            id={apiKeyId}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

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

        <hr className="ui-divider" />

        <div className="ui-section-title">AI Coach</div>

        <div>
          <Label htmlFor={openAiKeyId}>OpenAI API key</Label>
          <div className="ui-row ui-row--wrap">
            <Input
              id={openAiKeyId}
              type={showOpenAiKey ? "text" : "password"}
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              autoComplete="off"
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setShowOpenAiKey((prev) => !prev)}
            >
              {showOpenAiKey ? "Hide" : "Reveal"}
            </Button>
          </div>
          <div className="template-meta">
            {looksLikeOpenAiKey
              ? "Stored locally on this device. Required for Coach."
              : 'Keys usually start with "sk-". Check for typos.'}
          </div>
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
}) {
  const [section, setSection] = useState("home");

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
    return <GymsView onBack={() => setSection("home")} onLaunchCoach={onLaunchCoach} />;
  }

  if (section === "settings") {
    return (
      <SettingsView
        onNotify={onNotify}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        setThemeMode={setThemeMode}
        onBack={() => setSection("home")}
      />
    );
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
      </div>
    </div>
  );
}

function SettingsView({
  onNotify,
  themeMode,
  resolvedTheme,
  setThemeMode,
  onBack,
}) {
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const settingsKey = settings
    ? `${settings.api_key ?? ""}::${settings.coach_persona ?? ""}::${
        settings.openai_api_key ?? ""
      }::${settings.coach_memory_enabled ?? ""}::${
        settings.exercise_picker_auto_focus ?? ""
      }::${settings.exercise_picker_filter_active_gym ?? ""}::${
        settings.exercise_picker_most_used_first ?? ""
      }::${settings.show_rest_timer ?? ""}`
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
    </div>
  );
}

function SummaryView({ summary, onBackToWorkout, onViewHistory }) {
  const details = useLiveQuery(
    () => (summary?.workoutId ? getWorkoutWithDetails(summary.workoutId) : null),
    [summary?.workoutId]
  );
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const sessionNote = details?.workout?.sessionNote?.trim() ?? "";
  const exerciseNotes = details?.workout?.exerciseNotes ?? {};
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
      <PageHeader title="Workout Summary" subtitle="Great work — here’s your recap." />

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-row ui-row--between">
            <span className="ui-muted">Total exercises</span>
            <span className="ui-strong">{summary.totalExercises}</span>
          </div>
          <div className="ui-row ui-row--between">
            <span className="ui-muted">Total sets</span>
            <span className="ui-strong">{summary.totalSets}</span>
          </div>
          <div className="ui-row ui-row--between">
            <span className="ui-muted">Estimated duration</span>
            <span className="ui-strong">
              {summary.estimatedMinutes != null ? `${summary.estimatedMinutes} min` : "Unknown"}
            </span>
          </div>
          {spaceLabel ? (
            <div className="ui-row ui-row--between">
              <span className="ui-muted">Space</span>
              <span className="ui-strong">{spaceLabel}</span>
            </div>
          ) : null}
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
  const [exerciseSeedState, setExerciseSeedState] = useState({ status: "idle" });
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map());
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();

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

      setToasts((prev) => [...prev, { id, message, tone }]);

      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        toastTimersRef.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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
          />
        )}
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
    </div>
  );
}
