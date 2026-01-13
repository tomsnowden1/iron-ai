import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../db";
import {
  importExercises,
  SEED_MIN_COUNT,
  SEED_VERSION,
  STARTER_MIN_COUNT,
} from "../../seed/exerciseSeed";
import { Button, Card, CardBody, Input, Label, PageHeader } from "../../components/ui";

const META_KEYS = [
  "seed.version",
  "seed.hash",
  "seed.lastSeedAt",
  "seed.lastSeedStatus",
  "seed.lastSeedMessage",
  "seed.lastSeedStats",
  "seed.lastValidationReport",
  "seed.auditLog",
  "seed.lastSourceUsed",
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
      seedHash: map.get("seed.hash") ?? null,
      lastSeedAt: map.get("seed.lastSeedAt") ?? null,
      lastSeedStatus: map.get("seed.lastSeedStatus") ?? null,
      lastSeedMessage: map.get("seed.lastSeedMessage") ?? null,
      lastSeedStats: map.get("seed.lastSeedStats") ?? null,
      lastValidationReport: map.get("seed.lastValidationReport") ?? null,
      auditLog: map.get("seed.auditLog") ?? [],
      lastSourceUsed: map.get("seed.lastSourceUsed") ?? null,
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
  const [progress, setProgress] = useState({ stage: "idle", startedAt: null });
  const [dryRunResult, setDryRunResult] = useState(null);
  const [dryRunError, setDryRunError] = useState(null);
  const [resetText, setResetText] = useState("");

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

  const handleReset = useCallback(async () => {
    if (resetText.trim() !== "RESET") return;
    const confirmReset = window.confirm(
      "This will delete all local data (including workouts). Continue?"
    );
    if (!confirmReset) return;
    await db.delete();
    window.location.reload();
  }, [resetText]);

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
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed status</div>
          <div className="template-meta">Version: {meta.seedVersion ?? "—"}</div>
          <div className="template-meta">Hash: {meta.seedHash ?? "—"}</div>
          <div className="template-meta">Last status: {meta.lastSeedStatus ?? "—"}</div>
          <div className="template-meta">Last message: {meta.lastSeedMessage ?? "—"}</div>
          <div className="template-meta">Last source: {meta.lastSourceUsed ?? "—"}</div>
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
                [{new Date(entry.timestamp ?? Date.now()).toLocaleString()}] {entry.status} - {entry.message}
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
