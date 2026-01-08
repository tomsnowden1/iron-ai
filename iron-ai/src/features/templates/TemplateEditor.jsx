import { useId, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  getAllExercises,
  getTemplateWithDetails,
  updateTemplate,
  deleteTemplate,
  addExerciseToTemplate,
  removeTemplateItem,
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

export default function TemplateEditor({ templateId, onBack, onStartWorkout, onNotify }) {
  const templateBundle = useLiveQuery(
    () => (templateId ? getTemplateWithDetails(templateId) : null),
    [templateId]
  );

  const allExercises = useLiveQuery(() => getAllExercises(), []);

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
      onBack={onBack}
      onStartWorkout={onStartWorkout}
      onNotify={onNotify}
    />
  );
}

function TemplateEditorForm({
  templateBundle,
  allExercises,
  onBack,
  onStartWorkout,
  onNotify,
}) {
  const [name, setName] = useState(templateBundle?.template?.name ?? "");
  const [newExerciseId, setNewExerciseId] = useState("");
  const nameId = useId();
  const addExerciseId = useId();

  const items = useMemo(
    () => (Array.isArray(templateBundle?.items) ? templateBundle.items : []),
    [templateBundle]
  );
  const template = templateBundle?.template ?? null;

  const existingExerciseIds = useMemo(
    () => new Set(items.map((i) => i.exerciseId)),
    [items]
  );

  const availableExercises = useMemo(() => {
    const list = allExercises ?? [];
    return list.filter((ex) => !existingExerciseIds.has(ex.id));
  }, [allExercises, existingExerciseIds]);

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
      await onStartWorkout(template.id);
      onNotify?.("Workout started ✅", { tone: "success" });
      return;
    }
    // fallback: start directly
    await startWorkoutFromTemplate(template.id);
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
            <Label htmlFor={addExerciseId}>Choose exercise</Label>
            <Select
              id={addExerciseId}
              value={newExerciseId}
              onChange={(e) => setNewExerciseId(e.target.value)}
              disabled={availableExercises.length === 0}
            >
              <option value="">
                {availableExercises.length ? "Select an exercise" : "No exercises available"}
              </option>
              {availableExercises.map((ex) => (
                <option key={ex.id} value={String(ex.id)}>
                  {ex.name} ({ex.muscle_group})
                </option>
              ))}
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
