import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../db";
import { importExercises, SEED_DATA_VERSION } from "../../seed/exerciseSeed";
import { getExercisePrimaryMuscles } from "../../exercises/data";
import { Button, Card, CardBody } from "../../components/ui";

const META_KEYS = [
  "seed.version",
  "seed.lastSeedAt",
  "seed.lastSeedStats",
  "seed.lastImportMs",
];

function useSeedMeta() {
  const items = useLiveQuery(
    () => db.table("meta").where("key").anyOf(META_KEYS).toArray(),
    []
  );
  return useMemo(() => {
    const map = new Map((items ?? []).map((item) => [item.key, item.value]));
    return {
      seedVersion: map.get("seed.version") ?? null,
      lastSeedAt: map.get("seed.lastSeedAt") ?? null,
      lastSeedStats: map.get("seed.lastSeedStats") ?? null,
      lastImportMs: map.get("seed.lastImportMs") ?? null,
    };
  }, [items]);
}

export default function SeedDebugMiniPanel() {
  const meta = useSeedMeta();
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);
  const instructionsCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => Array.isArray(ex.instructions) && ex.instructions.length > 0)
        .count(),
    []
  );
  const equipmentCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => Array.isArray(ex.equipment) && ex.equipment.length > 0)
        .count(),
    []
  );
  const primaryMusclesCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => getExercisePrimaryMuscles(ex).length > 0)
        .count(),
    []
  );

  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const handleReseed = useCallback(async () => {
    setIsRunning(true);
    const result = await importExercises({ dryRun: false });
    setLastResult(result);
    setIsRunning(false);
  }, []);

  const lastStats = meta.lastSeedStats ?? {};
  const seedVersionStored = meta.seedVersion ?? "—";
  const seededAt = meta.lastSeedAt
    ? new Date(meta.lastSeedAt).toLocaleString()
    : "—";
  const lastImportMs = meta.lastImportMs ?? lastStats.importMs ?? "—";

  return (
    <div
      style={{
        position: "fixed",
        right: "1rem",
        bottom: "4.5rem",
        zIndex: 30,
        width: "min(360px, 92vw)",
      }}
    >
      <Card>
        <CardBody className="ui-stack">
          <div className="ui-strong">Seed debug</div>
          <div className="template-meta">
            Version: {SEED_DATA_VERSION} (stored {seedVersionStored})
          </div>
          <div className="template-meta">Seeded at: {seededAt}</div>
          <div className="template-meta">Total exercises: {exerciseCount ?? "—"}</div>
          <div className="template-meta">
            With instructions: {instructionsCount ?? "—"}
          </div>
          <div className="template-meta">With equipment: {equipmentCount ?? "—"}</div>
          <div className="template-meta">
            With primary muscles: {primaryMusclesCount ?? "—"}
          </div>
          <div className="template-meta">Last import ms: {lastImportMs}</div>
          <div className="template-meta">
            Last inserted: {lastStats.inserted ?? "—"} · Updated: {lastStats.updated ?? "—"}
          </div>
          <div className="ui-row ui-row--wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReseed}
              disabled={isRunning}
            >
              {isRunning ? "Re-seeding..." : "Re-seed now"}
            </Button>
          </div>
          {lastResult?.status === "error" ? (
            <div className="template-meta">Last run error: {lastResult.error}</div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
