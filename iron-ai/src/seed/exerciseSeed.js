import starterExercises from "../data/starterExercises.json";
import { db } from "../db";
import { inferExerciseEquipment } from "../equipment/inference";
import { buildExerciseLinks } from "./exerciseLinker";
import {
  SEED_MIN_COUNT,
  SEED_VERSION,
  SEED_VERSION_NUMBER,
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
import { normalizeSeedRecord, validateSeedPayload } from "./seedValidation";

const META_KEYS = {
  version: "seed.version",
  versionNumber: "seed.versionNumber",
  hash: "seed.hash",
  lastSeedAt: "seed.lastSeedAt",
  lastSeedStatus: "seed.lastSeedStatus",
  lastSeedMessage: "seed.lastSeedMessage",
  lastSeedStats: "seed.lastSeedStats",
  auditLog: "seed.auditLog",
  lastValidationReport: "seed.lastValidationReport",
  lastSourceUsed: "seed.lastSourceUsed",
  lastImportReport: "seed.lastImportReport",
  lastRepairAt: "seed.lastRepairAt",
  lastRepairStatus: "seed.lastRepairStatus",
  lastRepairMessage: "seed.lastRepairMessage",
  lastRepairStats: "seed.lastRepairStats",
  lastLinkerAt: "seed.lastLinkerAt",
  lastLinkerStats: "seed.lastLinkerStats",
  repairLastRunAt: "seed.repair.lastRunAt",
  repairUpdatedCount: "seed.repair.updatedCount",
  repairPlaceholderClearedCount: "seed.repair.placeholderClearedCount",
  repairSampleUpdatedIds: "seed.repair.sampleUpdatedIds",
  repairSeedHash: "seed.repair.seedHash",
  repairVersion: "seed.repair.version",
};

const AUDIT_LOG_LIMIT = 20;
const REPAIR_VERSION = "2026-01-14-repair-v2";
const REPORT_PATH = "src/seed/reports/latestExerciseImportReport.json";

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

const PLACEHOLDER_PRIMARY_MUSCLES = new Set(["full body"]);

const PLACEHOLDER_SEED_NAME = /^Exercise\s+\d+$/i;

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

function normalizeMuscleList(list) {
  return Array.from(
    new Set(normalizeStringArray(list).map((item) => titleCase(item)))
  );
}

function buildSourceStableKey(record) {
  const key = normalizeString(record?.sourceId ?? record?.externalId ?? record?.sourceKey);
  if (!key) return null;
  const source = normalizeString(record?.source).toLowerCase();
  return source ? `${source}:${key}` : key;
}

function getRecordSampleId(record) {
  return (
    record?.stableId ??
    record?.sourceId ??
    record?.externalId ??
    record?.sourceKey ??
    record?.name ??
    null
  );
}

function getSampleList(items, limit = 5) {
  return items.filter(Boolean).slice(0, limit);
}

async function writeImportReportArtifact(report) {
  if (typeof process === "undefined" || !process.versions?.node) {
    return { ok: false, error: new Error("Filesystem report writing unavailable.") };
  }
  const fsModule = await import("fs");
  const pathModule = await import("path");
  try {
    const absolute = pathModule.resolve(process.cwd(), REPORT_PATH);
    await fsModule.promises.mkdir(pathModule.dirname(absolute), { recursive: true });
    await fsModule.promises.writeFile(absolute, JSON.stringify(report, null, 2));
    return { ok: true, path: REPORT_PATH };
  } catch (error) {
    return { ok: false, error };
  }
}

function shouldClearPlaceholderMuscles(record, list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  if (!PLACEHOLDER_SEED_NAME.test(record?.name ?? "")) return false;
  return list.every((item) => PLACEHOLDER_PRIMARY_MUSCLES.has(String(item).toLowerCase()));
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
    seedVersionNumber: map.get(META_KEYS.versionNumber) ?? null,
    seedHash: map.get(META_KEYS.hash) ?? null,
    lastSeedAt: map.get(META_KEYS.lastSeedAt) ?? null,
    lastSeedStatus: map.get(META_KEYS.lastSeedStatus) ?? null,
    lastSeedMessage: map.get(META_KEYS.lastSeedMessage) ?? null,
    lastSeedStats: map.get(META_KEYS.lastSeedStats) ?? null,
    lastValidationReport: map.get(META_KEYS.lastValidationReport) ?? null,
    lastSourceUsed: map.get(META_KEYS.lastSourceUsed) ?? null,
    lastImportReport: map.get(META_KEYS.lastImportReport) ?? null,
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

export async function loadSeedPayload() {
  const result = await fetchSeedExercises();
  if (!result.ok) {
    const message =
      result.errors?.map((error) => error.message).join(" | ") ||
      result.error?.message ||
      "Unable to load seed payload.";
    return { status: "error", error: message };
  }

  return {
    status: "success",
    payload: Array.isArray(result.payload) ? result.payload : [],
    sourceUsed: result.sourceUsed ?? "unknown",
  };
}

export async function getSeedSamples({ limit = 1 } = {}) {
  const result = await loadSeedPayload();
  if (result.status !== "success") return result;
  const sample = result.payload.slice(0, limit);
  const normalizedSample = sample.map((record) =>
    normalizeSeedDefaults(normalizeSeedRecord(record), Date.now())
  );
  return {
    status: "success",
    sourceUsed: result.sourceUsed,
    total: result.payload.length,
    sample,
    normalizedSample,
  };
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
    primaryMuscles: shouldClearPlaceholderMuscles(incoming, incoming.primaryMuscles)
      ? []
      : incoming.primaryMuscles,
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
  if (!merged.stableId || merged.stableId !== incoming.stableId) {
    merged.stableId = incoming.stableId;
  }
  if (!merged.sourceKey && sanitizedIncoming.sourceKey) {
    merged.sourceKey = sanitizedIncoming.sourceKey;
  }
  if (!merged.externalId && sanitizedIncoming.externalId) {
    merged.externalId = sanitizedIncoming.externalId;
  }
  if (!merged.sourceId && sanitizedIncoming.sourceId) {
    merged.sourceId = sanitizedIncoming.sourceId;
  }

  merged.updatedAt = now;
  merged.createdAt = existing.createdAt ?? incoming.createdAt ?? now;

  const changed = Object.keys(merged).some((key) => merged[key] !== existing[key]);

  return { merged, changed, skipped: false };
}

function normalizeSeedDefaults(record, now) {
  const name = normalizeString(record.name) || "Unnamed Exercise";
  const slug = record.slug || slugify(name) || "exercise";
  const rawPrimary = isNonEmptyArray(record.primaryMuscles)
    ? record.primaryMuscles
    : record.muscle_group
      ? [record.muscle_group]
      : [];
  const primaryMuscles = shouldClearPlaceholderMuscles(record, rawPrimary)
    ? []
    : rawPrimary;
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
    sourceId: record.sourceId ?? record.externalId ?? null,
    is_custom: false,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

function buildImportReport({
  status,
  sourceUsed,
  seedHash = null,
  validationReport,
  insertedIds = [],
  updatedIds = [],
  skippedIds = [],
  errors = [],
  fetchWarnings = [],
}) {
  const invalidSamples = validationReport?.invalidSamples ?? [];
  const warningSamples = validationReport?.warningSamples ?? [];
  const warningCount = (validationReport?.warningCount ?? 0) + fetchWarnings.length;

  return {
    status,
    generatedAt: new Date().toISOString(),
    reportPath: REPORT_PATH,
    seedVersion: SEED_VERSION,
    seedVersionNumber: SEED_VERSION_NUMBER,
    seedHash,
    sourceUsed,
    counts: {
      total: validationReport?.total ?? 0,
      inserted: insertedIds.length,
      updated: updatedIds.length,
      skipped: skippedIds.length,
      invalid: validationReport?.invalidCount ?? 0,
      warnings: warningCount,
      errors: errors.length,
    },
    samples: {
      inserted: getSampleList(insertedIds),
      updated: getSampleList(updatedIds),
      skipped: getSampleList(skippedIds),
      invalid: getSampleList(
        invalidSamples.map((sample) => sample.name ?? `index:${sample.index}`)
      ),
      warnings: getSampleList(
        warningSamples.map((sample) => sample.name ?? `index:${sample.index}`)
      ),
      errors: getSampleList(errors.map((error) => error.code ?? error.message ?? "error")),
    },
    warnings: {
      missingOptional: warningSamples,
      fetch: fetchWarnings,
    },
    errors,
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
        source: record.source,
        sourceId: record.sourceId ?? record.externalId ?? record.sourceKey ?? null,
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
  const insertedIds = normalized.map((record) => getRecordSampleId(record));
  await writeMeta(META_KEYS.lastSeedStatus, "STARTER_ONLY");
  await writeMeta(META_KEYS.lastSeedAt, now);
  await writeMeta(META_KEYS.versionNumber, SEED_VERSION_NUMBER);
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
  const report = buildImportReport({
    status: "starter-only",
    sourceUsed: "starter",
    seedHash: null,
    validationReport: {
      total: normalized.length,
      invalidCount: 0,
      warningCount: 0,
      warningSamples: [],
      invalidSamples: [],
    },
    insertedIds,
  });
  const reportResult = await writeImportReportArtifact(report);
  await writeMeta(META_KEYS.lastImportReport, {
    ...report,
    reportPath: reportResult.ok ? reportResult.path : REPORT_PATH,
    reportWriteError: reportResult.ok ? null : reportResult.error?.message,
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
      const report = buildImportReport({
        status: "error",
        sourceUsed: "none",
        seedHash: null,
        validationReport: null,
        errors: fetchResult.errors ?? [fetchResult.error].filter(Boolean),
      });
      const reportResult = await writeImportReportArtifact(report);
      await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
      await writeMeta(META_KEYS.lastSeedAt, Date.now());
      await writeMeta(META_KEYS.lastSeedMessage, message);
      await writeMeta(META_KEYS.versionNumber, SEED_VERSION_NUMBER);
      await writeMeta(META_KEYS.lastSourceUsed, "none");
      await writeMeta(META_KEYS.lastImportReport, {
        ...report,
        reportPath: reportResult.ok ? reportResult.path : REPORT_PATH,
        reportWriteError: reportResult.ok ? null : reportResult.error?.message,
      });
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
      const report = buildImportReport({
        status: "error",
        sourceUsed,
        seedHash: null,
        validationReport: validation.report,
        errors: [
          {
            code: "SEED_VALIDATION_FAILED",
            message,
          },
        ],
      });
      const reportResult = await writeImportReportArtifact(report);
      await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
      await writeMeta(META_KEYS.lastSeedAt, Date.now());
      await writeMeta(META_KEYS.lastSeedMessage, message);
      await writeMeta(META_KEYS.versionNumber, SEED_VERSION_NUMBER);
      await writeMeta(META_KEYS.lastValidationReport, validation.report);
      await writeMeta(META_KEYS.lastSourceUsed, sourceUsed);
      await writeMeta(META_KEYS.lastImportReport, {
        ...report,
        reportPath: reportResult.ok ? reportResult.path : REPORT_PATH,
        reportWriteError: reportResult.ok ? null : reportResult.error?.message,
      });
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
        sourceId: record.sourceId ?? record.externalId ?? null,
        primaryMuscles: normalizeMuscleList(record.primaryMuscles),
        secondaryMuscles: normalizeMuscleList(record.secondaryMuscles),
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
        source: record.source,
        sourceId: record.sourceId ?? record.externalId ?? record.sourceKey ?? null,
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
      warnings: validation.report.warningCount,
      duplicatesCollapsed,
      seedVersion: SEED_VERSION,
      seedVersionNumber: SEED_VERSION_NUMBER,
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
  const insertedIds = [];
  const updatedIds = [];
  const skippedIds = [];

  try {
    await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
      const existingExercises = await db.table("exercises").toArray();
      const existingByStableId = new Map(
        existingExercises
          .filter((exercise) => exercise.stableId)
          .map((exercise) => [exercise.stableId, exercise])
      );
      const existingBySourceStableKey = new Map(
        existingExercises
          .map((exercise) => [buildSourceStableKey(exercise), exercise])
          .filter(([key]) => key)
      );
      const existingBySourceId = new Map(
        existingExercises
          .filter((exercise) => exercise.sourceId)
          .map((exercise) => [exercise.sourceId, exercise])
      );
      const existingByExternalId = new Map(
        existingExercises
          .filter((exercise) => exercise.externalId)
          .map((exercise) => [exercise.externalId, exercise])
      );

      const toUpsert = [];
      deduped.forEach((record) => {
        const sourceStableKey = buildSourceStableKey(record);
        const existing =
          existingByStableId.get(record.stableId) ||
          (sourceStableKey ? existingBySourceStableKey.get(sourceStableKey) : null) ||
          (record.sourceId ? existingBySourceId.get(record.sourceId) : null) ||
          (record.externalId ? existingByExternalId.get(record.externalId) : null);
        if (!existing) {
          inserted += 1;
          insertedIds.push(getRecordSampleId(record));
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
          skippedIds.push(getRecordSampleId(existing));
          return;
        }
        if (changed) {
          updated += 1;
          updatedIds.push(getRecordSampleId(existing));
          toUpsert.push({
            ...merged,
            ...withEquipmentAssignments(merged),
          });
        } else {
          skipped += 1;
          skippedIds.push(getRecordSampleId(existing));
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
      await writeMeta(META_KEYS.versionNumber, SEED_VERSION_NUMBER);
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
    const report = buildImportReport({
      status: "error",
      sourceUsed,
      seedHash,
      validationReport: validation.report,
      insertedIds,
      updatedIds,
      skippedIds,
      errors: [
        {
          code: "SEED_IMPORT_FAILED",
          message,
        },
      ],
      fetchWarnings: warnings ?? [],
    });
    const reportResult = await writeImportReportArtifact(report);
    await writeMeta(META_KEYS.lastSeedStatus, "FAILURE");
    await writeMeta(META_KEYS.lastSeedAt, Date.now());
    await writeMeta(META_KEYS.lastSeedMessage, message);
    await writeMeta(META_KEYS.versionNumber, SEED_VERSION_NUMBER);
    await writeMeta(META_KEYS.lastValidationReport, validation.report);
    await writeMeta(META_KEYS.lastSourceUsed, sourceUsed);
    await writeMeta(META_KEYS.lastImportReport, {
      ...report,
      reportPath: reportResult.ok ? reportResult.path : REPORT_PATH,
      reportWriteError: reportResult.ok ? null : reportResult.error?.message,
    });
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
  const report = buildImportReport({
    status: "success",
    sourceUsed,
    seedHash,
    validationReport: validation.report,
    insertedIds,
    updatedIds,
    skippedIds,
    errors: [],
    fetchWarnings: warnings ?? [],
  });
  const reportResult = await writeImportReportArtifact(report);
  await writeMeta(META_KEYS.lastImportReport, {
    ...report,
    reportPath: reportResult.ok ? reportResult.path : REPORT_PATH,
    reportWriteError: reportResult.ok ? null : reportResult.error?.message,
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
    seedVersionNumber: SEED_VERSION_NUMBER,
    seedHash,
    warnings,
    linker,
  };
}

export async function repairSeededExercises({
  dryRun = false,
  force = false,
  onProgress,
} = {}) {
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
      await writeMeta(META_KEYS.repairLastRunAt, Date.now());
      await writeMeta(META_KEYS.repairUpdatedCount, 0);
      await writeMeta(META_KEYS.repairPlaceholderClearedCount, 0);
      await writeMeta(META_KEYS.repairSampleUpdatedIds, []);
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
      await writeMeta(META_KEYS.repairLastRunAt, Date.now());
      await writeMeta(META_KEYS.repairUpdatedCount, 0);
      await writeMeta(META_KEYS.repairPlaceholderClearedCount, 0);
      await writeMeta(META_KEYS.repairSampleUpdatedIds, []);
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
        sourceId: record.sourceId ?? record.externalId ?? null,
        primaryMuscles: normalizeMuscleList(record.primaryMuscles),
        secondaryMuscles: normalizeMuscleList(record.secondaryMuscles),
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
        source: record.source,
        sourceId: record.sourceId ?? record.externalId ?? record.sourceKey ?? null,
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

  const seedHash = await computeSeedHash(deduped);

  if (dryRun) {
    return {
      status: "dry-run",
      totalSeed: validation.report.total,
      valid: validation.report.validCount,
      invalid: validation.report.invalidCount,
      totalNormalized: deduped.length,
      seedHash,
    };
  }

  const lastRepairHash = await readMeta(META_KEYS.repairSeedHash);
  const lastRepairVersion = await readMeta(META_KEYS.repairVersion);
  if (!force && lastRepairHash === seedHash && lastRepairVersion === REPAIR_VERSION) {
    await writeMeta(META_KEYS.lastRepairAt, Date.now());
    await writeMeta(META_KEYS.lastRepairStatus, "SKIPPED");
    await writeMeta(META_KEYS.lastRepairMessage, "Seed repair skipped (up to date).");
    await writeMeta(META_KEYS.lastRepairStats, {
      totalSeed: deduped.length,
      updated: 0,
      skipped: deduped.length,
      clearedPlaceholders: 0,
      seedHash,
      force,
    });
    await writeMeta(META_KEYS.repairLastRunAt, Date.now());
    await writeMeta(META_KEYS.repairUpdatedCount, 0);
    await writeMeta(META_KEYS.repairPlaceholderClearedCount, 0);
    await writeMeta(META_KEYS.repairSampleUpdatedIds, []);
    await writeMeta(META_KEYS.repairSeedHash, seedHash);
    await writeMeta(META_KEYS.repairVersion, REPAIR_VERSION);
    return { status: "skipped", seedHash };
  }

  const now = Date.now();
  let updated = 0;
  let skipped = 0;
  let clearedPlaceholders = 0;
  const sampleUpdatedIds = [];

  try {
    await db.transaction("rw", db.table("exercises"), db.table("meta"), async () => {
      const existingExercises = await db.table("exercises").toArray();
      const existingByStableId = new Map(
        existingExercises.map((exercise) => [exercise.stableId, exercise])
      );
      const existingBySourceId = new Map(
        existingExercises
          .filter((exercise) => exercise.sourceId)
          .map((exercise) => [exercise.sourceId, exercise])
      );
      const existingBySourceKey = new Map(
        existingExercises
          .filter((exercise) => exercise.sourceKey)
          .map((exercise) => [exercise.sourceKey, exercise])
      );
      const existingByExternalId = new Map(
        existingExercises
          .filter((exercise) => exercise.externalId)
          .map((exercise) => [exercise.externalId, exercise])
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
          (record.sourceId ? existingBySourceId.get(record.sourceId) : null) ||
          (record.sourceKey ? existingBySourceKey.get(record.sourceKey) : null) ||
          (record.externalId ? existingByExternalId.get(record.externalId) : null) ||
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
        if (
          shouldClearPlaceholderMuscles(existing, existing.primaryMuscles) &&
          !record.primaryMuscles?.length
        ) {
          final.primaryMuscles = [];
          didChange = true;
        }

        if (didChange) {
          updated += 1;
          if (sampleUpdatedIds.length < 10 && final.stableId) {
            sampleUpdatedIds.push(final.stableId);
          }
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
        seedHash,
        force,
        sampleUpdatedIds,
      });
      await writeMeta(META_KEYS.repairLastRunAt, now);
      await writeMeta(META_KEYS.repairUpdatedCount, updated);
      await writeMeta(META_KEYS.repairPlaceholderClearedCount, clearedPlaceholders);
      await writeMeta(META_KEYS.repairSampleUpdatedIds, sampleUpdatedIds);
      await writeMeta(META_KEYS.repairSeedHash, seedHash);
      await writeMeta(META_KEYS.repairVersion, REPAIR_VERSION);
    });
  } catch (error) {
    const message = error?.message ?? "Seed repair failed.";
    seedLog("error", message, { error });
    await writeMeta(META_KEYS.lastRepairStatus, "FAILURE");
    await writeMeta(META_KEYS.lastRepairAt, Date.now());
    await writeMeta(META_KEYS.lastRepairMessage, message);
    await writeMeta(META_KEYS.repairLastRunAt, Date.now());
    await writeMeta(META_KEYS.repairUpdatedCount, 0);
    await writeMeta(META_KEYS.repairPlaceholderClearedCount, 0);
    await writeMeta(META_KEYS.repairSampleUpdatedIds, []);
    await writeMeta(META_KEYS.repairSeedHash, seedHash);
    await writeMeta(META_KEYS.repairVersion, REPAIR_VERSION);
    return { status: "error", error: message };
  }

  const linker = await recomputeExerciseLinks({ dryRun: false });

  return {
    status: "success",
    updated,
    skipped,
    clearedPlaceholders,
    seedHash,
    sampleUpdatedIds,
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
    seedVersionNumber: meta.seedVersionNumber ?? SEED_VERSION_NUMBER,
    seedMinCount: SEED_MIN_COUNT,
    starterMinCount: STARTER_MIN_COUNT,
  };
}

export {
  SEED_VERSION,
  SEED_VERSION_NUMBER,
  SEED_MIN_COUNT,
  STARTER_MIN_COUNT,
  getSeedMetaSnapshot,
};
