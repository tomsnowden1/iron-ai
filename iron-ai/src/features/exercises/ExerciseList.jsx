import { Info } from "lucide-react";

import { Button } from "../../components/ui";
import { getEquipmentMap } from "../../equipment/catalog";
import { getMissingEquipmentForExercise } from "../../equipment/engine";
import {
  formatEquipmentLabels,
  getExercisePrimaryMuscles,
  getNormalizedEquipment,
} from "../../exercises/data";

function formatAvailability(exercise, activeSpace, equipmentMap) {
  if (!activeSpace) return null;
  const missing = getMissingEquipmentForExercise(
    exercise,
    activeSpace.equipmentIds ?? [],
    equipmentMap
  );
  if (!missing.length) {
    return { label: "Available", tone: "pill" };
  }
  const label = missing.length === 1 ? "Missing 1" : `Missing ${missing.length}`;
  return { label, tone: "pill pill--muted" };
}

function EquipmentPills({ equipmentIds, equipmentMap }) {
  if (!equipmentIds.length) return null;
  const labels = formatEquipmentLabels(equipmentIds, equipmentMap);
  if (!labels.length) return null;
  const preview = labels.slice(0, 3);
  const remainder = labels.length - preview.length;

  return (
    <div className="exercise-row__equipment">
      {preview.map((label) => (
        <span key={label} className="pill pill--muted">
          {label}
        </span>
      ))}
      {remainder > 0 ? (
        <span className="pill pill--muted">+{remainder}</span>
      ) : null}
    </div>
  );
}

export default function ExerciseList({
  exercises,
  equipmentList,
  activeSpace,
  onSelect,
  onInfo,
  emptyLabel,
}) {
  const equipmentMap =
    equipmentList instanceof Map ? equipmentList : getEquipmentMap(equipmentList ?? []);

  if (!exercises.length) {
    return <div className="empty-state">{emptyLabel ?? "No exercises match."}</div>;
  }

  return (
    <div className="exercise-list">
      {exercises.map((exercise) => {
        const primaryMuscles = getExercisePrimaryMuscles(exercise);
        const { requiredEquipmentIds } = getNormalizedEquipment(exercise);
        const availability = formatAvailability(exercise, activeSpace, equipmentMap);

        return (
          <div key={exercise.id} className="exercise-row">
            <button
              type="button"
              className="exercise-row__button"
              onClick={() => onSelect?.(exercise)}
            >
              <div className="exercise-row__main">
                <div className="exercise-row__title">
                  {exercise.name ?? "Unknown Exercise"}
                </div>
                {primaryMuscles.length ? (
                  <div className="exercise-row__meta">
                    {primaryMuscles.join(", ")}
                  </div>
                ) : null}
                <EquipmentPills
                  equipmentIds={requiredEquipmentIds}
                  equipmentMap={equipmentMap}
                />
              </div>
              {availability ? (
                <span className={availability.tone}>{availability.label}</span>
              ) : null}
            </button>
            {onInfo ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => onInfo(exercise)}
                className="exercise-row__info"
                aria-label={`View details for ${exercise.name ?? "exercise"}`}
              >
                <Info size={16} />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
