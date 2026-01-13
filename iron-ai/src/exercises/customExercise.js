import { db } from "../db";
import { inferExerciseEquipment } from "../equipment/inference";

const MAX_ALIAS_COUNT = 10;
const MAX_LIST_COUNT = 12;

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "");
}

function normalizeText(value, maxLength = 160) {
  const cleaned = stripHtml(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function normalizeArray(value, { maxItems = MAX_LIST_COUNT } = {}) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list
    .map((item) => normalizeText(item, 140))
    .filter(Boolean)
    .slice(0, maxItems);
  return Array.from(new Set(cleaned));
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureUniqueSlug(baseSlug, exerciseId) {
  const base = baseSlug || "exercise";
  let slug = base;
  let attempt = 1;

  while (true) {
    const existing = await db.table("exercises").where("slug").equals(slug).first();
    if (!existing || existing.id === exerciseId) return slug;
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
}

function buildEquipmentFields({ equipment, name }) {
  const safeEquipment = normalizeArray(equipment);
  if (safeEquipment.length) {
    return {
      equipment: safeEquipment,
      requiredEquipmentIds: safeEquipment,
      optionalEquipmentIds: [],
    };
  }

  const inferred = inferExerciseEquipment({ name });
  return {
    equipment: [],
    requiredEquipmentIds: inferred.requiredEquipmentIds,
    optionalEquipmentIds: inferred.optionalEquipmentIds,
  };
}

export function normalizeCustomExerciseInput(values) {
  const safeName = normalizeText(values?.name, 120);
  if (!safeName) {
    throw new Error("Name is required.");
  }

  const aliases = normalizeArray(values?.aliases, { maxItems: MAX_ALIAS_COUNT });
  const primaryMuscles = normalizeArray(values?.primaryMuscles);
  const secondaryMuscles = normalizeArray(values?.secondaryMuscles);
  const instructions = normalizeArray(values?.instructions);
  const gotchas = normalizeArray(values?.gotchas);
  const category = normalizeText(values?.category, 80);
  const pattern = normalizeText(values?.pattern, 80);
  const youtubeSearchQuery = normalizeText(values?.youtubeSearchQuery, 120);
  const youtubeVideoId = normalizeText(values?.youtubeVideoId, 80);
  const status = normalizeText(values?.status, 20) || "core";

  const equipmentFields = buildEquipmentFields({ equipment: values?.equipment, name: safeName });

  return {
    name: safeName,
    aliases,
    primaryMuscles,
    secondaryMuscles,
    instructions,
    gotchas,
    category,
    pattern,
    youtubeSearchQuery:
      youtubeSearchQuery || `${safeName ?? "exercise"} exercise form cues`,
    youtubeVideoId: youtubeVideoId || null,
    status,
    ...equipmentFields,
  };
}

export async function createCustomExercise(values) {
  const now = Date.now();
  const normalized = normalizeCustomExerciseInput(values);
  const slug = await ensureUniqueSlug(slugify(normalized.name), null);

  const record = {
    ...normalized,
    slug,
    source: "user",
    is_custom: true,
    createdAt: now,
    updatedAt: now,
  };

  const id = await db.table("exercises").add(record);
  return id;
}

export async function updateCustomExercise(exerciseId, values) {
  const now = Date.now();
  const normalized = normalizeCustomExerciseInput(values);
  const slug = await ensureUniqueSlug(slugify(normalized.name), exerciseId);

  await db.table("exercises").update(exerciseId, {
    ...normalized,
    slug,
    source: "user",
    is_custom: true,
    updatedAt: now,
  });

  return exerciseId;
}
