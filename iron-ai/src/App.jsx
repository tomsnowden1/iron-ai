// codex-pr-test
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  Dumbbell,
  History,
  Settings as SettingsIcon,
  LayoutTemplate,
  MessageSquare,
} from "lucide-react";

import CoachView from "./features/coach/CoachView";
import ExercisePickerView from "./features/exercises/ExercisePickerView";
import LibraryView from "./features/library/LibraryView";
import TemplatesList from "./features/templates/TemplatesList";
import TemplateEditor from "./features/templates/TemplateEditor";
import useTheme from "./utils/useTheme";
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
  createEmptyWorkout,
  deleteWorkout,
  finishWorkout,
  replaceWorkoutExercise,
  getAllExercises,
  getExerciseUsageCounts,
  getMostRecentActiveWorkoutId,
  getWorkoutWithDetails,
  listEquipment,
  listFinishedWorkouts,
  listWorkoutSpaces,
  removeWorkoutItem,
  removeWorkoutSet,
  setActiveWorkoutSpace,
  startWorkoutFromTemplate,
  updateWorkoutItem,
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
  { id: "library", label: "Library", icon: BookOpen },
  { id: "settings", label: "Settings", icon: SettingsIcon },
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
  const replaceSelectId = useId();
  const restFieldId = useId();
  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const exerciseUsageCounts = useLiveQuery(() => getExerciseUsageCounts(), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPrefill, setPickerPrefill] = useState(null);

  // Replace Exercise UI state (Step C/D)
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceItemId, setReplaceItemId] = useState(null);
  const [replaceCurrentExerciseId, setReplaceCurrentExerciseId] = useState(null);
  const [replaceNewExerciseId, setReplaceNewExerciseId] = useState("");
  const [finishMessage, setFinishMessage] = useState("");
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(null);
  const [restEnabled, setRestEnabled] = useState(true);
  const [restDefaultSeconds, setRestDefaultSeconds] = useState(60);
  const [restDefaultInput, setRestDefaultInput] = useState("60");
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
  const [focusedExerciseNoteId, setFocusedExerciseNoteId] = useState(null);
  const [exerciseNoteOpenIds, setExerciseNoteOpenIds] = useState({});

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

  const existingExerciseIds = useMemo(() => {
    return new Set(items.map((i) => i.exerciseId));
  }, [items]);

  const replaceOptions = useMemo(() => {
    const list = allExercises ?? [];
    return list.filter(
      (ex) => ex.id === replaceCurrentExerciseId || !existingExerciseIds.has(ex.id)
    );
  }, [allExercises, existingExerciseIds, replaceCurrentExerciseId]);

  useEffect(() => {
    setPickerOpen(false);
    setPickerPrefill(null);
  }, [workoutId]);

  useEffect(() => {
    if (!pickerIntent || !workoutId) return;
    setPickerPrefill(pickerIntent);
    setPickerOpen(true);
    onConsumePickerIntent?.();
  }, [onConsumePickerIntent, pickerIntent, workoutId]);

  useEffect(() => {
    if (!workout || sessionNoteFocused) return;
    setSessionNote(typeof workout.sessionNote === "string" ? workout.sessionNote : "");
  }, [sessionNoteFocused, workout]);

  useEffect(() => {
    if (!workout || focusedExerciseNoteId != null) return;
    const next = workout.exerciseNotes ?? {};
    setExerciseNotes({ ...next });
  }, [focusedExerciseNoteId, workout]);

  useEffect(() => {
    const enabled = settings?.rest_enabled;
    const defaultSeconds = parseRestInput(settings?.rest_default_seconds) ?? 60;
    setRestEnabled(enabled ?? true);
    setRestDefaultSeconds(defaultSeconds);
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

  const resolveRestSeconds = useCallback(
    (item, set) => {
      const setOverride = parseRestInput(set?.restSeconds);
      if (setOverride != null) return setOverride;
      const itemDefault = parseRestInput(item?.restSeconds);
      if (itemDefault != null) return itemDefault;
      return restDefaultSeconds;
    },
    [restDefaultSeconds]
  );

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
      const seconds = resolveRestSeconds(item, set);
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
  const openReplace = (workoutItem) => {
    setReplaceItemId(workoutItem.id);
    setReplaceCurrentExerciseId(workoutItem.exerciseId);
    setReplaceNewExerciseId(String(workoutItem.exerciseId));
    setReplaceOpen(true);
  };

  const closeReplace = () => {
    setReplaceOpen(false);
    setReplaceItemId(null);
    setReplaceCurrentExerciseId(null);
    setReplaceNewExerciseId("");
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

  const handleSelectExercise = async (exerciseId) => {
    if (!exerciseId || !workoutId) return false;
    try {
      await addExerciseToWorkout(workoutId, exerciseId);
      setPickerOpen(false);
      setPickerPrefill(null);
      return true;
    } catch (err) {
      onNotify?.(err?.message ?? "Could not add exercise.", { tone: "error" });
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

  const handleExerciseNoteBlur = async (exerciseId) => {
    setFocusedExerciseNoteId(null);
    if (!workoutId) return;
    const next = { ...(workout?.exerciseNotes ?? {}) };
    const rawNote = exerciseNotes?.[exerciseId] ?? "";
    const nextNote = rawNote.trim();
    if (nextNote) {
      next[exerciseId] = nextNote;
    } else {
      delete next[exerciseId];
    }
    await updateWorkoutSession(workoutId, { exerciseNotes: next });
  };

  if (pickerOpen) {
    return (
      <ExercisePickerView
        title="Add exercise"
        subtitle="Pick an exercise to add to this workout."
        exercises={allExercises}
        equipmentList={equipmentList}
        usageStats={exerciseUsageCounts}
        activeSpace={pickerSpace}
        settings={settings}
        excludeExerciseIds={existingExerciseIds}
        prefillExercise={pickerPrefill}
        onSelectExercise={handleSelectExercise}
        onClose={() => {
          setPickerOpen(false);
          setPickerPrefill(null);
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

      <Card>
        <CardHeader>
          <div className="ui-section-title">Workout stats</div>
          {workoutSpace?.name ? <span className="pill">{workoutSpace.name}</span> : null}
        </CardHeader>
        <CardBody>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Exercises</div>
              <div className="stat-value">{items.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Sets</div>
              <div className="stat-value">{totalSets}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Template</div>
              <div className="stat-value">{templateLabel}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Space</div>
              <div className="stat-value">{spaceLabel}</div>
            </div>
          </div>
        </CardBody>
      </Card>

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
            return (
              <Card
                key={it.id}
                data-workout-item-id={it.id}
                onFocusCapture={() => setActiveExerciseIndex(index)}
              >
              <CardHeader>
                <div className="ui-stack">
                  <div className="ui-strong">{it.exercise?.name ?? "Unknown Exercise"}</div>
                  <div>
                    <span className="pill pill--muted">
                      {it.exercise?.muscle_group ?? "Unknown"}
                    </span>
                  </div>
                </div>
                <div className="ui-row ui-row--wrap">
                  <Button variant="secondary" size="sm" onClick={() => addWorkoutSet(it.id)}>
                    + Set
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openReplace(it)}>
                    Replace
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => removeWorkoutItem(it.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardHeader>

              <CardBody className="ui-stack">
                {missingEquipment.length ? (
                  <div className="equipment-warning">
                    Missing equipment:{" "}
                    {missingEquipment.map((item) => item?.name ?? "Unknown").join(", ")}
                  </div>
                ) : null}
                <div className="ui-row ui-row--between">
                  <div className="ui-section-title">Sets</div>
                  <div className="ui-row">
                    <Button variant="secondary" size="sm" onClick={() => addWorkoutSet(it.id)}>
                      +1 set
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        await addWorkoutSet(it.id);
                        await addWorkoutSet(it.id);
                        await addWorkoutSet(it.id);
                      }}
                    >
                      +3 sets
                    </Button>
                  </div>
                </div>

                <div className="rest-default-row">
                  <Label htmlFor={`${restFieldId}-item-${it.id}`}>Rest default (sec)</Label>
                  <Input
                    id={`${restFieldId}-item-${it.id}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="rest-input"
                    value={it.restSeconds ?? ""}
                    placeholder={String(restDefaultSeconds)}
                    onChange={(e) => {
                      const parsed = parseRestInput(e.target.value);
                      void updateWorkoutItem(it.id, { restSeconds: parsed });
                    }}
                  />
                </div>

                {it.sets.length === 0 ? (
                  <div className="ui-muted">No sets yet. Add a set above.</div>
                ) : (
                  <div className="ui-stack">
                    {it.sets.map((s) => (
                      <div key={s.id} className="set-row" data-workout-set-id={s.id}>
                        <div className="set-index">#{s.setNumber}</div>
                        <Input
                          inputMode="decimal"
                          placeholder="kg"
                          value={s.weight ?? ""}
                          onChange={(e) => updateWorkoutSet(s.id, { weight: e.target.value })}
                        />
                        <Input
                          inputMode="numeric"
                          placeholder="reps"
                          value={s.reps ?? ""}
                          onChange={(e) => updateWorkoutSet(s.id, { reps: e.target.value })}
                        />
                        <Input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="rest-input"
                          placeholder={`rest ${
                            it.restSeconds ?? restDefaultSeconds
                          }s`}
                          value={s.restSeconds ?? ""}
                          aria-label={`Rest override seconds for set ${s.setNumber}`}
                          onChange={(e) => {
                            const parsed = parseRestInput(e.target.value);
                            void updateWorkoutSet(s.id, { restSeconds: parsed });
                          }}
                        />
                        <div className="set-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCompleteSet(it.id, s.id)}
                          >
                            Done
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeWorkoutSet(it.id, s.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ui-stack">
                  <div className="ui-row ui-row--between">
                    <div className="ui-section-title">Exercise note</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExerciseNoteOpenIds((prev) => ({
                          ...prev,
                          [it.id]: !prev[it.id],
                        }))
                      }
                    >
                      {exerciseNoteOpenIds[it.id]
                        ? "Hide"
                        : exerciseNotes?.[it.exerciseId]
                          ? "Edit"
                          : "Add note"}
                    </Button>
                  </div>
                  {!exerciseNoteOpenIds[it.id] && exerciseNotes?.[it.exerciseId] ? (
                    <div className="template-meta">Note saved</div>
                  ) : null}
                  {exerciseNoteOpenIds[it.id] ? (
                    <div>
                      <Label htmlFor={`exercise-note-${it.id}`}>Exercise note</Label>
                      <textarea
                        id={`exercise-note-${it.id}`}
                        className="ui-input ui-textarea"
                        rows={2}
                        maxLength={EXERCISE_NOTE_LIMIT}
                        placeholder="Optional notes for this exercise."
                        value={exerciseNotes?.[it.exerciseId] ?? ""}
                        onFocus={() => setFocusedExerciseNoteId(it.id)}
                        onBlur={() => handleExerciseNoteBlur(it.exerciseId)}
                        onChange={(e) =>
                          setExerciseNotes((prev) => ({
                            ...prev,
                            [it.exerciseId]: e.target.value,
                          }))
                        }
                      />
                      {focusedExerciseNoteId === it.id ? (
                        <div className="template-meta">
                          Optional | {(exerciseNotes?.[it.exerciseId] ?? "").length}/
                          {EXERCISE_NOTE_LIMIT}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
                  <div className="template-meta">Keep recovery consistent between sets.</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRestSheetOpen(false)}>
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

      {/* Replace Exercise Modal (Step D) */}
      {replaceOpen && (
        <div className="modal">
          <button
            type="button"
            className="modal__backdrop"
            onClick={closeReplace}
            aria-label="Close replace modal"
          />

          <div className="modal__panel">
            <div className="ui-stack">
              <div className="ui-row ui-row--between">
                <div>
                  <div className="ui-strong">Replace exercise</div>
                  <div className="template-meta">Pick a new exercise (duplicates blocked)</div>
                </div>
                <Button variant="ghost" size="sm" onClick={closeReplace}>
                  Close
                </Button>
              </div>

              <div>
                <Label htmlFor={replaceSelectId}>New exercise</Label>
                <Select
                  id={replaceSelectId}
                  value={replaceNewExerciseId}
                  onChange={(e) => setReplaceNewExerciseId(e.target.value)}
                >
                  {replaceOptions.map((ex) => (
                    <option key={ex.id} value={String(ex.id)}>
                      {ex.name} ({ex.muscle_group})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="ui-row">
                <Button variant="secondary" size="md" onClick={closeReplace} className="flex-1">
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      const newId = parseInt(replaceNewExerciseId, 10);
                      if (!replaceItemId || Number.isNaN(newId)) return;
                      if (newId === replaceCurrentExerciseId) {
                        closeReplace();
                        return;
                      }
                      await replaceWorkoutExercise(replaceItemId, newId);
                      closeReplace();
                    } catch (err) {
                      onNotify?.(err?.message ?? "Could not replace exercise.", {
                        tone: "error",
                      });
                    }
                  }}
                >
                  Replace
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function SettingsView({
  onNotify,
  themeMode,
  resolvedTheme,
  setThemeMode,
}) {
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const settingsKey = settings
    ? `${settings.api_key ?? ""}::${settings.coach_persona ?? ""}::${
        settings.openai_api_key ?? ""
      }::${settings.coach_memory_enabled ?? ""}::${
        settings.exercise_picker_auto_focus ?? ""
      }::${settings.exercise_picker_filter_active_gym ?? ""}::${
        settings.exercise_picker_most_used_first ?? ""
      }`
    : "loading";

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Manage your local preferences."
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
    if (nextTab === "templates") {
      setActiveTemplateId(null);
    }
    setTab(nextTab);
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

        {tab === "library" && (
          <LibraryView
            onLaunchCoach={(context) => {
              setCoachLaunchContext(context);
              setTab("coach");
            }}
            onAddExerciseToWorkout={handleAddExerciseFromLibrary}
          />
        )}

        {tab === "settings" && (
          <SettingsView
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
