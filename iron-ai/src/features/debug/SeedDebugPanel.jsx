import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../db";
import {
  importExercises,
  recomputeExerciseLinks,
  getSeedSamples,
  loadSeedPayload,
  repairSeededExercises,
  SEED_MIN_COUNT,
  SEED_VERSION,
  SEED_VERSION_NUMBER,
  STARTER_MIN_COUNT,
} from "../../seed/exerciseSeed";
import { getExercisePrimaryMuscles } from "../../exercises/data";
import { computeStableId, normalizeString, slugify } from "../../seed/seedUtils";
import { normalizeSeedRecord } from "../../seed/seedValidation";
import { Button, Card, CardBody, Input, Label, PageHeader } from "../../components/ui";

const META_KEYS = [
  "seed.version",
  "seed.versionNumber",
  "seed.hash",
  "seed.lastSeedAt",
  "seed.lastSeedStatus",
  "seed.lastSeedMessage",
  "seed.lastSeedStats",
  "seed.lastValidationReport",
  "seed.lastImportReport",
  "seed.auditLog",
  "seed.lastSourceUsed",
  "seed.lastRepairAt",
  "seed.lastRepairStatus",
  "seed.lastRepairMessage",
  "seed.lastRepairStats",
  "seed.lastLinkerAt",
  "seed.lastLinkerStats",
  "seed.repair.lastRunAt",
  "seed.repair.updatedCount",
  "seed.repair.placeholderClearedCount",
  "seed.repair.sampleUpdatedIds",
  "seed.repair.seedHash",
  "seed.repair.version",
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
      seedVersionNumber: map.get("seed.versionNumber") ?? null,
      seedHash: map.get("seed.hash") ?? null,
      lastSeedAt: map.get("seed.lastSeedAt") ?? null,
      lastSeedStatus: map.get("seed.lastSeedStatus") ?? null,
      lastSeedMessage: map.get("seed.lastSeedMessage") ?? null,
      lastSeedStats: map.get("seed.lastSeedStats") ?? null,
      lastValidationReport: map.get("seed.lastValidationReport") ?? null,
      lastImportReport: map.get("seed.lastImportReport") ?? null,
      auditLog: map.get("seed.auditLog") ?? [],
      lastSourceUsed: map.get("seed.lastSourceUsed") ?? null,
      lastRepairAt: map.get("seed.lastRepairAt") ?? null,
      lastRepairStatus: map.get("seed.lastRepairStatus") ?? null,
      lastRepairMessage: map.get("seed.lastRepairMessage") ?? null,
      lastRepairStats: map.get("seed.lastRepairStats") ?? null,
      lastLinkerAt: map.get("seed.lastLinkerAt") ?? null,
      lastLinkerStats: map.get("seed.lastLinkerStats") ?? null,
      repairLastRunAt: map.get("seed.repair.lastRunAt") ?? null,
      repairUpdatedCount: map.get("seed.repair.updatedCount") ?? null,
      repairPlaceholderClearedCount: map.get("seed.repair.placeholderClearedCount") ?? null,
      repairSampleUpdatedIds: map.get("seed.repair.sampleUpdatedIds") ?? [],
      repairSeedHash: map.get("seed.repair.seedHash") ?? null,
      repairVersion: map.get("seed.repair.version") ?? null,
    };
  }, [items]);
}

export default function SeedDebugPanel({ onBack }) {
  const meta = useSeedMeta();
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);
  const seededCount = useLiveQuery(
    () => db.table("exercises").where("stableId").above("").count(),
    []
  );
  const customCount = useLiveQuery(
    () => db.table("exercises").filter((ex) => ex.is_custom).count(),
    []
  );
  const missingInstructionsCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => !(Array.isArray(ex.instructions) && ex.instructions.length))
        .count(),
    []
  );
  const missingEquipmentCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => !(Array.isArray(ex.equipment) && ex.equipment.length))
        .count(),
    []
  );
  const missingPrimaryMusclesCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => getExercisePrimaryMuscles(ex).length === 0)
        .count(),
    []
  );
  const [progress, setProgress] = useState({ stage: "idle", startedAt: null });
  const [dryRunResult, setDryRunResult] = useState(null);
  const [dryRunError, setDryRunError] = useState(null);
  const [repairProgress, setRepairProgress] = useState({ stage: "idle", startedAt: null });
  const [repairResult, setRepairResult] = useState(null);
  const [repairError, setRepairError] = useState(null);
  const [linkerResult, setLinkerResult] = useState(null);
  const [linkerError, setLinkerError] = useState(null);
  const [resetText, setResetText] = useState("");
  const [seedSample, setSeedSample] = useState(null);
  const [seedSampleError, setSeedSampleError] = useState(null);
  const [mismatchSample, setMismatchSample] = useState([]);
  const [mismatchError, setMismatchError] = useState(null);
  const [equipmentCreateResult, setEquipmentCreateResult] = useState(null);
  const [equipmentCreateError, setEquipmentCreateError] = useState(null);

  const runImport = useCallback(
    async ({ dryRun = false, onlyIfChanged = false } = {}) => {
      setDryRunError(null);
      setDryRunResult(null);
      setProgress({ stage: "starting", startedAt: Date.now() });
      const result = await importExercises({
        dryRun,
        onlyIfChanged,
        onProgress: (next) => setProgress(next),
      });
      if (dryRun) {
        if (result.status === "error") {
          setDryRunError(result.error ?? "Dry run failed.");
        } else {
          setDryRunResult(result);
        }
      }
      setProgress((prev) => ({ ...prev, stage: "done" }));
      return result;
    },
    []
  );

  const runRepair = useCallback(async ({ dryRun = false, force = false } = {}) => {
    setRepairError(null);
    setRepairResult(null);
    setRepairProgress({ stage: "starting", startedAt: Date.now() });
    const result = await repairSeededExercises({
      dryRun,
      force,
      onProgress: (next) => setRepairProgress(next),
    });
    if (result.status === "error") {
      setRepairError(result.error ?? "Repair failed.");
    } else {
      setRepairResult(result);
    }
    setRepairProgress((prev) => ({ ...prev, stage: "done" }));
    return result;
  }, []);

  const runLinker = useCallback(async ({ dryRun = false } = {}) => {
    setLinkerError(null);
    setLinkerResult(null);
    const result = await recomputeExerciseLinks({ dryRun });
    if (result.status === "error") {
      setLinkerError(result.error ?? "Linker failed.");
    } else {
      setLinkerResult(result);
    }
    return result;
  }, []);

  const handleReset = useCallback(async () => {
    if (resetText.trim() !== "RESET") return;
    const confirmReset = window.confirm(
      "This will delete all local data (including workouts). Continue?"
    );
    if (!confirmReset) return;
    await db.delete();
    window.location.reload();
  }, [resetText]);

  const handleLoadSeedSample = useCallback(async () => {
    setSeedSampleError(null);
    setSeedSample(null);
    const result = await getSeedSamples({ limit: 1 });
    if (result.status !== "success") {
      setSeedSampleError(result.error ?? "Unable to load seed sample.");
      return;
    }
    setSeedSample(result);
  }, []);

  const handleLoadMismatches = useCallback(async () => {
    setMismatchError(null);
    setMismatchSample([]);
    const payloadResult = await loadSeedPayload();
    if (payloadResult.status !== "success") {
      setMismatchError(payloadResult.error ?? "Unable to load seed payload.");
      return;
    }
    const exercises = await db.table("exercises").toArray();
    const bySourceKey = new Map(
      exercises
        .filter((ex) => ex.sourceKey)
        .map((ex) => [ex.sourceKey, ex])
    );
    const byExternalId = new Map(
      exercises
        .filter((ex) => ex.externalId)
        .map((ex) => [ex.externalId, ex])
    );
    const byStableId = new Map(
      exercises
        .filter((ex) => ex.stableId)
        .map((ex) => [ex.stableId, ex])
    );

    const mismatches = [];
    for (const record of payloadResult.payload) {
      if (mismatches.length >= 5) break;
      const normalized = normalizeSeedRecord(record);
      const stableId = await computeStableId({
        source: normalized.source,
        sourceId: normalized.sourceId ?? normalized.externalId ?? normalized.sourceKey ?? null,
        externalId: normalized.externalId,
        name: normalized.name,
        equipment: normalized.equipment,
        primaryMuscles: normalized.primaryMuscles,
        pattern: normalized.pattern,
        category: normalized.category,
      });
      const cleaned = {
        ...normalized,
        stableId,
        instructions: normalized.instructions ?? [],
        gotchas: normalized.gotchas ?? [],
        commonMistakes: normalized.commonMistakes ?? [],
      };
      const existing =
        (cleaned.externalId ? byExternalId.get(cleaned.externalId) : null) ||
        (cleaned.sourceKey ? bySourceKey.get(cleaned.sourceKey) : null) ||
        (cleaned.stableId ? byStableId.get(cleaned.stableId) : null);
      if (!existing) continue;

      const diffs = [];
      const compareList = (label, a, b) => {
        const left = Array.isArray(a) ? a : [];
        const right = Array.isArray(b) ? b : [];
        if (left.join("|") !== right.join("|")) {
          diffs.push({ field: label, expected: right, actual: left });
        }
      };
      const compareValue = (label, a, b) => {
        const left = a ?? null;
        const right = b ?? null;
        if (left !== right) {
          diffs.push({ field: label, expected: right, actual: left });
        }
      };

      compareList("instructions", existing.instructions, cleaned.instructions);
      compareList("gotchas", existing.gotchas, cleaned.gotchas);
      compareList("primaryMuscles", existing.primaryMuscles, cleaned.primaryMuscles);
      compareList("equipment", existing.equipment, cleaned.equipment);
      compareValue("category", existing.category, cleaned.category);
      compareValue("pattern", existing.pattern, cleaned.pattern);
      if (diffs.length) {
        mismatches.push({
          name: existing.name ?? cleaned.name ?? "Unknown exercise",
          stableId: existing.stableId ?? null,
          diffs,
        });
      }
    }
    setMismatchSample(mismatches);
  }, []);

  const handleCreateMissingEquipment = useCallback(async () => {
    try {
      setEquipmentCreateError(null);
      setEquipmentCreateResult(null);
      const exercises = await db.table("exercises").toArray();
      const equipmentList = await db.table("equipment").toArray();
      const lookup = new Map();
      const idSet = new Set();
      equipmentList.forEach((item) => {
        if (!item?.id) return;
        idSet.add(item.id);
        const idKey = normalizeString(item.id).toLowerCase();
        if (idKey) lookup.set(idKey, item.id);
        const nameKey = normalizeString(item.name).toLowerCase();
        if (nameKey) lookup.set(nameKey, item.id);
        (item.aliases ?? []).forEach((alias) => {
          const aliasKey = normalizeString(alias).toLowerCase();
          if (aliasKey) lookup.set(aliasKey, item.id);
        });
      });

      const toCreate = [];
      exercises.forEach((exercise) => {
        const equipment = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
        equipment.forEach((item) => {
          const normalized = normalizeString(item).toLowerCase();
          if (!normalized) return;
          if (lookup.has(normalized)) return;
          const slug = slugify(normalized) || normalized;
          if (!slug || idSet.has(slug)) return;
          idSet.add(slug);
          lookup.set(normalized, slug);
          toCreate.push({
            id: slug,
            name: normalized
              .split(/\s+/)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" "),
            category: "accessory",
            isPortable: true,
            aliases: [normalized],
          });
        });
      });

      if (!toCreate.length) {
        setEquipmentCreateResult({ created: 0 });
        return;
      }
      await db.table("equipment").bulkPut(toCreate);
      setEquipmentCreateResult({ created: toCreate.length });
    } catch (error) {
      setEquipmentCreateError(error?.message ?? "Failed to create equipment.");
    }
  }, []);

  const lastStats = meta.lastSeedStats ?? null;
  const lastReport = meta.lastValidationReport ?? null;
  const auditLog = Array.isArray(meta.auditLog) ? meta.auditLog : [];
  const showFailureBanner =
    meta.lastSeedStatus === "FAILURE" &&
    (exerciseCount ?? 0) <= STARTER_MIN_COUNT;
  const commitHash =
    import.meta.env.VITE_COMMIT_SHA ?? import.meta.env.VITE_GIT_SHA ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Seed Debug"
        subtitle="Exercise seed diagnostics and controls."
        actions={
          onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null
        }
      />

      {showFailureBanner ? (
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Seeding failed previously.</div>
            <div className="template-meta">{meta.lastSeedMessage ?? "Unknown error."}</div>
          </CardBody>
        </Card>
      ) : null}

      <div className="library-grid">
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Environment</div>
            <div className="template-meta">Mode: {import.meta.env.MODE}</div>
            <div className="template-meta">App version: {SEED_VERSION}</div>
            <div className="template-meta">
              Commit: {commitHash ?? "—"}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Database</div>
            <div className="template-meta">Name: {db.name}</div>
            <div className="template-meta">Version: {db.verno}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Exercise counts</div>
            <div className="template-meta">Total: {exerciseCount ?? "—"}</div>
            <div className="template-meta">Seeded: {seededCount ?? "—"}</div>
            <div className="template-meta">Custom: {customCount ?? "—"}</div>
            <div className="template-meta">
              Missing instructions: {missingInstructionsCount ?? "—"}
            </div>
            <div className="template-meta">
              Missing equipment: {missingEquipmentCount ?? "—"}
            </div>
            <div className="template-meta">
              Missing primary muscles: {missingPrimaryMusclesCount ?? "—"}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed status</div>
          <div className="template-meta">Version: {meta.seedVersion ?? "—"}</div>
          <div className="template-meta">
            Version number: {meta.seedVersionNumber ?? SEED_VERSION_NUMBER}
          </div>
          <div className="template-meta">Hash: {meta.seedHash ?? "—"}</div>
          <div className="template-meta">Last status: {meta.lastSeedStatus ?? "—"}</div>
          <div className="template-meta">Last message: {meta.lastSeedMessage ?? "—"}</div>
          <div className="template-meta">Last source: {meta.lastSourceUsed ?? "—"}</div>
          <div className="template-meta">
            Report: {meta.lastImportReport?.reportPath ?? "—"}
          </div>
          {meta.lastImportReport?.counts ? (
            <div className="template-meta">
              Report summary: {meta.lastImportReport.counts.total ?? 0} total ·{" "}
              {meta.lastImportReport.counts.inserted ?? 0} inserted ·{" "}
              {meta.lastImportReport.counts.updated ?? 0} updated ·{" "}
              {meta.lastImportReport.counts.skipped ?? 0} skipped ·{" "}
              {meta.lastImportReport.counts.invalid ?? 0} invalid ·{" "}
              {meta.lastImportReport.counts.warnings ?? 0} warnings
            </div>
          ) : null}
          <div className="template-meta">Min count: {SEED_MIN_COUNT}</div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Import controls</div>
          <div className="template-meta">Stage: {progress.stage}</div>
          {progress.stage === "importing" ? (
            <div className="template-meta">
              Importing batch {progress.batch ?? 0} / {progress.totalBatches ?? 0}
            </div>
          ) : null}
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={() => runImport({ dryRun: true })}>
              Dry-run validate seed
            </Button>
            <Button variant="primary" size="sm" onClick={() => runImport({})}>
              Import exercises now
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runImport({ onlyIfChanged: true })}
            >
              Re-run only if changed
            </Button>
          </div>
          {dryRunError ? (
            <div className="template-meta">Dry-run error: {dryRunError}</div>
          ) : null}
          {dryRunResult ? (
            <div className="template-meta">
              Dry-run: {dryRunResult.valid ?? 0} valid / {dryRunResult.invalid ?? 0} invalid
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Repair controls</div>
          <div className="template-meta">Stage: {repairProgress.stage}</div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={() => runRepair({ dryRun: true })}>
              Dry-run repair
            </Button>
            <Button variant="primary" size="sm" onClick={() => runRepair({})}>
              Repair seeded exercises
            </Button>
            <Button variant="secondary" size="sm" onClick={() => runRepair({ force: true })}>
              Force repair now
            </Button>
          </div>
          {repairError ? <div className="template-meta">Repair error: {repairError}</div> : null}
          {repairResult && repairResult.status === "dry-run" ? (
            <div className="template-meta">
              Dry-run: {repairResult.totalNormalized ?? 0} normalized records ready to
              repair.
            </div>
          ) : null}
          {repairResult && repairResult.status === "success" ? (
            <div className="template-meta">
              Updated {repairResult.updated ?? 0} exercises (cleared{" "}
              {repairResult.clearedPlaceholders ?? 0} placeholders).
            </div>
          ) : null}
          {repairResult && repairResult.status === "skipped" ? (
            <div className="template-meta">
              Repair skipped (up to date). Seed hash: {repairResult.seedHash ?? "—"}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Linker controls</div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={() => runLinker({ dryRun: true })}>
              Dry-run linker
            </Button>
            <Button variant="primary" size="sm" onClick={() => runLinker({})}>
              Recompute progressions/regressions
            </Button>
          </div>
          {linkerError ? <div className="template-meta">Linker error: {linkerError}</div> : null}
          {linkerResult && linkerResult.status === "dry-run" ? (
            <div className="template-meta">
              Dry-run: would update {linkerResult.updated ?? 0} exercises.
            </div>
          ) : null}
          {linkerResult && linkerResult.status === "success" ? (
            <div className="template-meta">
              Updated {linkerResult.updated ?? 0} exercises.
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Last import stats</div>
          {lastStats ? (
            <div className="ui-stack">
              <div className="template-meta">Total seed: {lastStats.totalSeed ?? 0}</div>
              <div className="template-meta">Inserted: {lastStats.inserted ?? 0}</div>
              <div className="template-meta">Updated: {lastStats.updated ?? 0}</div>
              <div className="template-meta">Skipped: {lastStats.skipped ?? 0}</div>
              <div className="template-meta">
                Duplicates collapsed: {lastStats.duplicatesCollapsed ?? 0}
              </div>
            </div>
          ) : (
            <div className="template-meta">No stats recorded yet.</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Last repair stats</div>
          {meta.lastRepairStats ? (
            <div className="ui-stack">
              <div className="template-meta">Total seed: {meta.lastRepairStats.totalSeed ?? 0}</div>
              <div className="template-meta">Updated: {meta.lastRepairStats.updated ?? 0}</div>
              <div className="template-meta">Skipped: {meta.lastRepairStats.skipped ?? 0}</div>
              <div className="template-meta">
                Cleared placeholders: {meta.lastRepairStats.clearedPlaceholders ?? 0}
              </div>
              <div className="template-meta">Seed hash: {meta.lastRepairStats.seedHash ?? "—"}</div>
              <div className="template-meta">Force: {meta.lastRepairStats.force ? "Yes" : "No"}</div>
              {meta.lastRepairStats.sampleUpdatedIds?.length ? (
                <div className="template-meta">
                  Sample updated IDs: {meta.lastRepairStats.sampleUpdatedIds.join(", ")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="template-meta">No repair stats recorded yet.</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Repair meta</div>
          <div className="template-meta">
            Last run: {meta.repairLastRunAt ? new Date(meta.repairLastRunAt).toLocaleString() : "—"}
          </div>
          <div className="template-meta">Updated count: {meta.repairUpdatedCount ?? "—"}</div>
          <div className="template-meta">
            Placeholder cleared: {meta.repairPlaceholderClearedCount ?? "—"}
          </div>
          <div className="template-meta">Seed hash: {meta.repairSeedHash ?? "—"}</div>
          <div className="template-meta">Repair version: {meta.repairVersion ?? "—"}</div>
          {Array.isArray(meta.repairSampleUpdatedIds) && meta.repairSampleUpdatedIds.length ? (
            <div className="template-meta">
              Sample updated IDs: {meta.repairSampleUpdatedIds.join(", ")}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed sample</div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={handleLoadSeedSample}>
              View seed sample
            </Button>
          </div>
          {seedSampleError ? (
            <div className="template-meta">Seed sample error: {seedSampleError}</div>
          ) : null}
          {seedSample ? (
            <div className="ui-stack">
              <div className="template-meta">
                Source: {seedSample.sourceUsed ?? "—"} · Total: {seedSample.total ?? 0}
              </div>
              <div className="template-meta">
                Keys: {Object.keys(seedSample.sample?.[0] ?? {}).join(", ") || "—"}
              </div>
              <pre className="template-meta">{JSON.stringify(seedSample.sample?.[0] ?? {}, null, 2)}</pre>
              <div className="template-meta">Normalized sample:</div>
              <pre className="template-meta">
                {JSON.stringify(seedSample.normalizedSample?.[0] ?? {}, null, 2)}
              </pre>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed mismatches (5)</div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={handleLoadMismatches}>
              Show 5 mismatches
            </Button>
          </div>
          {mismatchError ? (
            <div className="template-meta">Mismatch error: {mismatchError}</div>
          ) : null}
          {mismatchSample.length ? (
            mismatchSample.map((entry) => (
              <div key={entry.stableId ?? entry.name} className="ui-stack">
                <div className="ui-strong">
                  {entry.name} {entry.stableId ? `(${entry.stableId})` : ""}
                </div>
                {entry.diffs.map((diff) => (
                  <div key={diff.field} className="template-meta">
                    {diff.field}: actual {JSON.stringify(diff.actual)} vs seed{" "}
                    {JSON.stringify(diff.expected)}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="template-meta">No mismatches loaded.</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Equipment repair</div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={handleCreateMissingEquipment}>
              Create missing equipment from exercises
            </Button>
          </div>
          {equipmentCreateError ? (
            <div className="template-meta">Equipment error: {equipmentCreateError}</div>
          ) : null}
          {equipmentCreateResult ? (
            <div className="template-meta">
              Created {equipmentCreateResult.created ?? 0} equipment entries.
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Last linker stats</div>
          {meta.lastLinkerStats ? (
            <div className="ui-stack">
              <div className="template-meta">Updated: {meta.lastLinkerStats.updated ?? 0}</div>
              <div className="template-meta">Skipped: {meta.lastLinkerStats.skipped ?? 0}</div>
              {meta.lastLinkerStats.error ? (
                <div className="template-meta">Error: {meta.lastLinkerStats.error}</div>
              ) : null}
            </div>
          ) : (
            <div className="template-meta">No linker stats recorded yet.</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Validation report</div>
          {lastReport ? (
            <div className="ui-stack">
              <div className="template-meta">Total: {lastReport.total ?? 0}</div>
              <div className="template-meta">Valid: {lastReport.validCount ?? 0}</div>
              <div className="template-meta">Invalid: {lastReport.invalidCount ?? 0}</div>
              {Array.isArray(lastReport.invalidSamples) &&
              lastReport.invalidSamples.length ? (
                <div className="ui-stack">
                  <div className="template-meta">Invalid samples:</div>
                  {lastReport.invalidSamples.map((sample) => (
                    <div key={`${sample.index}-${sample.name}`} className="template-meta">
                      {sample.name ?? "(unnamed)"}: {sample.reasons?.join(", ")}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="template-meta">No validation report yet.</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed audit log</div>
          {auditLog.length ? (
            auditLog.map((entry, index) => (
              <div key={`${entry.timestamp ?? index}`} className="template-meta">
                [{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Unknown time"}]{" "}
                {entry.status} - {entry.message}
              </div>
            ))
          ) : (
            <div className="template-meta">No audit log entries.</div>
          )}
        </CardBody>
      </Card>

      {import.meta.env.DEV ? (
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-section-title">Reset local database</div>
            <div className="template-meta">
              Type RESET to enable. This deletes workouts, settings, and exercises.
            </div>
            <Label htmlFor="seed-reset">Type RESET</Label>
            <Input
              id="seed-reset"
              value={resetText}
              onChange={(event) => setResetText(event.target.value)}
            />
            <Button
              variant="danger"
              size="sm"
              type="button"
              onClick={handleReset}
              disabled={resetText.trim() !== "RESET"}
            >
              Reset DB & Reseed
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
