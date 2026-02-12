export const SUGGESTED_ACTION_STORAGE_KEY = "ironai.coach.suggestedAction.v1";
const SUGGESTED_ACTION_STORAGE_VERSION = 1;

function getStorage() {
  if (typeof globalThis === "undefined") return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeSourceMessageId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePersistedDraft(draft) {
  if (!isObject(draft)) return null;
  const kind = String(draft.kind ?? "").trim();
  if (!kind) return null;
  const title = String(draft.title ?? "").trim();
  const summary = String(draft.summary ?? "").trim();
  if (!title || !summary) return null;
  if (!isObject(draft.payload)) return null;
  return draft;
}

function parsePersistedPayload(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    if (Number(parsed.version) !== SUGGESTED_ACTION_STORAGE_VERSION) return null;
    const draft = normalizePersistedDraft(parsed.draft);
    if (!draft) return null;
    return {
      version: SUGGESTED_ACTION_STORAGE_VERSION,
      savedAt: Number.isFinite(Number(parsed.savedAt)) ? Number(parsed.savedAt) : Date.now(),
      sourceMessageId: normalizeSourceMessageId(parsed.sourceMessageId),
      draft,
    };
  } catch {
    return null;
  }
}

export function readPersistedSuggestedAction() {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(SUGGESTED_ACTION_STORAGE_KEY);
  if (!raw) return null;
  const parsed = parsePersistedPayload(raw);
  if (!parsed) {
    storage.removeItem(SUGGESTED_ACTION_STORAGE_KEY);
    return null;
  }
  return {
    sourceMessageId: parsed.sourceMessageId,
    draft: parsed.draft,
  };
}

export function writePersistedSuggestedAction(state) {
  const storage = getStorage();
  if (!storage) return false;
  const draft = normalizePersistedDraft(state?.draft);
  if (!draft) {
    storage.removeItem(SUGGESTED_ACTION_STORAGE_KEY);
    return false;
  }
  const payload = {
    version: SUGGESTED_ACTION_STORAGE_VERSION,
    savedAt: Date.now(),
    sourceMessageId: normalizeSourceMessageId(state?.sourceMessageId),
    draft,
  };
  storage.setItem(SUGGESTED_ACTION_STORAGE_KEY, JSON.stringify(payload));
  return true;
}

export function clearPersistedSuggestedAction() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(SUGGESTED_ACTION_STORAGE_KEY);
}
