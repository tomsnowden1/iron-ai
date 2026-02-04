import { useId, useMemo, useState } from "react";
import { History } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  db,
  getAllExercises,
  getExerciseUsageCounts,
  getTemplateWithDetails,
  updateTemplate,
  updateTemplateItem,
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
import ExercisePickerView from "../exercises/ExercisePickerView";
import ExerciseHistoryDrawer from "../exercises/ExerciseHistoryDrawer";

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyExercise, setHistoryExercise] = useState(null);
  const nameId = useId();
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
  const templateSpace = useMemo(() => {
    if (!template?.spaceId) return null;
    return (workoutSpaces ?? []).find((space) => space.id === template.spaceId) ?? null;
  }, [template, workoutSpaces]);
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

  const handleSelectExercise = async (exerciseId) => {
    if (!template || !exerciseId) return false;
    try {
      await addExerciseToTemplate(template.id, exerciseId);
      setPickerOpen(false);
      return true;
    } catch (err) {
      onNotify?.(err?.message ?? "Unable to add exercise.", { tone: "error" });
      return false;
    }
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

  if (pickerOpen) {
    return (
      <ExercisePickerView
        title="Add exercise"
        subtitle="Pick an exercise to add to this template."
        exercises={allExercises}
        equipmentList={equipmentList}
        usageStats={exerciseUsageCounts}
        activeSpace={activeSpace}
        settings={settings}
        excludeExerciseIds={existingExerciseIds}
        onSelectExercise={handleSelectExercise}
        onClose={() => setPickerOpen(false)}
      />
    );
  }

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
              {items.map((it) => {
                const targetSets = Math.max(1, Number(it.targetSets ?? 3));
                const targetReps = it.targetReps ?? "";
                return (
                  <div key={it.id} className="template-item">
                    <div className="template-item__header">
                      <div className="ui-stack">
                        <button
                          type="button"
                          className="template-item__title"
                          onClick={() =>
                            setHistoryExercise({
                              id: it.exerciseId,
                              name: it.exercise?.name ?? "Unknown Exercise",
                              stickyNote: it.exercise?.stickyNote ?? "",
                            })
                          }
                        >
                          {it.exercise?.name ?? "Unknown Exercise"}
                        </button>
                        <div>
                          <span className="pill pill--muted">
                            {it.exercise?.muscle_group ?? "Unknown"}
                          </span>
                        </div>
                      </div>
                      <div className="template-item__actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setHistoryExercise({
                              id: it.exerciseId,
                              name: it.exercise?.name ?? "Unknown Exercise",
                              stickyNote: it.exercise?.stickyNote ?? "",
                            })
                          }
                          aria-label={`View history for ${it.exercise?.name ?? "exercise"}`}
                        >
                          <History size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveItem(it.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="template-set-grid">
                      <div className="template-set-grid__label">Sets</div>
                      <div className="template-set-grid__label">Reps</div>
                      <div className="template-set-counter">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            updateTemplateItem(it.id, {
                              targetSets: Math.max(1, targetSets - 1),
                            })
                          }
                        >
                          -
                        </Button>
                        <Input
                          inputMode="numeric"
                          value={targetSets}
                          onChange={(e) => {
                            const next = Number.parseInt(e.target.value, 10);
                            if (Number.isNaN(next)) return;
                            updateTemplateItem(it.id, { targetSets: Math.max(1, next) });
                          }}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            updateTemplateItem(it.id, { targetSets: targetSets + 1 })
                          }
                        >
                          +
                        </Button>
                      </div>
                      <div className="template-set-input">
                        <Input
                          inputMode="numeric"
                          placeholder="reps"
                          value={targetReps}
                          onChange={(e) =>
                            updateTemplateItem(it.id, { targetReps: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Add exercise</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div className="template-meta">
            Open the full-page picker to search, filter, and add exercises quickly.
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setPickerOpen(true)}
            className="w-full"
          >
            Open Exercise Picker
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

      <ExerciseHistoryDrawer
        open={Boolean(historyExercise)}
        exerciseId={historyExercise?.id ?? null}
        exerciseName={historyExercise?.name ?? null}
        stickyNote={historyExercise?.stickyNote ?? null}
        onClose={() => setHistoryExercise(null)}
      />
    </div>
  );
}
