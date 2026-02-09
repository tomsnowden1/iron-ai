import { createHash } from "node:crypto";

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

export function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeStableId({
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

  const material = JSON.stringify({
    name: normalizeString(name).toLowerCase(),
    equipment: normalizeStringArray(equipment)
      .map((item) => item.toLowerCase())
      .sort(),
    primaryMuscles: normalizeStringArray(primaryMuscles)
      .map((item) => item.toLowerCase())
      .sort(),
    pattern: normalizeString(pattern).toLowerCase(),
    category: normalizeString(category).toLowerCase(),
  });

  return sha256Hex(material);
}
