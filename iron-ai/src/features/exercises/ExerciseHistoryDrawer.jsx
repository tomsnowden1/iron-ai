import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { BottomSheet } from "../../components/ui";
import { db } from "../../db";
import { computeBestSet, computeTrendPoints, getExerciseHistory } from "../../exercises/derived";

function formatDateLabel(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSetSummary(bestSet) {
  if (!bestSet) return "No logged sets";
  const weight = bestSet.weight ?? null;
  const reps = bestSet.reps ?? null;
  if (weight == null && reps == null) return "No logged sets";
  if (weight == null) return `${reps} reps`;
  if (reps == null) return `${weight}`;
  return `${weight}×${reps}`;
}

function Sparkline({ points }) {
  const width = 160;
  const height = 48;
  const safePoints = Array.isArray(points) ? points : [];
  if (safePoints.length < 2) {
    return <div className="history-drawer__empty">Not enough data yet.</div>;
  }

  const min = Math.min(...safePoints);
  const max = Math.max(...safePoints);
  const range = max - min || 1;
  const step = width / (safePoints.length - 1);
  const values = safePoints.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });
  const path = values
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <svg className="history-drawer__sparkline" viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      {values.map((point) => (
        <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="2" />
      ))}
    </svg>
  );
}

export default function ExerciseHistoryDrawer({
  open,
  exerciseId,
  exerciseName,
  stickyNote,
  onClose,
}) {
  const history = useLiveQuery(
    () => {
      if (!open || !exerciseId) return null;
      return getExerciseHistory(exerciseId, { limit: 10 });
    },
    [open, exerciseId]
  );
  const exercise = useLiveQuery(
    () => {
      if (!open || !exerciseId) return null;
      return db.table("exercises").get(exerciseId);
    },
    [open, exerciseId]
  );

  const resolvedName =
    exerciseName ?? exercise?.name ?? (exerciseId ? "Exercise history" : "History");
  const resolvedSticky = stickyNote ?? exercise?.stickyNote ?? "";
  const recent = Array.isArray(history) ? history.slice(0, 5) : [];
  const best = useMemo(() => computeBestSet(history ?? []), [history]);
  const trendPoints = useMemo(
    () => computeTrendPoints(history ?? [], { limit: 8 }),
    [history]
  );
  const isLoading = open && history == null;

  return (
    <BottomSheet open={open} onClose={onClose} title={resolvedName} ariaLabel="Exercise history">
      <div className="history-drawer">
        <div className="history-drawer__section">
          <div className="history-drawer__section-title">Recent</div>
          {isLoading ? (
            <div className="history-drawer__empty">Loading…</div>
          ) : recent.length ? (
            <div className="history-drawer__list">
              {recent.map((entry) => (
                <div key={entry.workoutId} className="history-drawer__row">
                  <div className="history-drawer__date">{formatDateLabel(entry.date)}</div>
                  <div className="history-drawer__summary">
                    {formatSetSummary(entry.bestSet)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-drawer__empty">No history yet.</div>
          )}
        </div>

        <div className="history-drawer__section">
          <div className="history-drawer__section-title">Best</div>
          {isLoading ? (
            <div className="history-drawer__empty">Loading…</div>
          ) : best ? (
            <div className="history-drawer__best">
              <div className="history-drawer__best-value">
                {formatSetSummary(best)}
              </div>
              <div className="history-drawer__best-meta">
                {best.date ? `PR on ${formatDateLabel(best.date)}` : "Personal best"}
              </div>
            </div>
          ) : (
            <div className="history-drawer__empty">No personal best yet.</div>
          )}
        </div>

        <div className="history-drawer__section">
          <div className="history-drawer__section-title">Trend</div>
          {isLoading ? (
            <div className="history-drawer__empty">Loading…</div>
          ) : (
            <Sparkline points={trendPoints} />
          )}
          <div className="history-drawer__caption">Trend uses volume or best set.</div>
        </div>

        <div className="history-drawer__section">
          <div className="history-drawer__section-title">Notes</div>
          {resolvedSticky ? (
            <div className="history-drawer__note">{resolvedSticky}</div>
          ) : (
            <div className="history-drawer__empty">No notes yet.</div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
