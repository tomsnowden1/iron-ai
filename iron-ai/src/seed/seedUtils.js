export function normalizeString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

export function normalizeStringArray(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = list
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function scoreExercise(record) {
  let score = 0;
  if (record.name) score += 4;
  score += (record.instructions?.length ?? 0) * 2;
  score += (record.primaryMuscles?.length ?? 0) * 2;
  score += (record.secondaryMuscles?.length ?? 0);
  score += (record.equipment?.length ?? 0) * 2;
  score += (record.aliases?.length ?? 0);
  score += (record.gotchas?.length ?? 0);
  score += (record.commonMistakes?.length ?? 0);
  if (record.category) score += 1;
  if (record.pattern) score += 1;
  if (record.youtubeSearchQuery) score += 1;
  if (record.youtubeVideoId || record?.media?.videoUrl) score += 1;
  return score;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this runtime.");
  }
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeStableId({
  source,
  sourceId,
  externalId,
  name,
  equipment = [],
  primaryMuscles = [],
  pattern,
  category,
}) {
  const normalizedSource = normalizeString(source).toLowerCase();
  const sourceKey = normalizeString(sourceId || externalId);
  if (sourceKey) {
    return normalizedSource ? `${normalizedSource}:${sourceKey}` : sourceKey;
  }
  const normalizedName = normalizeString(name).toLowerCase();
  const normalizedEquipment = normalizeStringArray(equipment)
    .map((item) => item.toLowerCase())
    .sort();
  const normalizedPrimary = normalizeStringArray(primaryMuscles)
    .map((item) => item.toLowerCase())
    .sort();
  const normalizedPattern = normalizeString(pattern).toLowerCase();
  const normalizedCategory = normalizeString(category).toLowerCase();
  const material = JSON.stringify({
    name: normalizedName,
    equipment: normalizedEquipment,
    primaryMuscles: normalizedPrimary,
    pattern: normalizedPattern,
    category: normalizedCategory,
  });
  return sha256Hex(material);
}

export async function computeSeedHash(records) {
  const sorted = [...records].sort((a, b) =>
    String(a.stableId).localeCompare(String(b.stableId))
  );
  const payload = sorted.map((record) => ({
    stableId: record.stableId,
    name: record.name,
    primaryMuscles: [...(record.primaryMuscles ?? [])].sort(),
    secondaryMuscles: [...(record.secondaryMuscles ?? [])].sort(),
    equipment: [...(record.equipment ?? [])].sort(),
    aliases: [...(record.aliases ?? [])].sort(),
    instructions: [...(record.instructions ?? [])].sort(),
    gotchas: [...(record.gotchas ?? [])].sort(),
    commonMistakes: [...(record.commonMistakes ?? [])].sort(),
    category: record.category,
    pattern: record.pattern,
    youtubeSearchQuery: record.youtubeSearchQuery,
    youtubeVideoId: record.youtubeVideoId,
    media: record.media,
    sourceKey: record.sourceKey,
  }));
  return sha256Hex(JSON.stringify(payload));
}

export function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
