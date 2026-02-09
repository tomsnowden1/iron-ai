import { useEffect, useMemo, useState } from "react";

import {
  BottomSheet,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
} from "../../components/ui";
import { getEquipmentMap } from "../../equipment/catalog";
import { getExercisePrimaryMuscles } from "../../exercises/data";
import {
  createCustomExercise,
  updateCustomExercise,
} from "../../exercises/customExercise";
import { generateExerciseDetails } from "../../services/exerciseAutofill";
import { useSettings } from "../../state/settingsStore";

const STATUS_OPTIONS = ["core", "extended", "hidden"];

function buildInitialState({ exercise, initialName }) {
  const baseName = exercise?.name ?? initialName ?? "";
  return {
    name: baseName,
    aliases: Array.isArray(exercise?.aliases) ? exercise.aliases : [],
    primaryMuscles: Array.isArray(exercise?.primaryMuscles)
      ? exercise.primaryMuscles
      : [],
    secondaryMuscles: Array.isArray(exercise?.secondaryMuscles)
      ? exercise.secondaryMuscles
      : [],
    equipment: Array.isArray(exercise?.equipment)
      ? exercise.equipment
      : Array.isArray(exercise?.requiredEquipmentIds)
        ? exercise.requiredEquipmentIds
        : [],
    category: exercise?.category ?? "",
    pattern: exercise?.pattern ?? "",
    instructionsText: Array.isArray(exercise?.instructions)
      ? exercise.instructions.join("\n")
      : "",
    gotchasText: Array.isArray(exercise?.gotchas) ? exercise.gotchas.join("\n") : "",
    youtubeSearchQuery: exercise?.youtubeSearchQuery ?? "",
    youtubeVideoId: exercise?.youtubeVideoId ?? "",
    status: exercise?.status ?? "core",
  };
}

function parseLines(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function PillInput({
  id,
  label,
  helper,
  placeholder,
  values,
  onChange,
  suggestions,
  maxItems,
}) {
  const [inputValue, setInputValue] = useState("");
  const datalistId = suggestions?.length ? `${id}-datalist` : undefined;

  const addValue = (raw) => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return;
    if (maxItems && values.length >= maxItems) return;
    if (values.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...values, trimmed]);
  };

  return (
    <div className="exercise-editor__field">
      <Label htmlFor={id}>{label}</Label>
      <div className="exercise-editor__pill-input">
        <Input
          id={id}
          value={inputValue}
          placeholder={placeholder}
          list={datalistId}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addValue(inputValue);
            setInputValue("");
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => {
            addValue(inputValue);
            setInputValue("");
          }}
        >
          Add
        </Button>
      </div>
      {datalistId ? (
        <datalist id={datalistId}>
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
      {helper ? <div className="template-meta">{helper}</div> : null}
      {values.length ? (
        <div className="exercise-editor__pill-list">
          {values.map((item) => (
            <button
              key={item}
              type="button"
              className="exercise-editor__pill"
              onClick={() => onChange(values.filter((value) => value !== item))}
            >
              {item}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EquipmentInput({ equipmentOptions, values, onChange }) {
  const [selected, setSelected] = useState("");

  const addValue = (value) => {
    if (!value) return;
    if (values.includes(value)) return;
    onChange([...values, value]);
  };

  return (
    <div className="exercise-editor__field">
      <Label htmlFor="exercise-equipment-select">Equipment</Label>
      <div className="exercise-editor__pill-input">
        <Select
          id="exercise-equipment-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select equipment</option>
          {equipmentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => {
            addValue(selected);
            setSelected("");
          }}
          disabled={!selected}
        >
          Add
        </Button>
      </div>
      {values.length ? (
        <div className="exercise-editor__pill-list">
          {values.map((item) => (
            <button
              key={item}
              type="button"
              className="exercise-editor__pill"
              onClick={() => onChange(values.filter((value) => value !== item))}
            >
              {equipmentOptions.find((option) => option.id === item)?.label ?? item}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="template-meta">Leave blank for bodyweight exercises.</div>
      )}
    </div>
  );
}

export default function CustomExerciseEditor({
  open,
  exercise,
  initialName,
  equipmentList,
  allExercises,
  onClose,
  onSaved,
}) {
  const { apiKey, hasKey } = useSettings();
  const [form, setForm] = useState(() =>
    buildInitialState({ exercise, initialName })
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(buildInitialState({ exercise, initialName }));
    setSaveError("");
    setAiError("");
  }, [exercise, initialName, open]);

  const nameValue = form.name.trim();
  const canSave = nameValue.length > 0 && !saving;
  const aiReady = nameValue.length >= 3 && hasKey && !aiLoading;

  const equipmentMap = useMemo(
    () => getEquipmentMap(equipmentList ?? []),
    [equipmentList]
  );
  const equipmentOptions = useMemo(
    () =>
      Array.from(equipmentMap.entries()).map(([id, item]) => ({
        id,
        label: item.name ?? id,
      })),
    [equipmentMap]
  );

  const muscleOptions = useMemo(() => {
    const set = new Set();
    (allExercises ?? []).forEach((exerciseItem) => {
      getExercisePrimaryMuscles(exerciseItem).forEach((muscle) => set.add(muscle));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allExercises]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        name: form.name,
        aliases: form.aliases,
        primaryMuscles: form.primaryMuscles,
        secondaryMuscles: form.secondaryMuscles,
        equipment: form.equipment,
        category: form.category,
        pattern: form.pattern,
        instructions: parseLines(form.instructionsText),
        gotchas: parseLines(form.gotchasText),
        youtubeSearchQuery: form.youtubeSearchQuery,
        youtubeVideoId: form.youtubeVideoId,
        status: form.status,
      };

      const id = exercise?.id
        ? await updateCustomExercise(exercise.id, payload)
        : await createCustomExercise(payload);
      onSaved?.(id);
    } catch (error) {
      setSaveError(error?.message ?? "Unable to save exercise.");
    } finally {
      setSaving(false);
    }
  };

  const applyAutofill = (suggested) => {
    setForm((prev) => {
      const next = { ...prev };
      if (!prev.aliases.length && suggested.aliases.length) {
        next.aliases = suggested.aliases;
      }
      if (!prev.primaryMuscles.length && suggested.primaryMuscles.length) {
        next.primaryMuscles = suggested.primaryMuscles;
      }
      if (!prev.secondaryMuscles.length && suggested.secondaryMuscles.length) {
        next.secondaryMuscles = suggested.secondaryMuscles;
      }
      if (!prev.equipment.length && suggested.equipment.length) {
        next.equipment = suggested.equipment;
      }
      if (!prev.category.trim() && suggested.category) {
        next.category = suggested.category;
      }
      if (!prev.pattern.trim() && suggested.pattern) {
        next.pattern = suggested.pattern;
      }
      if (!prev.instructionsText.trim() && suggested.instructions.length) {
        next.instructionsText = suggested.instructions.join("\n");
      }
      if (!prev.gotchasText.trim() && suggested.gotchas.length) {
        next.gotchasText = suggested.gotchas.join("\n");
      }
      if (!prev.youtubeSearchQuery.trim() && suggested.youtubeSearchQuery) {
        next.youtubeSearchQuery = suggested.youtubeSearchQuery;
      }
      return next;
    });
  };

  const handleAutofill = async () => {
    if (!aiReady) return;
    setAiError("");
    setAiLoading(true);
    try {
      const hints = [form.category, form.pattern, form.instructionsText, form.gotchasText]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" ");
      const suggestion = await generateExerciseDetails({
        apiKey,
        name: form.name,
        hints,
      });

      const equipmentLookup = new Map();
      equipmentMap.forEach((item, id) => {
        equipmentLookup.set(String(id).toLowerCase(), id);
        equipmentLookup.set(String(item.name ?? "").toLowerCase(), id);
        (item.aliases ?? []).forEach((alias) => {
          equipmentLookup.set(String(alias).toLowerCase(), id);
        });
      });

      const normalizedEquipment = (suggestion.equipment ?? [])
        .map((item) => equipmentLookup.get(String(item).toLowerCase()) ?? null)
        .filter(Boolean);

      applyAutofill({ ...suggestion, equipment: normalizedEquipment });
    } catch (error) {
      setAiError(error?.message ?? "Unable to auto-fill right now.");
    } finally {
      setAiLoading(false);
    }
  };

  const sheetTitle = exercise?.id ? "Edit custom exercise" : "Create custom exercise";

  return (
    <BottomSheet open={open} onClose={onClose} title={sheetTitle}>
      <div className="exercise-editor">
        <Card>
          <CardHeader>
            <div className="ui-section-title">Basics</div>
          </CardHeader>
          <CardBody className="exercise-editor__section">
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-name">Name *</Label>
              <Input
                id="exercise-name"
                value={form.name}
                placeholder="e.g. Single-arm cable row"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="exercise-editor__ai">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={handleAutofill}
                disabled={!aiReady}
              >
                {aiLoading ? "Auto-filling…" : "Auto-fill with AI"}
              </Button>
              <div className="template-meta">
                {hasKey
                  ? "Fills empty fields based on the name."
                  : "Add an OpenAI key in Settings to enable AI."}
              </div>
              {aiError ? (
                <div className="exercise-editor__error" role="status">
                  <span>{aiError}</span>
                  <button type="button" onClick={handleAutofill}>
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
            <PillInput
              id="exercise-aliases"
              label="Aliases"
              placeholder="Add an alternate name"
              helper="Use aliases to improve search."
              values={form.aliases}
              onChange={(aliases) => setForm((prev) => ({ ...prev, aliases }))}
              maxItems={10}
            />
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-status">Status</Label>
              <Select
                id="exercise-status"
                value={form.status}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="ui-section-title">Muscles & equipment</div>
          </CardHeader>
          <CardBody className="exercise-editor__section">
            <PillInput
              id="exercise-primary-muscles"
              label="Primary muscles"
              placeholder="Add a primary muscle"
              values={form.primaryMuscles}
              onChange={(primaryMuscles) =>
                setForm((prev) => ({ ...prev, primaryMuscles }))
              }
              suggestions={muscleOptions}
            />
            <PillInput
              id="exercise-secondary-muscles"
              label="Secondary muscles"
              placeholder="Add a secondary muscle"
              values={form.secondaryMuscles}
              onChange={(secondaryMuscles) =>
                setForm((prev) => ({ ...prev, secondaryMuscles }))
              }
              suggestions={muscleOptions}
            />
            <EquipmentInput
              equipmentOptions={equipmentOptions}
              values={form.equipment}
              onChange={(equipment) => setForm((prev) => ({ ...prev, equipment }))}
            />
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-category">Category</Label>
              <Input
                id="exercise-category"
                value={form.category}
                placeholder="e.g. Strength"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, category: event.target.value }))
                }
              />
            </div>
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-pattern">Pattern</Label>
              <Input
                id="exercise-pattern"
                value={form.pattern}
                placeholder="e.g. Horizontal pull"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, pattern: event.target.value }))
                }
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="ui-section-title">Instructions</div>
          </CardHeader>
          <CardBody className="exercise-editor__section">
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-instructions">Instructions (one per line)</Label>
              <textarea
                id="exercise-instructions"
                className="ui-input exercise-editor__textarea"
                placeholder="Add a step per line"
                value={form.instructionsText}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, instructionsText: event.target.value }))
                }
                rows={5}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="ui-section-title">Gotchas</div>
          </CardHeader>
          <CardBody className="exercise-editor__section">
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-gotchas">Gotchas (one per line)</Label>
              <textarea
                id="exercise-gotchas"
                className="ui-input exercise-editor__textarea"
                placeholder="Add a caution per line"
                value={form.gotchasText}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, gotchasText: event.target.value }))
                }
                rows={5}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="ui-section-title">Media</div>
          </CardHeader>
          <CardBody className="exercise-editor__section">
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-youtube-query">YouTube search query</Label>
              <Input
                id="exercise-youtube-query"
                value={form.youtubeSearchQuery}
                placeholder={`${nameValue || "Exercise"} exercise form cues`}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    youtubeSearchQuery: event.target.value,
                  }))
                }
              />
            </div>
            <div className="exercise-editor__field">
              <Label htmlFor="exercise-youtube-id">YouTube video ID (optional)</Label>
              <Input
                id="exercise-youtube-id"
                value={form.youtubeVideoId ?? ""}
                placeholder="e.g. dQw4w9WgXcQ"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, youtubeVideoId: event.target.value }))
                }
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="exercise-editor__actions">
        {saveError ? (
          <div className="exercise-editor__error" role="status">
            {saveError}
          </div>
        ) : null}
        <div className="exercise-editor__actions-row">
          <Button variant="ghost" size="md" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
