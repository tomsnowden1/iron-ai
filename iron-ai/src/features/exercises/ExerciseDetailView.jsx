import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  PageHeader,
} from "../../components/ui";
import {
  db,
  getAllExercises,
  listEquipment,
  listWorkoutSpaces,
} from "../../db";
import { getEquipmentMap } from "../../equipment/catalog";
import {
  getExerciseSubstitutionsForExercise,
  getMissingEquipmentForExercise,
} from "../../equipment/engine";
import { resolveActiveSpace } from "../../workoutSpaces/logic";
import {
  getExerciseGotchas,
  getExerciseInstructions,
  getExercisePrimaryMuscles,
  getExerciseSecondaryMuscles,
  getExerciseVideoUrl,
  getNormalizedEquipment,
} from "../../exercises/data";
import {
  getExerciseHistory,
  getGymAvailabilityForExercise,
  parseMetric,
} from "../../exercises/derived";

const HISTORY_LIMIT = 18;
const CHART_LIMIT = 12;

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString();
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return Number(value).toFixed(0);
}

function formatWeight(weight, reps) {
  if (weight != null) {
    const repsLabel = reps != null ? formatNumber(reps) : "N/A";
    return `${formatNumber(weight)} x ${repsLabel}`;
  }
  if (reps != null) return `${formatNumber(reps)} reps`;
  return "N/A";
}

function buildSeries(history, key) {
  const points = history
    .slice(0, CHART_LIMIT)
    .map((entry) => ({
      date: entry.date,
      value: entry[key] ?? null,
    }))
    .reverse();
  return points.filter((entry) => entry.value != null && !Number.isNaN(entry.value));
}

function MiniLineChart({ data }) {
  if (!data.length) {
    return <div className="chart-empty">No data yet.</div>;
  }

  const width = 220;
  const height = 70;
  const padding = 8;
  const values = data.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data
    .map((point, index) => {
      const x =
        padding +
        (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        ((point.value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="mini-chart" viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function LinkedExerciseList({ items, emptyLabel, onOpen }) {
  if (!items.length) return <div className="template-meta">{emptyLabel}</div>;
  return (
    <div className="linked-exercises">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="linked-exercises__item"
          onClick={() => onOpen?.(item.id)}
          disabled={!onOpen}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}

export default function ExerciseDetailView({
  exerciseId,
  onBack,
  onOpenExercise,
  onAddExercise,
  onLaunchCoach,
}) {
  const exercise = useLiveQuery(
    () => (exerciseId ? db.table("exercises").get(exerciseId) : null),
    [exerciseId]
  );
  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const equipmentList = useLiveQuery(() => listEquipment(), []);
  const workoutSpaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const history = useLiveQuery(
    () => (exerciseId ? getExerciseHistory(exerciseId, { limit: HISTORY_LIMIT }) : []),
    [exerciseId]
  );

  const equipmentMap = useMemo(
    () => getEquipmentMap(equipmentList ?? []),
    [equipmentList]
  );
  const activeSpace = useMemo(
    () => resolveActiveSpace(workoutSpaces ?? [], settings?.active_space_id ?? null),
    [settings?.active_space_id, workoutSpaces]
  );

  const primaryMuscles = getExercisePrimaryMuscles(exercise);
  const secondaryMuscles = getExerciseSecondaryMuscles(exercise);
  const instructionsData = getExerciseInstructions(exercise);
  const gotchasData = getExerciseGotchas(exercise);
  const videoUrl = getExerciseVideoUrl(exercise);
  const normalizedEquipment = getNormalizedEquipment(exercise);
  const youtubeSearchQuery =
    exercise?.youtubeSearchQuery ??
    `${exercise?.name ?? "exercise"} exercise form cues`;
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    youtubeSearchQuery
  )}`;
  const youtubeVideoId =
    typeof exercise?.youtubeVideoId === "string" && exercise.youtubeVideoId.trim()
      ? exercise.youtubeVideoId.trim()
      : null;

  const historyStats = useMemo(() => {
    const sessions = Array.isArray(history) ? history : [];
    if (!sessions.length) {
      return {
        lastPerformed: null,
        timesPerformed: 0,
        bestSet: null,
        bestOneRm: null,
      };
    }

    let bestSet = null;
    let bestOneRm = null;
    sessions.forEach((entry) => {
      const entryBest = entry.bestSet;
      if (entryBest) {
        const entryWeight = parseMetric(entryBest.weight);
        const entryReps = parseMetric(entryBest.reps);
        const bestWeight = parseMetric(bestSet?.weight);
        const bestReps = parseMetric(bestSet?.reps);

        if (entryWeight != null) {
          if (bestWeight == null || entryWeight > bestWeight) {
            bestSet = entryBest;
          } else if (entryWeight === bestWeight && entryReps != null) {
            if ((bestReps ?? 0) < entryReps) {
              bestSet = entryBest;
            }
          }
        } else if (bestWeight == null && entryReps != null) {
          if ((bestReps ?? 0) < entryReps) {
            bestSet = entryBest;
          }
        }
      }

      if (entry.oneRm != null) {
        if (bestOneRm == null || entry.oneRm > bestOneRm) {
          bestOneRm = entry.oneRm;
        }
      }
    });

    return {
      lastPerformed: sessions[0]?.date ?? null,
      timesPerformed: sessions.length,
      bestSet,
      bestOneRm,
    };
  }, [history]);

  const usageNote = historyStats.timesPerformed
    ? `${historyStats.timesPerformed} sessions`
    : "No sessions yet";

  const volumeSeries = useMemo(() => buildSeries(history ?? [], "volume"), [history]);
  const maxWeightSeries = useMemo(() => buildSeries(history ?? [], "maxWeight"), [history]);
  const oneRmSeries = useMemo(() => buildSeries(history ?? [], "oneRm"), [history]);

  const gymAvailability = useMemo(() => {
    if (!exercise) return [];
    return getGymAvailabilityForExercise(exercise, workoutSpaces ?? [], equipmentList ?? []);
  }, [equipmentList, exercise, workoutSpaces]);

  const activeGymMissing = useMemo(() => {
    if (!exercise || !activeSpace) return [];
    return getMissingEquipmentForExercise(
      exercise,
      activeSpace.equipmentIds ?? [],
      equipmentMap
    );
  }, [activeSpace, equipmentMap, exercise]);

  const substitutionHints = useMemo(() => {
    if (!exercise || !activeSpace || !allExercises?.length) return [];
    return getExerciseSubstitutionsForExercise(
      exercise,
      allExercises,
      activeSpace.equipmentIds ?? [],
      equipmentMap
    );
  }, [activeSpace, allExercises, equipmentMap, exercise]);

  const exerciseMap = useMemo(
    () => new Map((allExercises ?? []).map((ex) => [ex.id, ex])),
    [allExercises]
  );

  const progressions = useMemo(() => {
    const list = Array.isArray(exercise?.progressions) ? exercise.progressions : [];
    const resolved = list
      .map((item) => {
        if (typeof item === "number") return exerciseMap.get(item) ?? null;
        if (typeof item === "string") {
          const parsed = Number(item);
          if (!Number.isNaN(parsed)) return exerciseMap.get(parsed) ?? null;
          return (
            allExercises ?? []
          ).find((ex) => String(ex.name ?? "").toLowerCase() === item.toLowerCase()) ?? null;
        }
        if (item && typeof item === "object") {
          const id = item.exerciseId ?? item.id;
          if (id != null) return exerciseMap.get(id) ?? null;
        }
        return null;
      })
      .filter(Boolean)
      .map((item) => ({ id: item.id, name: item.name ?? "Exercise" }));
    return resolved;
  }, [allExercises, exercise?.progressions, exerciseMap]);

  const regressions = useMemo(() => {
    const list = Array.isArray(exercise?.regressions) ? exercise.regressions : [];
    const resolved = list
      .map((item) => {
        if (typeof item === "number") return exerciseMap.get(item) ?? null;
        if (typeof item === "string") {
          const parsed = Number(item);
          if (!Number.isNaN(parsed)) return exerciseMap.get(parsed) ?? null;
          return (
            allExercises ?? []
          ).find((ex) => String(ex.name ?? "").toLowerCase() === item.toLowerCase()) ?? null;
        }
        if (item && typeof item === "object") {
          const id = item.exerciseId ?? item.id;
          if (id != null) return exerciseMap.get(id) ?? null;
        }
        return null;
      })
      .filter(Boolean)
      .map((item) => ({ id: item.id, name: item.name ?? "Exercise" }));
    return resolved;
  }, [allExercises, exercise?.regressions, exerciseMap]);

  const fallbackAlternatives = useMemo(() => {
    if (!exercise || !allExercises?.length) return [];
    const spaceEquipment = activeSpace?.equipmentIds ?? equipmentList?.map((eq) => eq.id) ?? [];
    return getExerciseSubstitutionsForExercise(
      exercise,
      allExercises,
      spaceEquipment,
      equipmentMap
    ).map((item) => ({ id: item.exerciseId, name: item.name }));
  }, [activeSpace, allExercises, equipmentList, equipmentMap, exercise]);

  if (!exerciseId || exercise === undefined) {
    return (
      <div className="page">
        <PageHeader title="Exercise" subtitle="Loading exercise details." />
        <Card>
          <CardBody className="ui-muted">Loading exercise…</CardBody>
        </Card>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="page">
        <PageHeader
          title="Exercise"
          subtitle="This exercise could not be found."
          actions={
            onBack ? (
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null
          }
        />
        <Card>
          <CardBody>
            <div className="empty-state">Exercise not found.</div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const equipmentLabels = normalizedEquipment.requiredEquipmentIds
    .map((id) => equipmentMap.get(id)?.name ?? id)
    .filter(Boolean);
  const optionalLabels = normalizedEquipment.optionalEquipmentIds
    .map((id) => equipmentMap.get(id)?.name ?? id)
    .filter(Boolean);

  const availableGyms = gymAvailability.filter((item) => item.isAvailable);
  const unavailableGyms = gymAvailability.filter((item) => !item.isAvailable);

  return (
    <div className="page">
      <PageHeader
        title={exercise.name ?? "Exercise"}
        subtitle={primaryMuscles.length ? primaryMuscles.join(" · ") : ""}
        actions={
          <div className="ui-row ui-row--wrap">
            {onBack ? (
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            {onAddExercise ? (
              <Button variant="primary" size="sm" onClick={() => onAddExercise(exercise.id)}>
                Add to workout
              </Button>
            ) : null}
            {onLaunchCoach ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onLaunchCoach({
                    source: "exercise_detail",
                    exerciseId: exercise.id,
                    exerciseName: exercise.name ?? "Exercise",
                  })
                }
              >
                Ask Coach
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <div className="ui-section-title">Overview</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div className="exercise-overview">
            <div className="exercise-overview__media">
              {youtubeVideoId ? (
                <iframe
                  title={`${exercise.name ?? "Exercise"} video`}
                  src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                  className="exercise-video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : videoUrl ? (
                <a href={videoUrl} target="_blank" rel="noreferrer">
                  Open video demo
                </a>
              ) : (
                <div className="template-meta">Video placeholder</div>
              )}
            </div>
            <div className="exercise-overview__meta">
              <div>
                <div className="template-meta">Primary muscles</div>
                <div className="ui-strong">
                  {primaryMuscles.length ? primaryMuscles.join(", ") : "N/A"}
                </div>
              </div>
              {secondaryMuscles.length ? (
                <div>
                  <div className="template-meta">Secondary muscles</div>
                  <div>{secondaryMuscles.join(", ")}</div>
                </div>
              ) : null}
              <div>
                <div className="template-meta">Required equipment</div>
                <div className="equipment-pills">
                  {equipmentLabels.length ? (
                    equipmentLabels.map((label) => (
                      <span key={label} className="equipment-pill">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="template-meta">None listed</span>
                  )}
                </div>
              </div>
              {optionalLabels.length ? (
                <div>
                  <div className="template-meta">Optional equipment</div>
                  <div className="equipment-pills">
                    {optionalLabels.map((label) => (
                      <span key={label} className="equipment-pill">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {exercise?.category ? (
                <div>
                  <div className="template-meta">Category</div>
                  <div>{exercise.category}</div>
                </div>
              ) : null}
              {exercise?.pattern ? (
                <div>
                  <div className="template-meta">Pattern</div>
                  <div>{exercise.pattern}</div>
                </div>
              ) : null}
              <div className="template-meta">
                Available at {availableGyms.length} gyms
                {activeSpace ? ` · Active: ${activeSpace.name ?? "Gym"}` : ""}
              </div>
            </div>
          </div>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open(youtubeUrl, "_blank", "noopener,noreferrer")}
            >
              Watch on YouTube
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">How to perform</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {instructionsData.isFallback ? (
            <div className="template-meta">General cues (add custom steps later).</div>
          ) : null}
          <ol className="exercise-steps">
            {instructionsData.steps.map((step, index) => (
              <li key={`${step}-${index}`}>{step}</li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Gotchas</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {gotchasData.isFallback ? (
            <div className="template-meta">Typical pitfalls (customize as needed).</div>
          ) : null}
          <ul className="exercise-mistakes">
            {gotchasData.gotchas.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Progressions & regressions</div>
        </CardHeader>
        <CardBody className="ui-stack">
            <div className="ui-stack">
            <div className="template-meta">Easier</div>
            <LinkedExerciseList
              items={regressions.length ? regressions : fallbackAlternatives}
              emptyLabel="No easier alternatives yet."
              onOpen={onOpenExercise}
            />
          </div>
          <div className="ui-stack">
            <div className="template-meta">Harder</div>
            <LinkedExerciseList
              items={progressions}
              emptyLabel="No harder progressions yet."
              onOpen={onOpenExercise}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">History & stats</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Last performed</div>
              <div className="ui-strong">{formatDate(historyStats.lastPerformed)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Times performed</div>
              <div className="ui-strong">{historyStats.timesPerformed}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Best set</div>
              <div className="ui-strong">
                {formatWeight(historyStats.bestSet?.weight, historyStats.bestSet?.reps)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Estimated 1RM</div>
              <div className="ui-strong">
                {historyStats.bestOneRm != null
                  ? formatNumber(historyStats.bestOneRm)
                  : "N/A"}
              </div>
              <div className="template-meta">Epley formula</div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <div className="template-meta">Volume over time</div>
              <MiniLineChart data={volumeSeries} />
            </div>
            <div className="chart-card">
              <div className="template-meta">
                {maxWeightSeries.length ? "Max weight" : "Max reps"} over time
              </div>
              <MiniLineChart
                data={maxWeightSeries.length ? maxWeightSeries : buildSeries(history ?? [], "maxReps")}
              />
            </div>
            <div className="chart-card">
              <div className="template-meta">Estimated 1RM</div>
              <MiniLineChart data={oneRmSeries} />
            </div>
          </div>

          <div className="ui-stack">
            <div className="template-meta">Recent history</div>
            {historyStats.timesPerformed ? (
              <div className="history-list">
                {(history ?? []).slice(0, 6).map((entry) => (
                  <div key={entry.workoutId} className="history-row">
                    <div className="ui-strong">{formatDate(entry.date)}</div>
                    <div className="template-meta">
                      Volume {formatNumber(entry.volume)} · Best {formatWeight(entry.bestSet?.weight, entry.bestSet?.reps)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="template-meta">{usageNote}</div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Where can I do this?</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {activeSpace && activeGymMissing.length ? (
            <div className="space-warning">
              Not available at {activeSpace.name ?? "active gym"}. Missing: {activeGymMissing
                .map((item) => item?.name ?? "equipment")
                .join(", ")}
              .
            </div>
          ) : null}
          {activeSpace && substitutionHints.length ? (
            <div className="template-meta">
              Suggested substitutions: {substitutionHints
                .slice(0, 3)
                .map((item) => item.name)
                .join(", ")}.
            </div>
          ) : null}
          {gymAvailability.length ? (
            <div className="ui-stack">
              {availableGyms.map((entry) => (
                <div key={entry.space?.id} className="ui-row ui-row--between">
                  <div>
                    <div className="ui-strong">{entry.space?.name ?? "Gym"}</div>
                    <div className="template-meta">All required equipment available.</div>
                  </div>
                  {activeSpace?.id === entry.space?.id ? (
                    <span className="pill">Active</span>
                  ) : null}
                </div>
              ))}
              {unavailableGyms.map((entry) => (
                <div key={entry.space?.id} className="ui-row ui-row--between">
                  <div>
                    <div className="ui-strong">{entry.space?.name ?? "Gym"}</div>
                    <div className="template-meta">
                      Missing: {entry.missingEquipment
                        .map((item) => item?.name ?? "equipment")
                        .join(", ")}
                    </div>
                  </div>
                  {activeSpace?.id === entry.space?.id ? (
                    <span className="pill pill--muted">Active</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="template-meta">No gyms saved yet.</div>
          )}
        </CardBody>
        <CardFooter className="ui-row ui-row--wrap">
          {onLaunchCoach ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onLaunchCoach({
                  source: "exercise_detail",
                  exerciseId: exercise.id,
                  exerciseName: exercise.name ?? "Exercise",
                })
              }
            >
              Ask Coach about this exercise
            </Button>
          ) : null}
          {onAddExercise ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onAddExercise(exercise.id)}
            >
              Add to workout
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </div>
  );
}
