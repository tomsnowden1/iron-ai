import { z } from "zod";

import { normalizeString, normalizeStringArray, slugify } from "./seedUtils.js";

const exerciseSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  primaryMuscles: z.array(z.string().min(1)).min(1),
  equipment: z.array(z.string().min(1)).min(1),
  instructions: z.array(z.string().min(1)).min(1),
  aliases: z.array(z.string()).optional(),
  secondaryMuscles: z.array(z.string()).optional(),
  gotchas: z.array(z.string()).optional(),
  commonMistakes: z.array(z.string()).optional(),
  category: z.string().optional(),
  pattern: z.string().optional(),
  status: z.string().optional(),
  youtubeSearchQuery: z.string().optional(),
  youtubeVideoId: z.string().nullable().optional(),
  media: z
    .object({
      videoUrl: z.string().optional(),
    })
    .optional(),
  source: z.string().optional(),
  sourceKey: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
});

function normalizeSeedArray(value) {
  return normalizeStringArray(value);
}

export function normalizeSeedRecord(record, now = Date.now()) {
  const rawName =
    record?.name ??
    record?.exercise_name ??
    record?.exerciseName ??
    record?.title;
  const name = normalizeString(rawName);
  const rawId =
    record?.externalId ?? record?.external_id ?? record?.id ?? record?._id;
  const externalId = normalizeString(rawId) || null;
  const baseSlug = slugify(name || externalId || "exercise");
  const slug = baseSlug || "exercise";

  const primaryMuscles = normalizeSeedArray(
    record?.primaryMuscles ??
      record?.primary_muscles ??
      (record?.muscle_group ? [record.muscle_group] : [])
  );
  const secondaryMuscles = normalizeSeedArray(
    record?.secondaryMuscles ?? record?.secondary_muscles
  );
  const equipment = normalizeSeedArray(
    record?.equipment ??
      record?.equipmentList ??
      record?.requiredEquipment ??
      record?.required_equipment ??
      record?.equipment_ids
  );
  const aliases = normalizeSeedArray(
    record?.aliases ?? record?.alternativeNames ?? record?.aka
  );
  const instructions = normalizeSeedArray(record?.instructions ?? record?.steps);
  const gotchas = normalizeSeedArray(record?.gotchas ?? record?.tips ?? record?.cues);
  const commonMistakes = normalizeSeedArray(
    record?.commonMistakes ?? record?.common_mistakes
  );
  const category = normalizeString(record?.category ?? record?.type ?? record?.movement);
  const pattern = normalizeString(record?.pattern ?? record?.mechanic ?? record?.force);
  const status = normalizeString(record?.status) || "extended";
  const youtubeSearchQuery =
    normalizeString(record?.youtubeSearchQuery) ||
    (name ? `${name} exercise form cues` : "");
  const youtubeVideoId =
    typeof record?.youtubeVideoId === "string" && record.youtubeVideoId.trim()
      ? record.youtubeVideoId.trim()
      : null;
  const mediaVideoUrl = normalizeString(
    record?.media?.videoUrl ?? record?.videoUrl ?? record?.video_url
  );
  const media = mediaVideoUrl ? { videoUrl: mediaVideoUrl } : undefined;

  return {
    name,
    slug,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    aliases,
    instructions,
    gotchas,
    commonMistakes,
    category,
    pattern,
    status,
    youtubeSearchQuery,
    youtubeVideoId,
    media,
    source: normalizeString(record?.source) || "seed",
    sourceKey: externalId,
    externalId,
    is_custom: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateSeedPayload(payload, { minCount = 300 } = {}) {
  const report = {
    total: Array.isArray(payload) ? payload.length : 0,
    validCount: 0,
    invalidCount: 0,
    invalidSamples: [],
    normalizedCount: 0,
    minCount,
  };

  if (!Array.isArray(payload)) {
    return {
      ok: false,
      normalized: [],
      report: {
        ...report,
        invalidCount: report.total,
        invalidSamples: [
          {
            index: -1,
            name: null,
            reasons: ["Seed payload must be an array."],
          },
        ],
      },
    };
  }

  const normalized = payload.map((record) => normalizeSeedRecord(record));
  report.normalizedCount = normalized.length;

  normalized.forEach((record, index) => {
    const result = exerciseSchema.safeParse(record);
    if (result.success) {
      report.validCount += 1;
      return;
    }
    report.invalidCount += 1;
    if (report.invalidSamples.length < 10) {
      report.invalidSamples.push({
        index,
        name: record.name || null,
        reasons: result.error.issues.map((issue) => issue.message),
      });
    }
  });

  const meetsMinimum = report.total >= minCount;
  const noInvalid = report.invalidCount === 0;

  return {
    ok: meetsMinimum && noInvalid,
    normalized,
    report,
  };
}
