function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function normalizeGymName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isSpaceExpired(space, now = Date.now()) {
  if (!space?.isTemporary) return false;
  const date = parseDate(space.expiresAt);
  if (!date) return false;
  return date.getTime() < now;
}

export function sortSpacesByName(spaces) {
  return [...spaces].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export function resolveActiveSpace(spaces, activeSpaceId) {
  if (!Array.isArray(spaces) || spaces.length === 0) return null;
  const validSpaces = spaces.filter((space) => !isSpaceExpired(space));
  if (!validSpaces.length) return null;

  if (activeSpaceId != null) {
    const active = validSpaces.find((space) => space.id === activeSpaceId);
    if (active) return active;
  }

  const defaultSpace = validSpaces.find((space) => space.isDefault);
  if (defaultSpace) return defaultSpace;

  const sorted = sortSpacesByName(validSpaces);
  return sorted[0] ?? null;
}
