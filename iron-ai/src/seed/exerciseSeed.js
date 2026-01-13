import starterExercises from "../data/starterExercises.json";
import { db } from "../db";
import { inferExerciseEquipment } from "../equipment/inference";
import { buildExerciseLinks } from "./exerciseLinker";
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
  lastRepairAt: "seed.lastRepairAt",
  lastRepairStatus: "seed.lastRepairStatus",
  lastRepairMessage: "seed.lastRepairMessage",
  lastRepairStats: "seed.lastRepairStats",
  lastLinkerAt: "seed.lastLinkerAt",
  lastLinkerStats: "seed.lastLinkerStats",
};

const AUDIT_LOG_LIMIT = 20;

const PLACEHOLDER_INSTRUCTIONS = new Set([
  "Step 1: Perform the movement with control.",
  "Set up your starting position and brace your core.",
  "Move through the full range of motion with control.",
  "Return to the start position and repeat with steady form.",
]);

const PLACEHOLDER_GOTCHAS = new Set([
  "Rushing the tempo or bouncing through reps.",
  "Letting form break down near the end of the set.",
  "Using momentum instead of controlled effort.",
]);

function seedLog(level, message, meta = {}) {
  const logger = console[level] ?? console.info;
  logger(`[seed] ${message}`, meta);
}

function titleCase(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeSeedList(list, placeholders) {
  if (!Array.isArray(list)) return [];
  const cleaned = list.filter((item) => item && !placeholders.has(item));
  return cleaned;
}

function isPlaceholderList(list, placeholders) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((item) => placeholders.has(item));
}

function buildEquipmentIndex(equipmentList = []) {
  const nameToId = new Map();
  const idSet = new Set();

  equipmentList.forEach((item) => {
    if (!item?.id) return;
    idSet.add(item.id);
    const idKey = normalizeString(item.id).toLowerCase();
    if (idKey) nameToId.set(idKey, item.id);
    const nameKey = normalizeString(item.name).toLowerCase();
    if (nameKey) nameToId.set(nameKey, item.id);
    (item.aliases ?? []).forEach((alias) => {
      const aliasKey = normalizeString(alias).toLowerCase();
      if (aliasKey) nameToId.set(aliasKey, item.id);
    });
  });

  return { nameToId, idSet };
}

function withEquipmentAssignments(record) {
  const hasRequired =
    Array.isArray(record?.requiredEquipmentIds) && record.requiredEquipmentIds.length > 0;
  const hasOptional = Array.isArray(record?.optionalEquipmentIds);
  if (hasRequired && hasOptional) return record;
  const inferred = inferExerciseEquipment(record);
  return {
    ...record,
    requiredEquipmentIds: hasRequired ? record.requiredEquipmentIds : inferred.requiredEquipmentIds,
    optionalEquipmentIds: hasOptional ? record.optionalEquipmentIds : inferred.optionalEquipmentIds,
  };
}

async function resolveEquipmentIds(rawEquipment, equipmentTable) {
  const equipmentList = await equipmentTable.toArray();
  const { nameToId, idSet } = buildEquipmentIndex(equipmentList);
  const ids = [];
  const toCreate = [];

  normalizeStringArray(rawEquipment).forEach((item) => {
    const normalized = normalizeString(item).toLowerCase();
    if (!normalized) return;
    const existingId = nameToId.get(normalized);
    if (existingId) {
      ids.push(existingId);
      return;
    }
    const slug = slugify(normalized) || normalized;
    if (!slug) return;
    if (!idSet.has(slug)) {
      toCreate.push({
        id: slug,
        name: titleCase(normalized),
        category: "accessory",
        isPortable: true,
        aliases: [normalized],
      });
      idSet.add(slug);
    }
    nameToId.set(normalized, slug);
    ids.push(slug);
  });

  if (toCreate.length) {
    await equipmentTable.bulkPut(toCreate);
  }

  return Array.from(new Set(ids));
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

  const sanitizedIncoming = {
    ...incoming,
    instructions: sanitizeSeedList(incoming.instructions, PLACEHOLDER_INSTRUCTIONS),
    gotchas: sanitizeSeedList(incoming.gotchas, PLACEHOLDER_GOTCHAS),
    commonMistakes: sanitizeSeedList(incoming.commonMistakes, PLACEHOLDER_GOTCHAS),
  };

  const merged = { ...existing };
  const setIfMissing = (key, value, placeholders) => {
    if (value == null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && value.trim() === "") return;
    const current = merged[key];
    if (Array.isArray(current)) {
      const currentIsPlaceholder = placeholders ? isPlaceholderList(current, placeholders) : false;
      if (current.length === 0 || currentIsPlaceholder) merged[key] = value;
      return;
    }
    if (!current && current !== 0) merged[key] = value;
  };

  setIfMissing("name", sanitizedIncoming.name);
  setIfMissing("slug", sanitizedIncoming.slug);
  if (!merged.source || merged.source === "seed") {
    merged.source = sanitizedIncoming.source;
  }
  setIfMissing("status", sanitizedIncoming.status);
  setIfMissing("gotchas", sanitizedIncoming.gotchas, PLACEHOLDER_GOTCHAS);
  setIfMissing("instructions", sanitizedIncoming.instructions, PLACEHOLDER_INSTRUCTIONS);
  setIfMissing("commonMistakes", sanitizedIncoming.commonMistakes, PLACEHOLDER_GOTCHAS);
  setIfMissing("primaryMuscles", sanitizedIncoming.primaryMuscles);
  setIfMissing("secondaryMuscles", sanitizedIncoming.secondaryMuscles);
  setIfMissing("equipment", sanitizedIncoming.equipment);
  setIfMissing("aliases", sanitizedIncoming.aliases);
  setIfMissing("category", sanitizedIncoming.category);
  setIfMissing("pattern", sanitizedIncoming.pattern);
  setIfMissing("progressions", sanitizedIncoming.progressions);
  setIfMissing("regressions", sanitizedIncoming.regressions);
  setIfMissing("youtubeSearchQuery", sanitizedIncoming.youtubeSearchQuery);
  if (!merged.youtubeVideoId && sanitizedIncoming.youtubeVideoId) {
    merged.youtubeVideoId = sanitizedIncoming.youtubeVideoId;
  }
  if (!merged.media && sanitizedIncoming.media) {
    merged.media = sanitizedIncoming.media;
  }
  if (!merged.stableId) merged.stableId = incoming.stableId;
  if (!merged.sourceKey && sanitizedIncoming.sourceKey) {
    merged.sourceKey = sanitizedIncoming.sourceKey;
  }
  if (!merged.externalId && sanitizedIncoming.externalId) {
    merged.externalId = sanitizedIncoming.externalId;
  }

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
    instructions: sanitizeSeedList(
      isNonEmptyArray(record.instructions) ? record.instructions : [],
      PLACEHOLDER_INSTRUCTIONS
    ),
    commonMistakes: sanitizeSeedList(
      isNonEmptyArray(record.commonMistakes) ? record.commonMistakes : [],
      PLACEHOLDER_GOTCHAS
    ),
    gotchas: sanitizeSeedList(
      isNonEmptyArray(record.gotchas) ? record.gotchas : [],
      PLACEHOLDER_GOTCHAS
    ),
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
        ...withEquipmentAssignments(record),
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

  const normalized = await Promise.all(
    validation.normalized.map(async (record) => {
      const cleaned = normalizeSeedDefaults(record, Date.now());
      const equipmentIds = await resolveEquipmentIds(
        normalizeStringArray(record.equipment),
        db.table("equipment")
      );
      const inferred = inferExerciseEquipment({ ...cleaned, equipment: equipmentIds });
      const requiredEquipmentIds = equipmentIds.length
        ? equipmentIds
        : inferred.requiredEquipmentIds;
      const optionalEquipmentIds = equipmentIds.length ? [] : inferred.optionalEquipmentIds;

      return {
        ...cleaned,
        source: record.source ?? "free-exercise-db",
        sourceKey: record.sourceKey ?? record.externalId ?? null,
        externalId: record.externalId ?? null,
        primaryMuscles: normalizeStringArray(record.primaryMuscles),
        secondaryMuscles: normalizeStringArray(record.secondaryMuscles),
        equipment: equipmentIds,
        requiredEquipmentIds,
        optionalEquipmentIds,
        aliases: normalizeStringArray(record.aliases),
        instructions: normalizeStringArray(cleaned.instructions),
        gotchas: normalizeStringArray(cleaned.gotchas),
        commonMistakes: normalizeStringArray(cleaned.commonMistakes),
      };
    })
  );

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
            ...withEquipmentAssignments(record),
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
            ...withEquipmentAssignments(merged),
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

  const linker = await recomputeExerciseLinks({ dryRun: false });

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
    linker,
  };
}

export async function repairSeedExercises({ dryRun = false, onProgress } = {}) {
  const startedAt = Date.now();
  const progress = (stage, detail = {}) => {
    onProgress?.({ stage, startedAt, ...detail });
  };
  progress("fetching");

  const fetchResult = await fetchSeedExercises();
  if (!fetchResult.ok) {
    const message =
      fetchResult.errors?.map((error) => error.message).join(" | ") ||
      fetchResult.error?.message ||
      "Unable to load seed payload.";
    seedLog("error", message, { errors: fetchResult.errors });
    if (!dryRun) {
      await writeMeta(META_KEYS.lastRepairStatus, "FAILURE");
      await writeMeta(META_KEYS.lastRepairAt, Date.now());
      await writeMeta(META_KEYS.lastRepairMessage, message);
    }
    return { status: "error", error: message };
  }

  const { payload } = fetchResult;
  progress("validating");
  const validation = validateSeedPayload(payload, { minCount: SEED_MIN_COUNT });
  if (!validation.ok) {
    const message =
      validation.report.total < SEED_MIN_COUNT
        ? `Seed payload must include at least ${SEED_MIN_COUNT} records (found ${validation.report.total}).`
        : `Seed validation failed (${validation.report.invalidCount} invalid).`;
    seedLog("error", message, { report: validation.report });
    if (!dryRun) {
      await writeMeta(META_KEYS.lastRepairStatus, "FAILURE");
      await writeMeta(META_KEYS.lastRepairAt, Date.now());
      await writeMeta(META_KEYS.lastRepairMessage, message);
    }
    return { status: "error", error: message, report: validation.report };
  }

  progress("normalizing");
  const normalized = await Promise.all(
    validation.normalized.map(async (record) => {
      const cleaned = normalizeSeedDefaults(record, Date.now());
      const equipmentIds = await resolveEquipmentIds(
        normalizeStringArray(record.equipment),
        db.table("equipment")
      );
      const inferred = inferExerciseEquipment({ ...cleaned, equipment: equipmentIds });
      const requiredEquipmentIds = equipmentIds.length
        ? equipmentIds
        : inferred.requiredEquipmentIds;
      const optionalEquipmentIds = equipmentIds.length ? [] : inferred.optionalEquipmentIds;

      return {
        ...cleaned,
        source: record.source ?? "free-exercise-db",
        sourceKey: record.sourceKey ?? record.externalId ?? null,
        externalId: record.externalId ?? null,
        primaryMuscles: normalizeStringArray(record.primaryMuscles),
        secondaryMuscles: normalizeStringArray(record.secondaryMuscles),
        equipment: equipmentIds,
        requiredEquipmentIds,
        optionalEquipmentIds,
        aliases: normalizeStringArray(record.aliases),
        instructions: normalizeStringArray(cleaned.instructions),
        gotchas: normalizeStringArray(cleaned.gotchas),
        commonMistakes: normalizeStringArray(cleaned.commonMistakes),
      };
    })
  );

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
  withStableIds.forEach((record) => {
    const existing = dedupedMap.get(record.stableId);
    if (!existing) {
      dedupedMap.set(record.stableId, record);
      return;
    }
    const keep = scoreExercise(existing) >= scoreExercise(record) ? existing : record;
    dedupedMap.set(record.stableId, keep);
  });
  const deduped = Array.from(dedupedMap.values());

  if (dryRun) {
    return {
      status: "dry-run",
      totalSeed: validation.report.total,
      valid: validation.report.validCount,
      invalid: validation.report.invalidCount,
      totalNormalized: deduped.length,
    };
  }

  const now = Date.now();
  let updated = 0;
  let skipped = 0;
  let clearedPlaceholders = 0;

  try {
    await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
      const existingExercises = await db.table("exercises").toArray();
      const existingByStableId = new Map(
        existingExercises.map((exercise) => [exercise.stableId, exercise])
      );
      const existingBySourceKey = new Map(
        existingExercises
          .filter((exercise) => exercise.sourceKey)
          .map((exercise) => [exercise.sourceKey, exercise])
      );
      const existingBySlug = new Map(
        existingExercises
          .filter((exercise) => exercise.slug)
          .map((exercise) => [exercise.slug, exercise])
      );

      const toUpdate = [];

      deduped.forEach((record) => {
        const existing =
          existingByStableId.get(record.stableId) ||
          (record.sourceKey ? existingBySourceKey.get(record.sourceKey) : null) ||
          (record.slug ? existingBySlug.get(record.slug) : null);

        if (!existing) {
          skipped += 1;
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

        const final = { ...merged };
        let didChange = changed;

        if (
          isPlaceholderList(existing.instructions, PLACEHOLDER_INSTRUCTIONS) &&
          !record.instructions?.length
        ) {
          final.instructions = [];
          didChange = true;
          clearedPlaceholders += 1;
        }
        if (
          isPlaceholderList(existing.gotchas, PLACEHOLDER_GOTCHAS) &&
          !record.gotchas?.length
        ) {
          final.gotchas = [];
          didChange = true;
          clearedPlaceholders += 1;
        }
        if (
          isPlaceholderList(existing.commonMistakes, PLACEHOLDER_GOTCHAS) &&
          !record.commonMistakes?.length
        ) {
          final.commonMistakes = [];
          didChange = true;
          clearedPlaceholders += 1;
        }

        if (didChange) {
          updated += 1;
          toUpdate.push(withEquipmentAssignments(final));
        } else {
          skipped += 1;
        }
      });

      const batchSize = 500;
      for (let i = 0; i < toUpdate.length; i += batchSize) {
        await db.table("exercises").bulkPut(toUpdate.slice(i, i + batchSize));
      }

      await writeMeta(META_KEYS.lastRepairAt, now);
      await writeMeta(META_KEYS.lastRepairStatus, "SUCCESS");
      await writeMeta(
        META_KEYS.lastRepairMessage,
        `Repair updated ${updated} exercises (skipped ${skipped}).`
      );
      await writeMeta(META_KEYS.lastRepairStats, {
        totalSeed: deduped.length,
        updated,
        skipped,
        clearedPlaceholders,
      });
    });
  } catch (error) {
    const message = error?.message ?? "Seed repair failed.";
    seedLog("error", message, { error });
    await writeMeta(META_KEYS.lastRepairStatus, "FAILURE");
    await writeMeta(META_KEYS.lastRepairAt, Date.now());
    await writeMeta(META_KEYS.lastRepairMessage, message);
    return { status: "error", error: message };
  }

  const linker = await recomputeExerciseLinks({ dryRun: false });

  return {
    status: "success",
    updated,
    skipped,
    clearedPlaceholders,
    linker,
  };
}

export async function recomputeExerciseLinks({ dryRun = false } = {}) {
  const now = Date.now();
  const exercises = await db.table("exercises").toArray();
  const linkMap = buildExerciseLinks(exercises);
  const updates = [];
  let updated = 0;
  let skipped = 0;

  exercises.forEach((exercise) => {
    if (exercise?.is_custom || exercise?.source === "user") {
      skipped += 1;
      return;
    }
    const key = exercise.stableId || exercise.slug;
    if (!key) {
      skipped += 1;
      return;
    }
    const links = linkMap.get(key);
    if (!links) {
      skipped += 1;
      return;
    }
    const hasExisting =
      (exercise.progressions?.length ?? 0) > 0 || (exercise.regressions?.length ?? 0) > 0;
    if (hasExisting) {
      skipped += 1;
      return;
    }

    updated += 1;
    updates.push({
      ...exercise,
      progressions: links.progressions,
      regressions: links.regressions,
      updatedAt: now,
    });
  });

  if (dryRun) {
    return { status: "dry-run", updated, skipped };
  }

  try {
    await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
      if (updates.length) {
        await db.table("exercises").bulkPut(updates);
      }
      await writeMeta(META_KEYS.lastLinkerAt, now);
      await writeMeta(META_KEYS.lastLinkerStats, {
        updated,
        skipped,
      });
    });
  } catch (error) {
    const message = error?.message ?? "Linker failed.";
    seedLog("error", message, { error });
    await writeMeta(META_KEYS.lastLinkerAt, Date.now());
    await writeMeta(META_KEYS.lastLinkerStats, {
      updated: 0,
      skipped,
      error: message,
    });
    return { status: "error", error: message };
  }

  return { status: "success", updated, skipped };
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
