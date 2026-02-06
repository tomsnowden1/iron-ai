const COACH_KEY_MODES = new Set(["server", "user"]);
const DEFAULT_COACH_KEY_MODE = "server";

export function resolveCoachKeyMode(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (COACH_KEY_MODES.has(normalized)) {
    return normalized;
  }
  return DEFAULT_COACH_KEY_MODE;
}

export function getCoachKeyMode() {
  return resolveCoachKeyMode(import.meta.env.VITE_COACH_KEY_MODE);
}

export function isUserKeyMode() {
  return getCoachKeyMode() === "user";
}

