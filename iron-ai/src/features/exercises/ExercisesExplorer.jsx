import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  PageHeader,
  Select,
} from "../../components/ui";
import {
  db,
  getAllExercises,
  listEquipment,
  listWorkoutSpaces,
} from "../../db";
import { getEquipmentMap } from "../../equipment/catalog";
import { getMissingEquipmentForExercise } from "../../equipment/engine";
import {
  buildExerciseSearchText,
  getExerciseEquipment,
  getExercisePrimaryMuscles,
  getExerciseType,
} from "../../exercises/data";
import {
  resetExerciseSeedVersion,
  seedExercisesIfNeeded,
} from "../../seed/exerciseSeed";
import { getExerciseUsageStats } from "../../exercises/derived";
import { resolveActiveSpace } from "../../workoutSpaces/logic";

import ExerciseDetailView from "./ExerciseDetailView";
import ExerciseList from "./ExerciseList";
import ExerciseHistoryDrawer from "./ExerciseHistoryDrawer";
import CollapsibleFilters from "./CollapsibleFilters";
import CustomExerciseEditor from "./CustomExerciseEditor";

function sortByName(a, b) {
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

function buildMuscleOptions(exercises) {
  const set = new Set();
  exercises.forEach((exercise) => {
    getExercisePrimaryMuscles(exercise).forEach((muscle) => set.add(muscle));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function buildTypeOptions(exercises) {
  const set = new Set();
  exercises.forEach((exercise) => {
    const type = getExerciseType(exercise);
    if (type) set.add(type);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function buildEquipmentOptions(exercises, equipmentMap) {
  const ids = new Set();
  exercises.forEach((exercise) => {
    getExerciseEquipment(exercise).forEach((id) => ids.add(id));
  });
  const options = Array.from(ids)
    .map((id) => ({ id, label: equipmentMap.get(id)?.name ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return options;
}

export default function ExercisesExplorer({
  onBack,
  onLaunchCoach,
  onAddToWorkout,
  isSeeding,
  onReseed,
}) {
  const exercises = useLiveQuery(() => getAllExercises(), []);
  const equipmentList = useLiveQuery(() => listEquipment(), []);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const usageStats = useLiveQuery(() => getExerciseUsageStats(), []);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMuscle, setSelectedMuscle] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [filterByActiveGym, setFilterByActiveGym] = useState(false);
  const [coreOnly, setCoreOnly] = useState(false);
  const [sortMode, setSortMode] = useState("az");
  const [detailExerciseId, setDetailExerciseId] = useState(null);
  const [historyExercise, setHistoryExercise] = useState(null);
  const [reseeding, setReseeding] = useState(false);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState(null);

  const equipmentMap = useMemo(
    () => getEquipmentMap(equipmentList ?? []),
    [equipmentList]
  );

  const activeSpace = useMemo(
    () => resolveActiveSpace(workoutSpaces ?? [], settings?.active_space_id ?? null),
    [settings?.active_space_id, workoutSpaces]
  );
  const hasActiveGym = Boolean(activeSpace);

  const usageMap = useMemo(() => {
    const entries = Array.isArray(usageStats) ? usageStats : [];
    return new Map(entries.map((entry) => [entry.exerciseId, entry]));
  }, [usageStats]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const searchQuery = search.trim().toLowerCase();

  const filteredExercises = useMemo(() => {
    let filtered = Array.isArray(exercises) ? exercises.slice() : [];
    if (searchQuery) {
      filtered = filtered.filter((exercise) =>
        buildExerciseSearchText(exercise).includes(searchQuery)
      );
    }
    if (selectedMuscle) {
      filtered = filtered.filter((exercise) =>
        getExercisePrimaryMuscles(exercise).includes(selectedMuscle)
      );
    }
    if (selectedEquipment) {
      filtered = filtered.filter((exercise) => {
        const equipment = getExerciseEquipment(exercise);
        return equipment.includes(selectedEquipment);
      });
    }
    if (selectedType) {
      filtered = filtered.filter(
        (exercise) => getExerciseType(exercise) === selectedType
      );
    }
    if (coreOnly) {
      filtered = filtered.filter((exercise) => exercise.status === "core");
    }
    if (filterByActiveGym && hasActiveGym) {
      filtered = filtered.filter((exercise) => {
        const missing = getMissingEquipmentForExercise(
          exercise,
          activeSpace?.equipmentIds ?? [],
          equipmentMap
        );
        return missing.length === 0;
      });
    }

    if (sortMode === "most_used") {
      filtered.sort((a, b) => {
        const countDiff =
          (usageMap.get(b.id)?.count ?? 0) - (usageMap.get(a.id)?.count ?? 0);
        if (countDiff !== 0) return countDiff;
        return sortByName(a, b);
      });
      return filtered;
    }

    if (sortMode === "recent") {
      filtered.sort((a, b) => {
        const dateA = usageMap.get(a.id)?.lastPerformed ?? "";
        const dateB = usageMap.get(b.id)?.lastPerformed ?? "";
        if (dateA && dateB && dateA !== dateB) {
          return String(dateB).localeCompare(String(dateA));
        }
        return sortByName(a, b);
      });
      return filtered;
    }

    filtered.sort(sortByName);
    return filtered;
  }, [
    activeSpace,
    equipmentMap,
    exercises,
    filterByActiveGym,
    hasActiveGym,
    searchQuery,
    selectedEquipment,
    selectedMuscle,
    selectedType,
    sortMode,
    usageMap,
    coreOnly,
  ]);

  const muscleOptions = useMemo(
    () => buildMuscleOptions(exercises ?? []),
    [exercises]
  );
  const typeOptions = useMemo(() => buildTypeOptions(exercises ?? []), [exercises]);
  const equipmentOptions = useMemo(
    () => buildEquipmentOptions(exercises ?? [], equipmentMap),
    [equipmentMap, exercises]
  );

  const isLoading = isSeeding && (!exercises || exercises.length === 0);
  const emptyLabel = isLoading
    ? "Loading exercises…"
    : coreOnly
      ? "No core exercises found yet. Try turning off Core only."
      : "No exercises match those filters.";
  const activeFilterCount = [
    selectedMuscle,
    selectedEquipment,
    selectedType,
    filterByActiveGym && hasActiveGym ? "gym" : "",
    coreOnly ? "core" : "",
    sortMode !== "az" ? "sort" : "",
  ].filter(Boolean).length;
  const clearFilters = () => {
    setSelectedMuscle("");
    setSelectedEquipment("");
    setSelectedType("");
    setFilterByActiveGym(false);
    setCoreOnly(false);
    setSortMode("az");
  };

  const handleReseed = async () => {
    if (!import.meta.env.DEV) return;
    setReseeding(true);
    try {
      if (onReseed) {
        await onReseed();
      } else {
        await resetExerciseSeedVersion();
        await seedExercisesIfNeeded();
      }
    } finally {
      setReseeding(false);
    }
  };

  if (detailExerciseId) {
    return (
      <ExerciseDetailView
        exerciseId={detailExerciseId}
        onBack={() => setDetailExerciseId(null)}
        onOpenExercise={(nextId) => setDetailExerciseId(nextId)}
        onAddExercise={onAddToWorkout}
        onLaunchCoach={onLaunchCoach}
        onEditExercise={(exercise) => {
          setEditingExercise(exercise);
          setCustomEditorOpen(true);
        }}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Exercises"
        subtitle="Browse the full exercise library."
        actions={
          <div className="ui-row ui-row--wrap">
            {onBack ? (
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingExercise(null);
                setCustomEditorOpen(true);
              }}
            >
              Create custom exercise
            </Button>
          </div>
        }
      />

      <CollapsibleFilters
        label="Filters"
        activeCount={activeFilterCount}
        defaultExpanded={false}
        storageKey="ironai.exerciseLibrary.filtersExpanded"
      >
        {({ expanded, label, panelId, toggle }) => (
          <>
            <div className="sticky-search sticky-search--stack">
              <Label htmlFor="exercise-library-search">Search exercises</Label>
              <div className="search-field">
                <Input
                  id="exercise-library-search"
                  type="search"
                  placeholder="Search by name or alias"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                {searchInput ? (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => {
                      setSearchInput("");
                      setSearch("");
                    }}
                    aria-label="Clear search"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="exercise-editor__inline-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setEditingExercise(null);
                    setCustomEditorOpen(true);
                  }}
                >
                  + Custom exercise
                </Button>
              </div>
              <button
                type="button"
                className="filters-toggle"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={toggle}
              >
                <span className="filters-toggle__label">{label}</span>
                <span className="filters-toggle__chevron" aria-hidden="true">
                  {expanded ? "▲" : "▼"}
                </span>
              </button>
            </div>
            {expanded ? (
              <Card className="filters-panel">
                <CardHeader>
                  <div className="ui-section-title">Search & filters</div>
                </CardHeader>
                <CardBody className="ui-stack" id={panelId}>
                  <div className="filter-grid">
                    <div>
                      <Label htmlFor="exercise-library-muscle">Muscle group</Label>
                      <Select
                        id="exercise-library-muscle"
                        value={selectedMuscle}
                        onChange={(event) => setSelectedMuscle(event.target.value)}
                      >
                        <option value="">All muscles</option>
                        {muscleOptions.map((muscle) => (
                          <option key={muscle} value={muscle}>
                            {muscle}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="exercise-library-equipment">Equipment</Label>
                      <Select
                        id="exercise-library-equipment"
                        value={selectedEquipment}
                        onChange={(event) => setSelectedEquipment(event.target.value)}
                      >
                        <option value="">All equipment</option>
                        {equipmentOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {typeOptions.length ? (
                      <div>
                        <Label htmlFor="exercise-library-type">Type</Label>
                        <Select
                          id="exercise-library-type"
                          value={selectedType}
                          onChange={(event) => setSelectedType(event.target.value)}
                        >
                          <option value="">All types</option>
                          {typeOptions.map((type) => (
                            <option key={type} value={type}>
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}
                  </div>

                  <div className="ui-row ui-row--between ui-row--wrap">
                    <div>
                      <div className="ui-strong">Available at active gym</div>
                      <div className="template-meta">
                        Filter exercises by active gym equipment.
                      </div>
                    </div>
                    <Button
                      variant={filterByActiveGym ? "primary" : "secondary"}
                      size="sm"
                      type="button"
                      onClick={() => {
                        if (!hasActiveGym) return;
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
                      <div className="ui-strong">Core only</div>
                      <div className="template-meta">
                        Hide extended exercises from the seeded library.
                      </div>
                    </div>
                    <Button
                      variant={coreOnly ? "primary" : "secondary"}
                      size="sm"
                      type="button"
                      onClick={() => setCoreOnly((prev) => !prev)}
                      aria-pressed={coreOnly}
                    >
                      {coreOnly ? "On" : "Off"}
                    </Button>
                  </div>

                  {import.meta.env.DEV ? (
                    <div className="ui-row ui-row--between ui-row--wrap">
                      <div>
                        <div className="ui-strong">Seed data</div>
                        <div className="template-meta">Reload the exercise dataset.</div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={handleReseed}
                        disabled={reseeding}
                      >
                        {reseeding ? "Reseeding…" : "Reseed"}
                      </Button>
                    </div>
                  ) : null}

                  <div>
                    <Label htmlFor="exercise-library-sort">Sort by</Label>
                    <Select
                      id="exercise-library-sort"
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value)}
                    >
                      <option value="az">A-Z</option>
                      <option value="most_used">Most used</option>
                      <option value="recent">Recently used</option>
                    </Select>
                  </div>

                  <div className="ui-row ui-row--between ui-row--wrap filters-clear">
                    <div className="template-meta">Reset all filters.</div>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ) : null}
          </>
        )}
      </CollapsibleFilters>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Exercise library</div>
          <div className="pill">{filteredExercises.length} total</div>
        </CardHeader>
        <CardBody>
          <ExerciseList
            exercises={filteredExercises}
            equipmentList={equipmentMap}
            activeSpace={activeSpace}
            onSelect={(exercise) => setDetailExerciseId(exercise.id)}
            onHistory={(exercise) =>
              setHistoryExercise({
                id: exercise.id,
                name: exercise.name,
                stickyNote: exercise.stickyNote,
              })
            }
            emptyLabel={emptyLabel}
          />
          {coreOnly && !isLoading && filteredExercises.length === 0 ? (
            <div className="ui-row ui-row--between ui-row--wrap">
              <div className="template-meta">See all exercises instead.</div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setCoreOnly(false)}
              >
                Turn off Core only
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <ExerciseHistoryDrawer
        open={Boolean(historyExercise)}
        exerciseId={historyExercise?.id ?? null}
        exerciseName={historyExercise?.name ?? null}
        stickyNote={historyExercise?.stickyNote ?? null}
        onClose={() => setHistoryExercise(null)}
      />

      <CustomExerciseEditor
        open={customEditorOpen}
        exercise={editingExercise}
        equipmentList={equipmentList}
        allExercises={exercises}
        onClose={() => setCustomEditorOpen(false)}
        onSaved={(exerciseId) => {
          setCustomEditorOpen(false);
          setEditingExercise(null);
          if (exerciseId) setDetailExerciseId(exerciseId);
        }}
      />
    </div>
  );
}
