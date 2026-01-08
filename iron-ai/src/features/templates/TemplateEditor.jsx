import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  db,
  getAllExercises,
  getExerciseUsageCounts,
  getTemplateWithDetails,
  updateTemplate,
  deleteTemplate,
  addExerciseToTemplate,
  removeTemplateItem,
  listEquipment,
  listWorkoutSpaces,
  setActiveWorkoutSpace,
  startWorkoutFromTemplate,
} from "../../db";
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
} from "../../components/ui";
import { getEquipmentMap } from "../../equipment/catalog";
import {
  getExerciseSubstitutionsForExercise,
  getMissingEquipmentForExercise,
} from "../../equipment/engine";
import { resolveActiveSpace } from "../../workoutSpaces/logic";

export default function TemplateEditor({ templateId, onBack, onStartWorkout, onNotify }) {
  const templateBundle = useLiveQuery(
    () => (templateId ? getTemplateWithDetails(templateId) : null),
    [templateId]
  );

  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const exerciseUsageCounts = useLiveQuery(() => getExerciseUsageCounts(), []);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const equipmentList = useLiveQuery(() => listEquipment(), []);
  const settings = useLiveQuery(() => db.settings.get(1), []);

  if (!templateId) {
    return (
      <div className="page">
        <PageHeader
          title="Template"
          subtitle="Edit your template details and exercises."
          actions={
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          }
        />
        <Card>
          <CardBody>
            <div className="empty-state">
              No template selected. Go back to Templates to choose one.
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!templateBundle) {
    return (
      <div className="page">
        <PageHeader
          title="Template"
          subtitle="Loading template details."
          actions={
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          }
        />
        <Card>
          <CardBody className="ui-muted">Loading template…</CardBody>
        </Card>
      </div>
    );
  }

  return (
    <TemplateEditorForm
      key={templateBundle?.template?.id ?? "missing"}
      templateBundle={templateBundle}
      allExercises={allExercises}
      exerciseUsageCounts={exerciseUsageCounts}
      workoutSpaces={workoutSpaces}
      equipmentList={equipmentList}
      settings={settings}
      onBack={onBack}
      onStartWorkout={onStartWorkout}
      onNotify={onNotify}
    />
  );
}

function TemplateEditorForm({
  templateBundle,
  allExercises,
  exerciseUsageCounts,
  workoutSpaces,
  equipmentList,
  settings,
  onBack,
  onStartWorkout,
  onNotify,
}) {
  const [name, setName] = useState(templateBundle?.template?.name ?? "");
  const [newExerciseId, setNewExerciseId] = useState("");
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [filterByActiveGym, setFilterByActiveGym] = useState(
    settings?.exercise_picker_filter_active_gym ?? true
  );
  const [showMostUsedFirst, setShowMostUsedFirst] = useState(
    settings?.exercise_picker_most_used_first ?? true
  );
  const [pickerTouched, setPickerTouched] = useState(false);
  const exerciseSearchRef = useRef(null);
  const autoFocusAppliedRef = useRef(false);
  const nameId = useId();
  const addExerciseId = useId();
  const exerciseSearchId = useId();
  const templateSpaceId = useId();
  const activeSpaceId = useId();

  const items = useMemo(
    () => (Array.isArray(templateBundle?.items) ? templateBundle.items : []),
    [templateBundle]
  );
  const template = templateBundle?.template ?? null;
  const settingsActiveSpaceId = settings?.active_space_id ?? null;
  const activeSpace = useMemo(
    () => resolveActiveSpace(workoutSpaces ?? [], settingsActiveSpaceId),
    [settingsActiveSpaceId, workoutSpaces]
  );
  const pickerSpace = activeSpace;
  const hasActiveGym = Boolean(pickerSpace);
  const pickerAutoFocus = settings?.exercise_picker_auto_focus ?? true;
  const pickerFilterDefault = settings?.exercise_picker_filter_active_gym ?? true;
  const pickerMostUsedDefault = settings?.exercise_picker_most_used_first ?? true;
  const templateSpace = useMemo(() => {
    if (!template?.spaceId) return null;
    return (workoutSpaces ?? []).find((space) => space.id === template.spaceId) ?? null;
  }, [template?.spaceId, workoutSpaces]);
  const equipmentMap = useMemo(
    () => getEquipmentMap(equipmentList ?? []),
    [equipmentList]
  );
  const missingEquipment = useMemo(() => {
    if (!activeSpace || !items.length) return [];
    const names = new Set();
    items.forEach((item) => {
      if (!item.exercise) return;
      const missing = getMissingEquipmentForExercise(
        item.exercise,
        activeSpace.equipmentIds ?? [],
        equipmentMap
      );
      missing.forEach((eq) => {
        names.add(eq?.name ?? "Unknown");
      });
    });
    return Array.from(names);
  }, [activeSpace, equipmentMap, items]);
  const substitutionHints = useMemo(() => {
    if (!activeSpace || !items.length || !allExercises?.length) return [];
    const hints = [];
    items.forEach((item) => {
      if (!item.exercise) return;
      const missing = getMissingEquipmentForExercise(
        item.exercise,
        activeSpace.equipmentIds ?? [],
        equipmentMap
      );
      if (!missing.length) return;
      const substitutions = getExerciseSubstitutionsForExercise(
        item.exercise,
        allExercises,
        activeSpace.equipmentIds ?? [],
        equipmentMap
      );
      if (substitutions.length) {
        hints.push(`${item.exercise.name ?? "Exercise"} → ${substitutions[0].name}`);
      }
    });
    return hints.slice(0, 3);
  }, [activeSpace, allExercises, equipmentMap, items]);
  const showMismatchWarning =
    Boolean(templateSpace && activeSpace && templateSpace.id !== activeSpace.id) &&
    missingEquipment.length > 0;
  const showActiveWarning =
    Boolean(!templateSpace && activeSpace) && missingEquipment.length > 0;
  const startSpaceId = activeSpace?.id ?? null;
  const activeSpaceSelectValue =
    settingsActiveSpaceId != null && settingsActiveSpaceId === activeSpace?.id
      ? String(settingsActiveSpaceId)
      : "";

  const existingExerciseIds = useMemo(
    () => new Set(items.map((i) => i.exerciseId)),
    [items]
  );

  const availableExercises = useMemo(() => {
    const list = allExercises ?? [];
    return list.filter((ex) => !existingExerciseIds.has(ex.id));
  }, [allExercises, existingExerciseIds]);

  const exerciseUsageMap = useMemo(() => {
    const entries = Array.isArray(exerciseUsageCounts) ? exerciseUsageCounts : [];
    return new Map(entries.map(({ exerciseId, count }) => [exerciseId, count]));
  }, [exerciseUsageCounts]);
  const hasUsageHistory = exerciseUsageMap.size > 0;
  const exerciseSearchQuery = exerciseSearch.trim().toLowerCase();
  const filteredExercises = useMemo(() => {
    let filtered = availableExercises;
    if (filterByActiveGym && hasActiveGym) {
      const equipmentIds = pickerSpace?.equipmentIds ?? [];
      filtered = filtered.filter((exercise) => {
        const missing = getMissingEquipmentForExercise(exercise, equipmentIds, equipmentMap);
        return missing.length === 0;
      });
    }
    if (exerciseSearchQuery) {
      filtered = filtered.filter((exercise) => {
        const name = String(exercise.name ?? "").toLowerCase();
        const group = String(exercise.muscle_group ?? "").toLowerCase();
        return name.includes(exerciseSearchQuery) || group.includes(exerciseSearchQuery);
      });
    }
    return filtered;
  }, [
    availableExercises,
    equipmentMap,
    exerciseSearchQuery,
    filterByActiveGym,
    hasActiveGym,
    pickerSpace,
  ]);

  const mostUsedExercises = useMemo(() => {
    if (!showMostUsedFirst || !hasUsageHistory) return [];
    const filtered = filteredExercises.filter(
      (exercise) => (exerciseUsageMap.get(exercise.id) ?? 0) > 0
    );
    if (!filtered.length) return [];
    const sorted = [...filtered].sort((a, b) => {
      const countDiff =
        (exerciseUsageMap.get(b.id) ?? 0) - (exerciseUsageMap.get(a.id) ?? 0);
      if (countDiff !== 0) return countDiff;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
    return sorted.slice(0, 6);
  }, [exerciseUsageMap, filteredExercises, hasUsageHistory, showMostUsedFirst]);

  const remainingExercises = useMemo(() => {
    if (!mostUsedExercises.length) return filteredExercises;
    const mostUsedIds = new Set(mostUsedExercises.map((exercise) => exercise.id));
    return filteredExercises.filter((exercise) => !mostUsedIds.has(exercise.id));
  }, [filteredExercises, mostUsedExercises]);

  const showMostUsedSection = showMostUsedFirst && mostUsedExercises.length > 0;
  const hasFilteredExercises = filteredExercises.length > 0;
  const emptyExerciseLabel = availableExercises.length
    ? "No exercises match filters"
    : "No exercises available";

  useEffect(() => {
    if (pickerTouched) return;
    setFilterByActiveGym(pickerFilterDefault && hasActiveGym);
    setShowMostUsedFirst(pickerMostUsedDefault);
    if (
      pickerAutoFocus &&
      !autoFocusAppliedRef.current &&
      exerciseSearchRef.current
    ) {
      exerciseSearchRef.current.focus();
      autoFocusAppliedRef.current = true;
    }
  }, [
    hasActiveGym,
    pickerAutoFocus,
    pickerFilterDefault,
    pickerMostUsedDefault,
    pickerTouched,
  ]);

  useEffect(() => {
    if (hasActiveGym) return;
    setFilterByActiveGym(false);
  }, [hasActiveGym]);

  useEffect(() => {
    if (!newExerciseId) return;
    const stillAvailable = filteredExercises.some(
      (exercise) => String(exercise.id) === String(newExerciseId)
    );
    if (!stillAvailable) {
      setNewExerciseId("");
    }
  }, [filteredExercises, newExerciseId]);

  const handleSaveName = async () => {
    if (!template) return;
    await updateTemplate(template.id, { name: name.trim() || "Untitled Template" });
    onNotify?.("Template saved ✅", { tone: "success" });
  };

  const handleDeleteTemplate = async () => {
    if (!template) return;
    if (!window.confirm("Delete this template? This cannot be undone.")) return;
    await deleteTemplate(template.id);
    onBack?.();
  };

  const handleAddExercise = async () => {
    if (!newExerciseId || !template) return;
    const exId = parseInt(newExerciseId, 10);
    if (Number.isNaN(exId)) return;
    await addExerciseToTemplate(template.id, exId);
    setNewExerciseId("");
  };

  const handleRemoveItem = async (templateItemId) => {
    await removeTemplateItem(templateItemId);
  };

  const handleStart = async () => {
    if (!template) return;
    // Let parent handle the flow if they provided a handler
    if (onStartWorkout) {
      await onStartWorkout(template.id, { spaceId: startSpaceId });
      onNotify?.("Workout started ✅", { tone: "success" });
      return;
    }
    // fallback: start directly
    await startWorkoutFromTemplate(template.id, { spaceId: startSpaceId });
    onNotify?.("Workout started ✅", { tone: "success" });
  };

  return (
    <div className="page">
      <PageHeader
        title="Template"
        subtitle={`ID: ${template?.id ?? "—"}`}
        actions={
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="ui-section-title">Template details</div>
        </CardHeader>
        <CardBody>
          <Label htmlFor={nameId}>Template name</Label>
          <div className="ui-row ui-row--wrap">
            <Input
              id={nameId}
              className="flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Push Day"
            />
            <Button variant="primary" size="sm" onClick={handleSaveName}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Workout space</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div>
            <Label htmlFor={templateSpaceId}>Template space</Label>
            <Select
              id={templateSpaceId}
              value={template?.spaceId != null ? String(template.spaceId) : ""}
              onChange={(e) => {
                if (!template) return;
                const next = e.target.value ? Number(e.target.value) : null;
                void updateTemplate(template.id, { spaceId: Number.isNaN(next) ? null : next });
              }}
              disabled={!workoutSpaces?.length}
            >
              <option value="">No specific space</option>
              {(workoutSpaces ?? []).map((space) => (
                <option key={space.id} value={String(space.id)}>
                  {space.name ?? "Untitled Space"}
                </option>
              ))}
            </Select>
            <div className="template-meta">Used for equipment checks and Coach context.</div>
          </div>
          <div>
            <Label htmlFor={activeSpaceId}>Active workout space</Label>
            <Select
              id={activeSpaceId}
              value={activeSpaceSelectValue}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                void setActiveWorkoutSpace(Number.isNaN(next) ? null : next);
              }}
              disabled={!workoutSpaces?.length}
            >
              <option value="">
                Use default space{activeSpace?.name ? ` (${activeSpace.name})` : ""}
              </option>
              {(workoutSpaces ?? []).map((space) => (
                <option key={space.id} value={String(space.id)}>
                  {space.name ?? "Untitled Space"}
                </option>
              ))}
            </Select>
            <div className="template-meta">
              Used when starting workouts from this template.
            </div>
          </div>
          {!workoutSpaces?.length ? (
            <div className="template-meta">
              No workout spaces yet. Create one in Library.
            </div>
          ) : null}
          {showMismatchWarning ? (
            <div className="space-warning">
              Active space is {activeSpace?.name ?? "Default"} but this template was
              created for {templateSpace?.name ?? "another space"}. Missing equipment:{" "}
              {missingEquipment.join(", ")}.
              {substitutionHints.length ? (
                <div className="template-meta">
                  Suggested swaps: {substitutionHints.join(", ")}.
                </div>
              ) : null}
            </div>
          ) : null}
          {showActiveWarning ? (
            <div className="space-warning">
              Some exercises need equipment missing from{" "}
              {activeSpace?.name ?? "the active space"}: {missingEquipment.join(", ")}.
              {substitutionHints.length ? (
                <div className="template-meta">
                  Suggested swaps: {substitutionHints.join(", ")}.
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Exercises</div>
          <div className="pill">{items.length} total</div>
        </CardHeader>
        <CardBody>
          {items.length === 0 ? (
            <div className="empty-state">No exercises yet. Add your first one below.</div>
          ) : (
            <div className="ui-stack">
              {items.map((it) => (
                <div key={it.id} className="ui-row ui-row--between">
                  <div className="ui-stack">
                    <div className="ui-strong">{it.exercise?.name ?? "Unknown Exercise"}</div>
                    <div>
                      <span className="pill pill--muted">
                        {it.exercise?.muscle_group ?? "Unknown"}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRemoveItem(it.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Add exercise</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div>
            <Label htmlFor={exerciseSearchId}>Search exercises</Label>
            <Input
              id={exerciseSearchId}
              type="search"
              placeholder="Search by name or muscle group"
              value={exerciseSearch}
              onChange={(e) => {
                setPickerTouched(true);
                setExerciseSearch(e.target.value);
              }}
              ref={exerciseSearchRef}
            />
          </div>

          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Available at active gym</div>
              <div className="template-meta">
                Only show exercises available at the active gym.
              </div>
              {!hasActiveGym ? (
                <div className="template-meta">Set an active gym to filter by equipment.</div>
              ) : null}
            </div>
            <Button
              variant={filterByActiveGym ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() => {
                if (!hasActiveGym) return;
                setPickerTouched(true);
                setFilterByActiveGym((prev) => !prev);
              }}
              disabled={!hasActiveGym}
              aria-pressed={filterByActiveGym}
            >
              {filterByActiveGym ? "On" : "Off"}
            </Button>
          </div>

          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Most used first</div>
              <div className="template-meta">
                Prioritize frequently used exercises when opening the picker.
              </div>
            </div>
            <Button
              variant={showMostUsedFirst ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() => {
                setPickerTouched(true);
                setShowMostUsedFirst((prev) => !prev);
              }}
              aria-pressed={showMostUsedFirst}
            >
              {showMostUsedFirst ? "On" : "Off"}
            </Button>
          </div>

          <div>
            <Label htmlFor={addExerciseId}>Choose exercise</Label>
            <Select
              id={addExerciseId}
              value={newExerciseId}
              onChange={(e) => {
                setPickerTouched(true);
                setNewExerciseId(e.target.value);
              }}
              disabled={!hasFilteredExercises}
            >
              <option value="">
                {hasFilteredExercises ? "Select an exercise" : emptyExerciseLabel}
              </option>
              {showMostUsedSection ? (
                <optgroup label="Most Used">
                  {mostUsedExercises.map((ex) => (
                    <option key={ex.id} value={String(ex.id)}>
                      {ex.name} ({ex.muscle_group})
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {showMostUsedSection ? (
                remainingExercises.length ? (
                  <optgroup label="All Exercises">
                    {remainingExercises.map((ex) => (
                      <option key={ex.id} value={String(ex.id)}>
                        {ex.name} ({ex.muscle_group})
                      </option>
                    ))}
                  </optgroup>
                ) : null
              ) : (
                filteredExercises.map((ex) => (
                  <option key={ex.id} value={String(ex.id)}>
                    {ex.name} ({ex.muscle_group})
                  </option>
                ))
              )}
            </Select>
          </div>
          <Button
            variant="secondary"
            onClick={handleAddExercise}
            disabled={!newExerciseId}
            className="w-full"
          >
            Add exercise
          </Button>
        </CardBody>
        <CardFooter className="ui-row ui-row--wrap">
          <Button variant="primary" size="lg" onClick={handleStart} className="flex-1">
            Start Workout From Template
          </Button>
          <Button variant="destructive" size="lg" onClick={handleDeleteTemplate} className="flex-1">
            Delete
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
