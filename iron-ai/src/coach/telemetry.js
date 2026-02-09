import { db } from "../db";

export const COACH_PAYLOAD_META_KEYS = {
  lastBuiltAt: "coach.payload.lastBuiltAt",
  lastFingerprint: "coach.payload.lastFingerprint",
  counts: "coach.payload.counts",
};

const COACH_LOG_TYPE = "coach_payload";

export async function recordCoachPayloadTelemetry({
  fingerprint,
  contract,
  builtAt = Date.now(),
} = {}) {
  if (!fingerprint) return;
  const logEntry = {
    date: builtAt,
    type: COACH_LOG_TYPE,
    fingerprint,
    contextBytes: fingerprint.contextBytes ?? null,
    contractVersion: contract?.version ?? null,
  };

  try {
    await db.table("logs").add(logEntry);
  } catch (error) {
    console.warn("Unable to log coach payload.", error);
  }

  try {
    await db.table("meta").bulkPut([
      { key: COACH_PAYLOAD_META_KEYS.lastBuiltAt, value: builtAt },
      { key: COACH_PAYLOAD_META_KEYS.lastFingerprint, value: fingerprint },
      { key: COACH_PAYLOAD_META_KEYS.counts, value: contract ?? null },
    ]);
  } catch (error) {
    console.warn("Unable to store coach payload diagnostics.", error);
  }
}
