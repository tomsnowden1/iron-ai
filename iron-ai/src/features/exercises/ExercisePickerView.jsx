import { useEffect, useMemo, useRef, useState } from "react";

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
import { getEquipmentMap } from "../../equipment/catalog";
import { getMissingEquipmentForExercise } from "../../equipment/engine";
import {
  buildExerciseSearchText,
  getExercisePrimaryMuscles,
  getExerciseType,
  getNormalizedEquipment,
} from "../../exercises/data";

import ExerciseDetailView from "./ExerciseDetailView";
import ExerciseList from "./ExerciseList";
import CollapsibleFilters from "./CollapsibleFilters";

function sortByName(a, b) {
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

function buildEquipmentOptions(exercises, equipmentMap) {
  const ids = new Set();
  exercises.forEach((exercise) => {
    const { requiredEquipmentIds } = getNormalizedEquipment(exercise);
    requiredEquipmentIds.forEach((id) => ids.add(id));
  });
  const options = Array.from(ids)
    .map((id) => ({ id, label: equipmentMap.get(id)?.name ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return options;
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

export default function ExercisePickerView({
  title = "Exercise Picker",
  subtitle = "Select an exercise to add.",
  exercises,
  equipmentList,
  usageStats,
  activeSpace,
  settings,
  excludeExerciseIds,
  prefillExercise,
  onSelectExercise,
  onClose,
  onLaunchCoach,
}) {
  const sessionKeyRef = useRef("ironai.exercisePicker.sessionState");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterByActiveGym, setFilterByActiveGym] = useState(
    settings?.exercise_picker_filter_active_gym ?? true
  );
  const [showMostUsedFirst, setShowMostUsedFirst] = useState(
    settings?.exercise_picker_most_used_first ?? true
  );
  const [selectedMuscle, setSelectedMuscle] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [pickerTouched, setPickerTouched] = useState(false);
  const [detailExerciseId, setDetailExerciseId] = useState(null);

  const searchRef = useRef(null);
  const autoFocusAppliedRef = useRef(false);

  const equipmentMap = useMemo(
    () => (equipmentList instanceof Map ? equipmentList : getEquipmentMap(equipmentList ?? [])),
    [equipmentList]
  );

  const excludeSet = useMemo(() => {
    if (!excludeExerciseIds) return new Set();
    if (excludeExerciseIds instanceof Set) return excludeExerciseIds;
    return new Set(excludeExerciseIds);
  }, [excludeExerciseIds]);

  const availableExercises = useMemo(() => {
    const list = Array.isArray(exercises) ? exercises : [];
    return list.filter((exercise) => !excludeSet.has(exercise.id));
  }, [excludeSet, exercises]);

  const hasActiveGym = Boolean(activeSpace);
  const pickerAutoFocus = settings?.exercise_picker_auto_focus ?? true;
  const pickerFilterDefault = settings?.exercise_picker_filter_active_gym ?? true;
  const pickerMostUsedDefault = settings?.exercise_picker_most_used_first ?? true;
  const sessionStorageAvailable =
    typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

  const usageMap = useMemo(() => {
    const entries = Array.isArray(usageStats) ? usageStats : [];
    return new Map(entries.map((entry) => [entry.exerciseId, entry]));
  }, [usageStats]);
  const hasUsageHistory = usageMap.size > 0;

  const muscleOptions = useMemo(
    () => buildMuscleOptions(availableExercises),
    [availableExercises]
  );
  const equipmentOptions = useMemo(
    () => buildEquipmentOptions(availableExercises, equipmentMap),
    [availableExercises, equipmentMap]
  );
  const typeOptions = useMemo(
    () => buildTypeOptions(availableExercises),
    [availableExercises]
  );

  const searchQuery = search.trim().toLowerCase();
  const filteredExercises = useMemo(() => {
    let filtered = availableExercises.slice();
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
        const { requiredEquipmentIds } = getNormalizedEquipment(exercise);
        return requiredEquipmentIds.includes(selectedEquipment);
      });
    }
    if (selectedType) {
      filtered = filtered.filter(
        (exercise) => getExerciseType(exercise) === selectedType
      );
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
    filtered.sort(sortByName);
    return filtered;
  }, [
    activeSpace,
    availableExercises,
    equipmentMap,
    filterByActiveGym,
    hasActiveGym,
    searchQuery,
    selectedEquipment,
    selectedMuscle,
    selectedType,
  ]);

  const mostUsedExercises = useMemo(() => {
    if (!showMostUsedFirst || !hasUsageHistory) return [];
    const filtered = filteredExercises.filter(
      (exercise) => (usageMap.get(exercise.id)?.count ?? 0) > 0
    );
    if (!filtered.length) return [];
    const sorted = [...filtered].sort((a, b) => {
      const countDiff =
        (usageMap.get(b.id)?.count ?? 0) - (usageMap.get(a.id)?.count ?? 0);
      if (countDiff !== 0) return countDiff;
      return sortByName(a, b);
    });
    return sorted.slice(0, 6);
  }, [filteredExercises, hasUsageHistory, showMostUsedFirst, usageMap]);

  const remainingExercises = useMemo(() => {
    if (!mostUsedExercises.length) return filteredExercises;
    const mostUsedIds = new Set(mostUsedExercises.map((exercise) => exercise.id));
    return filteredExercises.filter((exercise) => !mostUsedIds.has(exercise.id));
  }, [filteredExercises, mostUsedExercises]);

  useEffect(() => {
    if (pickerTouched) return;
    const prefillActive = Boolean(prefillExercise?.id || prefillExercise?.name);
    setFilterByActiveGym(pickerFilterDefault && hasActiveGym && !prefillActive);
    setShowMostUsedFirst(pickerMostUsedDefault);
    if (pickerAutoFocus && !autoFocusAppliedRef.current && searchRef.current) {
      searchRef.current.focus();
      autoFocusAppliedRef.current = true;
    }
  }, [
    hasActiveGym,
    pickerAutoFocus,
    pickerFilterDefault,
    pickerMostUsedDefault,
    pickerTouched,
    prefillExercise,
  ]);

  useEffect(() => {
    if (pickerTouched || prefillExercise?.name) return;
    if (!sessionStorageAvailable) return;
    const saved = window.sessionStorage.getItem(sessionKeyRef.current);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.search === "string") {
        setSearchInput(parsed.search);
        setSearch(parsed.search);
      }
      if (typeof parsed?.muscle === "string") {
        setSelectedMuscle(parsed.muscle);
      }
      if (typeof parsed?.equipment === "string") {
        setSelectedEquipment(parsed.equipment);
      }
    } catch {
      window.sessionStorage.removeItem(sessionKeyRef.current);
    }
  }, [pickerTouched, prefillExercise]);

  useEffect(() => {
    if (!sessionStorageAvailable) return;
    const nextState = {
      search: searchInput,
      muscle: selectedMuscle,
      equipment: selectedEquipment,
    };
    window.sessionStorage.setItem(sessionKeyRef.current, JSON.stringify(nextState));
  }, [searchInput, selectedMuscle, selectedEquipment, sessionStorageAvailable]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (hasActiveGym) return;
    setFilterByActiveGym(false);
  }, [hasActiveGym]);

  useEffect(() => {
    if (!prefillExercise?.name) return;
    setSearchInput(prefillExercise.name);
    setSearch(prefillExercise.name);
  }, [prefillExercise]);

  const handleSelect = async (exercise) => {
    if (!exercise?.id) return;
    try {
      const result = await onSelectExercise?.(exercise.id);
      if (result === false) return;
      onClose?.();
    } catch {
      // Parent already surfaced the error.
    }
  };

  if (detailExerciseId) {
    return (
      <ExerciseDetailView
        exerciseId={detailExerciseId}
        onBack={() => setDetailExerciseId(null)}
        onOpenExercise={(nextId) => setDetailExerciseId(nextId)}
        onAddExercise={(exerciseId) => handleSelect({ id: exerciseId })}
        onLaunchCoach={onLaunchCoach}
      />
    );
  }

  const showMostUsedSection = showMostUsedFirst && mostUsedExercises.length > 0;
  const hasFilteredExercises = filteredExercises.length > 0;
  const emptyLabel = availableExercises.length
    ? "No exercises match filters"
    : "No exercises available";
  const activeFilterCount = [
    selectedMuscle,
    selectedEquipment,
    selectedType,
    filterByActiveGym && hasActiveGym ? "gym" : "",
  ].filter(Boolean).length;
  const clearFilters = () => {
    setPickerTouched(true);
    setSelectedMuscle("");
    setSelectedEquipment("");
    setSelectedType("");
    setFilterByActiveGym(pickerFilterDefault && hasActiveGym);
    setShowMostUsedFirst(pickerMostUsedDefault);
  };

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
        }
      />

      <CollapsibleFilters
        label="Filters"
        activeCount={activeFilterCount}
        defaultExpanded={false}
        storageKey="ironai.exercisePicker.filtersExpanded"
      >
        {({ expanded, label, panelId, toggle }) => (
          <>
            <div className="sticky-search sticky-search--stack">
              <Label htmlFor="exercise-picker-search">Search exercises</Label>
              <div className="search-field">
                <Input
                  id="exercise-picker-search"
                  type="search"
                  placeholder="Search by name or alias"
                  value={searchInput}
                  onChange={(event) => {
                    setPickerTouched(true);
                    setSearchInput(event.target.value);
                  }}
                  ref={searchRef}
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
                      <Label htmlFor="exercise-picker-muscle">Muscle group</Label>
                      <Select
                        id="exercise-picker-muscle"
                        value={selectedMuscle}
                        onChange={(event) => {
                          setPickerTouched(true);
                          setSelectedMuscle(event.target.value);
                        }}
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
                      <Label htmlFor="exercise-picker-equipment">Equipment</Label>
                      <Select
                        id="exercise-picker-equipment"
                        value={selectedEquipment}
                        onChange={(event) => {
                          setPickerTouched(true);
                          setSelectedEquipment(event.target.value);
                        }}
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
                        <Label htmlFor="exercise-picker-type">Type</Label>
                        <Select
                          id="exercise-picker-type"
                          value={selectedType}
                          onChange={(event) => {
                            setPickerTouched(true);
                            setSelectedType(event.target.value);
                          }}
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
                        Only show exercises available at the active gym.
                      </div>
                      {!hasActiveGym ? (
                        <div className="template-meta">
                          Set an active gym to filter by equipment.
                        </div>
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
          <div className="ui-section-title">Exercises</div>
          <div className="pill">{filteredExercises.length} found</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {!hasFilteredExercises ? (
            <div className="empty-state">{emptyLabel}</div>
          ) : (
            <div className="ui-stack">
              {showMostUsedSection ? (
                <div className="ui-stack">
                  <div className="template-meta">Most Used</div>
                  <ExerciseList
                    exercises={mostUsedExercises}
                    equipmentList={equipmentMap}
                    activeSpace={activeSpace}
                    onSelect={handleSelect}
                    onInfo={(exercise) => setDetailExerciseId(exercise.id)}
                  />
                </div>
              ) : null}
              <div className="ui-stack">
                {showMostUsedSection ? (
                  <div className="template-meta">All Exercises</div>
                ) : null}
                <ExerciseList
                  exercises={showMostUsedSection ? remainingExercises : filteredExercises}
                  equipmentList={equipmentMap}
                  activeSpace={activeSpace}
                  onSelect={handleSelect}
                  onInfo={(exercise) => setDetailExerciseId(exercise.id)}
                  emptyLabel={emptyLabel}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
