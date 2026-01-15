import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../db";
import { COACH_PAYLOAD_META_KEYS } from "../../coach/telemetry";
import { SEED_VERSION } from "../../seed/seedConstants";
import { Button, Card, CardBody, CardFooter, PageHeader } from "../../components/ui";

const META_KEYS = [
  "seed.lastSeedAt",
  "seed.version",
  "seed.lastSeedStatus",
  "seed.lastSeedMessage",
  "migration.version",
  "migration.lastMigrationAt",
  COACH_PAYLOAD_META_KEYS.lastBuiltAt,
  COACH_PAYLOAD_META_KEYS.lastFingerprint,
  COACH_PAYLOAD_META_KEYS.counts,
];

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function useMetaSnapshot() {
  const items = useLiveQuery(
    () => db.table("meta").where("key").anyOf(META_KEYS).toArray(),
    []
  );

  return useMemo(() => {
    const map = new Map((items ?? []).map((item) => [item.key, item.value]));
    return {
      seedVersion: map.get("seed.version") ?? null,
      seedLastSeedAt: map.get("seed.lastSeedAt") ?? null,
      seedLastStatus: map.get("seed.lastSeedStatus") ?? null,
      seedLastMessage: map.get("seed.lastSeedMessage") ?? null,
      migrationVersion: map.get("migration.version") ?? null,
      migrationLastAt: map.get("migration.lastMigrationAt") ?? null,
      coachPayloadBuiltAt: map.get(COACH_PAYLOAD_META_KEYS.lastBuiltAt) ?? null,
      coachPayloadFingerprint: map.get(COACH_PAYLOAD_META_KEYS.lastFingerprint) ?? null,
      coachPayloadCounts: map.get(COACH_PAYLOAD_META_KEYS.counts) ?? null,
    };
  }, [items]);
}

function buildIntegritySummary(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
}

export default function DiagnosticsHub({ onBack }) {
  const meta = useMetaSnapshot();
  const gymCount = useLiveQuery(() => db.table("workoutSpaces").count(), []);
  const equipmentCount = useLiveQuery(() => db.table("equipment").count(), []);
  const exerciseCount = useLiveQuery(() => db.table("exercises").count(), []);
  const customExerciseCount = useLiveQuery(
    () =>
      db
        .table("exercises")
        .filter((ex) => ex?.is_custom || ex?.source === "user")
        .count(),
    []
  );
  const templateCount = useLiveQuery(() => db.table("templates").count(), []);
  const workoutCount = useLiveQuery(() => db.table("workoutSessions").count(), []);
  const coachSessionCount = useLiveQuery(() => db.table("logs").count(), []);

  const [integrityReport, setIntegrityReport] = useState(null);
  const [integrityStatus, setIntegrityStatus] = useState("idle");
  const [copyState, setCopyState] = useState(null);

  const libraryExerciseCount = useMemo(() => {
    if (exerciseCount == null || customExerciseCount == null) return null;
    return Math.max(0, exerciseCount - customExerciseCount);
  }, [exerciseCount, customExerciseCount]);
  const coachPayloadCounts = meta.coachPayloadCounts ?? null;
  const coachPayloadFingerprint = meta.coachPayloadFingerprint ?? null;

  const runIntegrityChecks = useCallback(async () => {
    setIntegrityStatus("running");
    try {
      const [equipment, exercises] = await Promise.all([
        db.table("equipment").toArray(),
        db.table("exercises").toArray(),
      ]);
      const equipmentIds = new Set(equipment.map((item) => item.id));
      let missingLabels = 0;
      let missingEquipmentRefs = 0;

      exercises.forEach((exercise) => {
        const label = String(exercise?.name ?? "").trim();
        if (!label) missingLabels += 1;

        const equipmentRefs = [
          ...(Array.isArray(exercise?.equipment) ? exercise.equipment : []),
          ...(Array.isArray(exercise?.requiredEquipmentIds)
            ? exercise.requiredEquipmentIds
            : []),
          ...(Array.isArray(exercise?.optionalEquipmentIds)
            ? exercise.optionalEquipmentIds
            : []),
        ];
        if (equipmentRefs.length === 0) return;
        const hasMissing = equipmentRefs.some((id) => !equipmentIds.has(id));
        if (hasMissing) missingEquipmentRefs += 1;
      });

      const checks = [
        {
          id: "missing-labels",
          label: "Missing exercise labels",
          count: missingLabels,
          status: missingLabels > 0 ? "warn" : "pass",
        },
        {
          id: "missing-equipment-refs",
          label: "Missing equipment refs",
          count: missingEquipmentRefs,
          status: missingEquipmentRefs > 0 ? "warn" : "pass",
        },
      ];

      const report = {
        ranAt: Date.now(),
        checks,
        summary: buildIntegritySummary(checks),
      };

      setIntegrityReport(report);
      return report;
    } finally {
      setIntegrityStatus("idle");
    }
  }, []);

  useEffect(() => {
    void runIntegrityChecks();
  }, [runIntegrityChecks]);

  const commitHash =
    import.meta.env.VITE_COMMIT_SHA ?? import.meta.env.VITE_GIT_SHA ?? null;
  const appVersion = import.meta.env.VITE_APP_VERSION ?? null;

  const diagnosticsReport = useMemo(
    () => ({
      generatedAt: Date.now(),
      app: {
        version: appVersion,
        seedVersion: SEED_VERSION,
        buildHash: commitHash,
        mode: import.meta.env.MODE,
      },
      database: {
        schemaVersion: db.verno,
        migrationVersion: meta.migrationVersion,
        lastMigrationAt: meta.migrationLastAt,
        lastSeedAt: meta.seedLastSeedAt,
      },
      counts: {
        gyms: gymCount,
        equipment: equipmentCount,
        exercises: {
          total: exerciseCount,
          library: libraryExerciseCount,
          custom: customExerciseCount,
        },
        templates: templateCount,
        workouts: workoutCount,
        coachSessions: coachSessionCount,
      },
      coach: {
        payload: {
          lastBuiltAt: meta.coachPayloadBuiltAt,
          fingerprint: meta.coachPayloadFingerprint,
          counts: meta.coachPayloadCounts,
        },
      },
      seed: {
        version: meta.seedVersion,
        lastStatus: meta.seedLastStatus,
        lastMessage: meta.seedLastMessage,
      },
      integrity: integrityReport,
    }),
    [
      appVersion,
      commitHash,
      coachSessionCount,
      customExerciseCount,
      equipmentCount,
      exerciseCount,
      gymCount,
      integrityReport,
      libraryExerciseCount,
      meta.coachPayloadBuiltAt,
      meta.coachPayloadCounts,
      meta.coachPayloadFingerprint,
      meta.migrationLastAt,
      meta.migrationVersion,
      meta.seedLastMessage,
      meta.seedLastSeedAt,
      meta.seedLastStatus,
      meta.seedVersion,
      templateCount,
      workoutCount,
    ]
  );

  const handleCopyReport = useCallback(async () => {
    try {
      const payload = JSON.stringify(diagnosticsReport, null, 2);
      await navigator.clipboard.writeText(payload);
      setCopyState("Copied to clipboard.");
    } catch (error) {
      console.error("Failed to copy diagnostics report.", error);
      setCopyState("Copy failed. Check clipboard permissions.");
    }
    window.setTimeout(() => setCopyState(null), 2500);
  }, [diagnosticsReport]);

  const integritySummary = integrityReport?.summary ?? { pass: 0, warn: 0, fail: 0 };

  return (
    <div className="page">
      <PageHeader
        title="Diagnostics"
        subtitle="Local diagnostics for troubleshooting and support."
        actions={
          onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null
        }
      />

      <div className="library-grid">
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">App</div>
            <div className="template-meta">Version: {appVersion ?? "—"}</div>
            <div className="template-meta">Build hash: {commitHash ?? "—"}</div>
            <div className="template-meta">Seed version: {SEED_VERSION}</div>
            <div className="template-meta">Mode: {import.meta.env.MODE}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Database</div>
            <div className="template-meta">Schema version: {db.verno}</div>
            <div className="template-meta">
              Migration version: {meta.migrationVersion ?? "—"}
            </div>
            <div className="template-meta">
              Last migration: {formatTimestamp(meta.migrationLastAt)}
            </div>
            <div className="template-meta">
              Last seed/import: {formatTimestamp(meta.seedLastSeedAt)}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Counts</div>
            <div className="template-meta">Gyms: {gymCount ?? "—"}</div>
            <div className="template-meta">Equipment: {equipmentCount ?? "—"}</div>
            <div className="template-meta">Exercises: {exerciseCount ?? "—"}</div>
            <div className="template-meta">
              Library exercises: {libraryExerciseCount ?? "—"}
            </div>
            <div className="template-meta">
              Custom exercises: {customExerciseCount ?? "—"}
            </div>
            <div className="template-meta">Templates: {templateCount ?? "—"}</div>
            <div className="template-meta">Workouts: {workoutCount ?? "—"}</div>
            <div className="template-meta">
              Coach sessions: {coachSessionCount ?? "—"}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Coach payload</div>
            <div className="template-meta">
              Last build: {formatTimestamp(meta.coachPayloadBuiltAt)}
            </div>
            <div className="template-meta">
              Fingerprint: {coachPayloadFingerprint?.hash ?? "—"}
            </div>
            <div className="template-meta">
              Context bytes: {coachPayloadFingerprint?.contextBytes ?? "—"}
            </div>
            <div className="template-meta">
              Gym: {coachPayloadCounts?.activeGymName ?? "—"}
            </div>
            <div className="template-meta">
              Equipment: {coachPayloadCounts?.equipmentCount ?? "—"}
            </div>
            <div className="template-meta">
              Recent workouts: {coachPayloadCounts?.recentWorkoutsCount ?? "—"}
            </div>
            <div className="template-meta">
              Last workout: {formatTimestamp(coachPayloadCounts?.lastWorkoutDate)}
            </div>
            <div className="template-meta">
              Templates: {coachPayloadCounts?.templatesCount ?? "—"}
            </div>
            <div className="template-meta">
              Custom exercises: {coachPayloadCounts?.customExercisesCount ?? "—"}
            </div>
            <div className="template-meta">
              Library exercises: {coachPayloadCounts?.exerciseLibraryCount ?? "—"}
            </div>
            <div className="template-meta">
              Build ms: {coachPayloadCounts?.buildMs ?? "—"}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Seed status</div>
          <div className="template-meta">Version: {meta.seedVersion ?? "—"}</div>
          <div className="template-meta">Last status: {meta.seedLastStatus ?? "—"}</div>
          <div className="template-meta">Last message: {meta.seedLastMessage ?? "—"}</div>
          <div className="template-meta">
            Last run: {formatTimestamp(meta.seedLastSeedAt)}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="ui-stack">
          <div className="ui-section-title">Integrity checks</div>
          <div className="template-meta">
            Summary: {integritySummary.pass} pass · {integritySummary.warn} warn ·{" "}
            {integritySummary.fail} fail
          </div>
          <div className="template-meta">
            Last run: {formatTimestamp(integrityReport?.ranAt)}
          </div>
          <div className="ui-stack diagnostics-checks">
            {(integrityReport?.checks ?? []).map((check) => (
              <div key={check.id} className="diagnostics-check">
                <div className={`diagnostics-check__status is-${check.status}`}>
                  {check.status.toUpperCase()}
                </div>
                <div className="diagnostics-check__label">{check.label}</div>
                <div className="diagnostics-check__count">{check.count}</div>
              </div>
            ))}
          </div>
        </CardBody>
        <CardFooter className="ui-row ui-row--wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={runIntegrityChecks}
            disabled={integrityStatus === "running"}
          >
            {integrityStatus === "running"
              ? "Running integrity checks…"
              : "Run integrity checks now"}
          </Button>
          <Button variant="primary" size="sm" onClick={handleCopyReport}>
            Copy diagnostics report
          </Button>
          {copyState ? <div className="template-meta">{copyState}</div> : null}
        </CardFooter>
      </Card>

      <div className="diagnostics-footer">Diagnostics are local and safe to share.</div>
    </div>
  );
}
