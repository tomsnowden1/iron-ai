import starterExercises from "../data/starterExercises.json";
import { db } from "../db";
import { inferExerciseEquipment } from "../equipment/inference";
import {
  SEED_MIN_COUNT,
  SEED_VERSION,
  STARTER_MIN_COUNT,
} from "./seedConstants";
import {
  computeSeedHash,
  computeStableId,
  isNonEmptyArray,
  isNonEmptyString,
  normalizeString,
  normalizeStringArray,
  scoreExercise,
  slugify,
} from "./seedUtils";
import { validateSeedPayload } from "./seedValidation";

const META_KEYS = {
  version: "seed.version",
  hash: "seed.hash",
  lastSeedAt: "seed.lastSeedAt",
  lastSeedStatus: "seed.lastSeedStatus",
  lastSeedMessage: "seed.lastSeedMessage",
  lastSeedStats: "seed.lastSeedStats",
  auditLog: "seed.auditLog",
  lastValidationReport: "seed.lastValidationReport",
  lastSourceUsed: "seed.lastSourceUsed",
};

const AUDIT_LOG_LIMIT = 20;

function seedLog(level, message, meta = {}) {
  const logger = console[level] ?? console.info;
  logger(`[seed] ${message}`, meta);
}

async function readMeta(key) {
  const entry = await db.table("meta").get(key);
  return entry?.value ?? null;
}

async function writeMeta(key, value) {
  await db.table("meta").put({ key, value });
}

async function appendAuditLog(entry) {
  const current = (await readMeta(META_KEYS.auditLog)) ?? [];
  const next = [entry, ...current].slice(0, AUDIT_LOG_LIMIT);
  await writeMeta(META_KEYS.auditLog, next);
}

async function getSeedMetaSnapshot() {
  const keys = Object.values(META_KEYS);
  const items = await db.table("meta").where("key").anyOf(keys).toArray();
  const map = new Map(items.map((item) => [item.key, item.value]));
  return {
    seedVersion: map.get(META_KEYS.version) ?? null,
    seedHash: map.get(META_KEYS.hash) ?? null,
    lastSeedAt: map.get(META_KEYS.lastSeedAt) ?? null,
    lastSeedStatus: map.get(META_KEYS.lastSeedStatus) ?? null,
    lastSeedMessage: map.get(META_KEYS.lastSeedMessage) ?? null,
    lastSeedStats: map.get(META_KEYS.lastSeedStats) ?? null,
    lastValidationReport: map.get(META_KEYS.lastValidationReport) ?? null,
    lastSourceUsed: map.get(META_KEYS.lastSourceUsed) ?? null,
    auditLog: map.get(META_KEYS.auditLog) ?? [],
  };
}

async function fetchSeedJson(url, label, retries = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        lastError = {
          code: `HTTP_${response.status}`,
          message: `Seed fetch failed (${label}): ${response.status} ${response.statusText}`,
          status: response.status,
          statusText: response.statusText,
          source: label,
        };
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const warnings = [];
      if (!contentType.includes("json")) {
        warnings.push(`Unexpected content-type for ${label}: ${contentType}`);
      }
      const payload = await response.json();
      return { ok: true, payload, warnings };
    } catch (error) {
      lastError = {
        code: "FETCH_ERROR",
        message: `Seed fetch error (${label}): ${error?.message ?? "Unknown error"}`,
        source: label,
        error,
      };
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  return { ok: false, error: lastError };
}

async function fetchSeedExercises() {
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  const urls = [
    { label: "public", url: new URL(`${baseUrl}seed/exercises.json`, window.location.origin) },
    {
      label: "public-min",
      url: new URL(`${baseUrl}seed/exercises.min.json`, window.location.origin),
    },
  ];

  const errors = [];
  const warnings = [];

  for (const entry of urls) {
    const result = await fetchSeedJson(entry.url.toString(), entry.label);
    if (result.ok) {
      warnings.push(...(result.warnings ?? []));
      return {
        ok: true,
        payload: result.payload,
        sourceUsed: entry.label,
        warnings,
      };
    }
    if (result.error) errors.push(result.error);
  }

  try {
    const bundled = await import("../data/exercisesSeedPayload.js");
    if (bundled?.default) {
      warnings.push("Using bundled seed payload fallback.");
      return {
        ok: true,
        payload: bundled.default,
        sourceUsed: "bundled",
        warnings,
      };
    }
    errors.push({
      code: "BUNDLED_EMPTY",
      message: "Bundled seed payload is empty or missing.",
      source: "bundled",
    });
  } catch (error) {
    errors.push({
      code: "BUNDLED_IMPORT_ERROR",
      message: `Failed to load bundled seed payload: ${error?.message ?? "Unknown"}`,
      source: "bundled",
      error,
    });
  }

  return { ok: false, errors };
}

function mergeSeedExercise(existing, incoming, now) {
  if (existing?.is_custom || existing?.source === "user" || existing?.isCustom) {
    return { merged: existing, changed: false, skipped: true };
  }

  const merged = { ...existing };
  const setIfMissing = (key, value) => {
    if (value == null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && value.trim() === "") return;
    const current = merged[key];
    if (Array.isArray(current)) {
      if (current.length === 0) merged[key] = value;
      return;
    }
    if (!current && current !== 0) merged[key] = value;
  };

  setIfMissing("name", incoming.name);
  setIfMissing("slug", incoming.slug);
  setIfMissing("source", incoming.source);
  setIfMissing("status", incoming.status);
  setIfMissing("gotchas", incoming.gotchas);
  setIfMissing("instructions", incoming.instructions);
  setIfMissing("primaryMuscles", incoming.primaryMuscles);
  setIfMissing("secondaryMuscles", incoming.secondaryMuscles);
  setIfMissing("equipment", incoming.equipment);
  setIfMissing("aliases", incoming.aliases);
  setIfMissing("category", incoming.category);
  setIfMissing("pattern", incoming.pattern);
  setIfMissing("youtubeSearchQuery", incoming.youtubeSearchQuery);
  if (!merged.youtubeVideoId && incoming.youtubeVideoId) {
    merged.youtubeVideoId = incoming.youtubeVideoId;
  }
  if (!merged.media && incoming.media) {
    merged.media = incoming.media;
  }
  if (!merged.stableId) merged.stableId = incoming.stableId;
  if (!merged.sourceKey && incoming.sourceKey) merged.sourceKey = incoming.sourceKey;
  if (!merged.externalId && incoming.externalId) merged.externalId = incoming.externalId;

  merged.updatedAt = now;
  merged.createdAt = existing.createdAt ?? incoming.createdAt ?? now;

  const changed = Object.keys(merged).some((key) => merged[key] !== existing[key]);

  return { merged, changed, skipped: false };
}

function normalizeSeedDefaults(record, now) {
  const name = normalizeString(record.name) || "Unnamed Exercise";
  const slug = record.slug || slugify(name) || "exercise";
  const primaryMuscles = isNonEmptyArray(record.primaryMuscles)
    ? record.primaryMuscles
    : record.muscle_group
      ? [record.muscle_group]
      : [];
  const media =
    record.media ??
    (record.video_url || record.videoUrl ? { videoUrl: record.video_url ?? record.videoUrl } :
      undefined);

  return {
    ...record,
    name,
    slug,
    primaryMuscles,
    secondaryMuscles: isNonEmptyArray(record.secondaryMuscles)
      ? record.secondaryMuscles
      : [],
    instructions: isNonEmptyArray(record.instructions) ? record.instructions : [],
    commonMistakes: isNonEmptyArray(record.commonMistakes)
      ? record.commonMistakes
      : [],
    gotchas: isNonEmptyArray(record.gotchas) ? record.gotchas : [],
    progressions: isNonEmptyArray(record.progressions) ? record.progressions : [],
    regressions: isNonEmptyArray(record.regressions) ? record.regressions : [],
    aliases: isNonEmptyArray(record.aliases) ? record.aliases : [],
    equipment: isNonEmptyArray(record.equipment) ? record.equipment : [],
    status: record.status ?? "extended",
    youtubeSearchQuery:
      record.youtubeSearchQuery ?? `${name ?? "exercise"} exercise form cues`,
    youtubeVideoId: record.youtubeVideoId ?? null,
    media,
    is_custom: false,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

async function ensureStarterExercises() {
  const count = await db.table("exercises").count();
  if (count > 0) return { status: "skipped", count };

  const now = Date.now();
  const normalized = await Promise.all(
    starterExercises.map(async (ex) => {
      const record = normalizeSeedDefaults(ex, now);
      const stableId = await computeStableId({
        externalId: record.externalId,
        name: record.name,
        equipment: record.equipment,
        primaryMuscles: record.primaryMuscles,
        pattern: record.pattern,
        category: record.category,
      });
      return {
        ...record,
        stableId,
        source: record.source ?? "starter",
        sourceKey: record.sourceKey ?? record.externalId ?? null,
        ...inferExerciseEquipment(record),
      };
    })
  );

  await db.table("exercises").bulkAdd(normalized);
  await writeMeta(META_KEYS.lastSeedStatus, "STARTER_ONLY");
  await writeMeta(META_KEYS.lastSeedAt, now);
  await writeMeta(
    META_KEYS.lastSeedMessage,
    `Inserted ${normalized.length} starter exercises.`
  );
  await writeMeta(META_KEYS.lastSeedStats, {
    totalSeed: normalized.length,
    inserted: normalized.length,
    updated: 0,
    skipped: 0,
  });
  await appendAuditLog({
    timestamp: now,
    status: "STARTER_ONLY",
    message: `Inserted ${normalized.length} starter exercises.`,
    stats: { totalSeed: normalized.length, inserted: normalized.length },
    sourceUsed: "starter",
    seedVersion: SEED_VERSION,
  });
  return { status: "seeded", count: normalized.length };
}

export async function resetExerciseSeedVersion() {
  await db.table("meta").bulkDelete(Object.values(META_KEYS));
}

export async function importExercises({
  dryRun = false,
  onlyIfChanged = false,
  onProgress,
} = {}) {
  const startedAt = Date.now();
  const progress = (stage, detail = {}) => {
    onProgress?.({ stage, startedAt, ...detail });
  };
  progress("fetching");

  const fetchResult = await fetchSeedExercises();
  if (!fetchResult.ok) {
    const has404 = fetchResult.errors?.some((error) => error.code === "HTTP_404");
    const prodMissingSeed =
      import.meta.env.PROD && has404
        ? "PROD_MISSING_SEED_FILE: Seed file not found at /seed/exercises.json."
        : null;
    const message =
      prodMissingSeed ||
      fetchResult.errors?.map((error) => error.message).join(" | ") ||
      fetchResult.error?.message ||
      "Unable to load seed payload.";
    seedLog("error", message, { errors: fetchResult.errors });
    if (!dryRun) {
      await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
      await writeMeta(META_KEYS.lastSeedAt, Date.now());
      await writeMeta(META_KEYS.lastSeedMessage, message);
      await writeMeta(META_KEYS.lastSourceUsed, "none");
      await appendAuditLog({
        timestamp: Date.now(),
        status: "FAILURE",
        message,
        stats: null,
        sourceUsed: "none",
        seedVersion: SEED_VERSION,
      });
    }
    return { status: "error", error: message, sourceUsed: "none" };
  }

  const { payload, sourceUsed, warnings } = fetchResult;
  progress("validating");
  const validation = validateSeedPayload(payload, { minCount: SEED_MIN_COUNT });
  if (!validation.ok) {
    const message =
      validation.report.total < SEED_MIN_COUNT
        ? `Seed payload must include at least ${SEED_MIN_COUNT} records (found ${validation.report.total}).`
        : `Seed validation failed (${validation.report.invalidCount} invalid).`;
    seedLog("error", message, { report: validation.report });
    if (!dryRun) {
      await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
      await writeMeta(META_KEYS.lastSeedAt, Date.now());
      await writeMeta(META_KEYS.lastSeedMessage, message);
      await writeMeta(META_KEYS.lastValidationReport, validation.report);
      await writeMeta(META_KEYS.lastSourceUsed, sourceUsed);
      await appendAuditLog({
        timestamp: Date.now(),
        status: "FAILURE",
        message,
        stats: validation.report,
        sourceUsed,
        seedVersion: SEED_VERSION,
      });
    }
    return {
      status: "error",
      error: message,
      report: validation.report,
      sourceUsed,
    };
  }

  const normalized = validation.normalized.map((record) => {
    const cleaned = normalizeSeedDefaults(record, Date.now());
    return {
      ...cleaned,
      source: record.source ?? "seed",
      sourceKey: record.sourceKey ?? record.externalId ?? null,
      externalId: record.externalId ?? null,
      primaryMuscles: normalizeStringArray(record.primaryMuscles),
      secondaryMuscles: normalizeStringArray(record.secondaryMuscles),
      equipment: normalizeStringArray(record.equipment),
      aliases: normalizeStringArray(record.aliases),
      instructions: normalizeStringArray(record.instructions),
      gotchas: normalizeStringArray(record.gotchas),
      commonMistakes: normalizeStringArray(record.commonMistakes),
    };
  });

  progress("hashing");
  const withStableIds = await Promise.all(
    normalized.map(async (record) => ({
      ...record,
      stableId: await computeStableId({
        externalId: record.externalId,
        name: record.name,
        equipment: record.equipment,
        primaryMuscles: record.primaryMuscles,
        pattern: record.pattern,
        category: record.category,
      }),
    }))
  );

  const dedupedMap = new Map();
  let duplicatesCollapsed = 0;
  for (const record of withStableIds) {
    const existing = dedupedMap.get(record.stableId);
    if (!existing) {
      dedupedMap.set(record.stableId, record);
      continue;
    }
    duplicatesCollapsed += 1;
    const keep = scoreExercise(existing) >= scoreExercise(record) ? existing : record;
    dedupedMap.set(record.stableId, keep);
  }
  const deduped = Array.from(dedupedMap.values());
  const seedHash = await computeSeedHash(deduped);
  if (duplicatesCollapsed > 0) {
    seedLog("warn", "Duplicate stableIds collapsed during seed import.", {
      duplicatesCollapsed,
    });
  }

  if (onlyIfChanged) {
    const meta = await getSeedMetaSnapshot();
    if (
      meta.seedVersion === SEED_VERSION &&
      meta.seedHash === seedHash &&
      meta.lastSeedStatus === "SUCCESS"
    ) {
      return {
        status: "skipped",
        reason: "Seed hash/version unchanged.",
        sourceUsed,
        seedVersion: SEED_VERSION,
        seedHash,
      };
    }
  }

  if (dryRun) {
    return {
      status: "dry-run",
      sourceUsed,
      totalSeed: validation.report.total,
      valid: validation.report.validCount,
      invalid: validation.report.invalidCount,
      duplicatesCollapsed,
      seedVersion: SEED_VERSION,
      seedHash,
      report: validation.report,
      warnings,
    };
  }

  const now = Date.now();
  progress("importing", { batch: 0, totalBatches: 0 });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
      const stableIds = deduped.map((record) => record.stableId).filter(Boolean);
      const existingExercises = stableIds.length
        ? await db.table("exercises").where("stableId").anyOf(stableIds).toArray()
        : [];
      const existingMap = new Map(
        existingExercises.map((exercise) => [exercise.stableId, exercise])
      );

      const toUpsert = [];
      deduped.forEach((record) => {
        const existing = existingMap.get(record.stableId);
        if (!existing) {
          inserted += 1;
          toUpsert.push({
            ...record,
            source: record.source ?? "seed",
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
            ...inferExerciseEquipment(record),
          });
          return;
        }

        const { merged, changed, skipped: skippedUpdate } = mergeSeedExercise(
          existing,
          record,
          now
        );
        if (skippedUpdate) {
          skipped += 1;
          return;
        }
        if (changed) {
          updated += 1;
          toUpsert.push({
            ...merged,
            ...inferExerciseEquipment(merged),
          });
        } else {
          skipped += 1;
        }
      });

      const batchSize = 500;
      const totalBatches = Math.ceil(toUpsert.length / batchSize) || 0;
      for (let i = 0; i < toUpsert.length; i += batchSize) {
        const batchIndex = Math.floor(i / batchSize) + 1;
        progress("importing", { batch: batchIndex, totalBatches });
        await db.table("exercises").bulkPut(toUpsert.slice(i, i + batchSize));
      }

      await writeMeta(META_KEYS.version, SEED_VERSION);
      await writeMeta(META_KEYS.hash, seedHash);
      await writeMeta(META_KEYS.lastSeedAt, now);
      await writeMeta(META_KEYS.lastSeedStatus, "SUCCESS");
      await writeMeta(
        META_KEYS.lastSeedMessage,
        `Seeded ${inserted} inserted, ${updated} updated, ${skipped} skipped.`
      );
      await writeMeta(META_KEYS.lastSeedStats, {
        totalSeed: deduped.length,
        valid: validation.report.validCount,
        invalid: validation.report.invalidCount,
        inserted,
        updated,
        skipped,
        duplicatesCollapsed,
      });
      await writeMeta(META_KEYS.lastValidationReport, validation.report);
      await writeMeta(META_KEYS.lastSourceUsed, sourceUsed);
      await appendAuditLog({
        timestamp: now,
        status: "SUCCESS",
        message: "Seed import completed.",
        stats: {
          totalSeed: deduped.length,
          inserted,
          updated,
          skipped,
          duplicatesCollapsed,
        },
        sourceUsed,
        seedVersion: SEED_VERSION,
        seedHash,
      });
    });
  } catch (error) {
    const message = error?.message ?? "Seed import failed.";
    seedLog("error", message, { error });
    await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
    await writeMeta(META_KEYS.lastSeedAt, Date.now());
    await writeMeta(META_KEYS.lastSeedMessage, message);
    await writeMeta(META_KEYS.lastValidationReport, validation.report);
    await writeMeta(META_KEYS.lastSourceUsed, sourceUsed);
    await appendAuditLog({
      timestamp: Date.now(),
      status: "FAILURE",
      message,
      stats: validation.report,
      sourceUsed,
      seedVersion: SEED_VERSION,
    });
    return { status: "error", error: message, sourceUsed };
  }

  const durationMs = Date.now() - startedAt;
  seedLog("info", "Seed import complete", {
    sourceUsed,
    seedVersion: SEED_VERSION,
    seedHash,
    inserted,
    updated,
    skipped,
    duplicatesCollapsed,
    durationMs,
    warnings,
  });

  return {
    status: "success",
    sourceUsed,
    totalSeed: validation.report.total,
    valid: validation.report.validCount,
    invalid: validation.report.invalidCount,
    inserted,
    updated,
    skipped,
    duplicatesCollapsed,
    durationMs,
    seedVersion: SEED_VERSION,
    seedHash,
    warnings,
  };
}

export async function seedExercisesIfNeeded() {
  const now = Date.now();
  await ensureStarterExercises();

  const meta = await getSeedMetaSnapshot();
  const exerciseCount = await db.table("exercises").count();
  if (!meta.lastSeedStatus && exerciseCount > 0 && exerciseCount <= STARTER_MIN_COUNT) {
    await writeMeta(META_KEYS.lastSeedStatus, "STARTER_ONLY");
    await writeMeta(META_KEYS.lastSeedAt, now);
    await writeMeta(
      META_KEYS.lastSeedMessage,
      `Starter exercises only (${exerciseCount}).`
    );
    await appendAuditLog({
      timestamp: now,
      status: "STARTER_ONLY",
      message: `Starter exercises only (${exerciseCount}).`,
      stats: { totalSeed: exerciseCount, inserted: 0, updated: 0, skipped: 0 },
      sourceUsed: "starter",
      seedVersion: SEED_VERSION,
    });
  }
  const shouldAttempt =
    meta.seedVersion !== SEED_VERSION ||
    !meta.seedHash ||
    meta.lastSeedStatus === "FAILURE" ||
    exerciseCount < SEED_MIN_COUNT;

  if (!shouldAttempt) {
    seedLog("info", "Seed import skipped (already up to date).", {
      seedVersion: meta.seedVersion,
      seedHash: meta.seedHash,
    });
    return { status: "skipped" };
  }

  seedLog("info", "Seed import starting...", {
    seedVersion: SEED_VERSION,
    lastSeedStatus: meta.lastSeedStatus,
  });

  const result = await importExercises({ dryRun: false });
  return result;
}

export async function getSeedDiagnostics() {
  const meta = await getSeedMetaSnapshot();
  const exerciseCount = await db.table("exercises").count();
  const seededCount = await db
    .table("exercises")
    .where("stableId")
    .above("")
    .count();
  const customCount = await db.table("exercises").filter((ex) => ex.is_custom).count();

  return {
    ...meta,
    exerciseCount,
    seededCount,
    customCount,
    seedVersion: SEED_VERSION,
    seedMinCount: SEED_MIN_COUNT,
    starterMinCount: STARTER_MIN_COUNT,
  };
}

export {
  SEED_VERSION,
  SEED_MIN_COUNT,
  STARTER_MIN_COUNT,
  getSeedMetaSnapshot,
};
