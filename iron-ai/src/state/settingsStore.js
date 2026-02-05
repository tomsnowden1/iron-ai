import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../db";
import { testOpenAIKey as testOpenAIKeyRequest } from "../services/openai";

const SETTINGS_ID = 1;
const COACH_MEMORY_ENABLED_KEY = "ironai.coachMemoryEnabled";
const COACH_CHAT_STATE_VERSION = 1;
const MAX_COACH_MESSAGES = 80;
const MAX_COACH_HISTORY = 160;
const MAX_COACH_TEXT_LENGTH = 8000;
const LEGACY_COACH_MEMORY_ENABLED_KEYS = [
  "ironai.coach_memory_enabled",
  "coachMemoryEnabled",
  "coach_memory_enabled",
];

const COACH_MESSAGE_ROLES = new Set(["user", "assistant"]);
const COACH_HISTORY_ROLES = new Set(["user", "assistant", "tool"]);

function getLocalStorage() {
  if (typeof globalThis === "undefined") return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseStoredBoolean(raw) {
  if (raw == null) return { exists: false, value: false };
  if (raw === "true" || raw === "1") return { exists: true, value: true };
  if (raw === "false" || raw === "0") return { exists: true, value: false };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") return { exists: true, value: parsed };
  } catch {
    // Ignore invalid storage payloads.
  }
  return { exists: false, value: false };
}

function readCoachMemoryEnabledFromStorage() {
  const storage = getLocalStorage();
  if (!storage) return { exists: false, value: false, key: null };
  const keys = [COACH_MEMORY_ENABLED_KEY, ...LEGACY_COACH_MEMORY_ENABLED_KEYS];
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw == null) continue;
    const parsed = parseStoredBoolean(raw);
    if (parsed.exists) {
      return { exists: true, value: parsed.value, key };
    }
  }
  return { exists: false, value: false, key: null };
}

function writeCoachMemoryEnabledToStorage(value, sourceKey) {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.setItem(COACH_MEMORY_ENABLED_KEY, value ? "true" : "false");
  if (sourceKey && sourceKey !== COACH_MEMORY_ENABLED_KEY) {
    storage.removeItem(sourceKey);
  }
}

export function normalizeOpenAIKey(value) {
  return String(value ?? "").trim();
}

export function maskOpenAIKey(value) {
  const trimmed = normalizeOpenAIKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${trimmed[0] ?? ""}••••`;
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}…${suffix}`;
}

export function getOpenAIKeyMasked(value) {
  return maskOpenAIKey(value);
}

export function hasOpenAIKey(settings) {
  return Boolean(normalizeOpenAIKey(settings?.openai_api_key));
}

export function getOpenAIKeyStatus(settings) {
  if (!hasOpenAIKey(settings)) return "missing";
  return settings?.openai_api_key_status ?? "unknown";
}

export async function getSettings() {
  return db.settings.get(SETTINGS_ID);
}

export async function updateSettings(patch) {
  const current = await getSettings();
  await db.settings.put({ ...(current ?? {}), id: SETTINGS_ID, ...(patch ?? {}) });
}

export async function getCoachMemoryEnabled() {
  const settings = await getSettings();
  if (typeof settings?.coach_memory_enabled === "boolean") {
    return settings.coach_memory_enabled;
  }
  const stored = readCoachMemoryEnabledFromStorage();
  if (stored.exists) {
    await updateSettings({ coach_memory_enabled: stored.value });
    writeCoachMemoryEnabledToStorage(stored.value, stored.key);
    return stored.value;
  }
  return false;
}

export async function setCoachMemoryEnabled(nextValue, options = {}) {
  const value = Boolean(nextValue);
  if (import.meta.env.DEV) {
    console.debug("[coachMemory] set ->", value, "from", options?.caller ?? "unknown");
  }
  await updateSettings({ coach_memory_enabled: value });
  writeCoachMemoryEnabledToStorage(value);
  return value;
}

function truncateText(value) {
  const text = String(value ?? "");
  if (text.length <= MAX_COACH_TEXT_LENGTH) return text;
  return text.slice(0, MAX_COACH_TEXT_LENGTH);
}

function normalizeCoachMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = String(raw.role ?? "").trim();
  if (!COACH_MESSAGE_ROLES.has(role)) return null;
  return {
    id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : Date.now(),
    role,
    content: truncateText(raw.content),
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : null,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
  };
}

function normalizeToolCall(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.function?.name ?? raw.name ?? "").trim();
  if (!name) return null;
  return {
    id: String(raw.id ?? "").trim() || `tool_${Date.now()}`,
    type: "function",
    function: {
      name,
      arguments: truncateText(raw.function?.arguments ?? raw.arguments ?? ""),
    },
  };
}

function normalizeCoachHistoryMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = String(raw.role ?? "").trim();
  if (!COACH_HISTORY_ROLES.has(role)) return null;
  const normalized = {
    role,
    content: truncateText(raw.content),
  };
  if (role === "tool") {
    const toolCallId = String(raw.tool_call_id ?? "").trim();
    if (!toolCallId) return null;
    normalized.tool_call_id = toolCallId;
  }
  if (role === "assistant" && Array.isArray(raw.tool_calls)) {
    const toolCalls = raw.tool_calls
      .map((entry) => normalizeToolCall(entry))
      .filter(Boolean);
    if (toolCalls.length) {
      normalized.tool_calls = toolCalls;
      normalized.content = typeof raw.content === "string" ? truncateText(raw.content) : "";
    }
  }
  return normalized;
}

function normalizeCoachChatState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const messages = Array.isArray(state.messages)
    ? state.messages
        .map((entry) => normalizeCoachMessage(entry))
        .filter(Boolean)
        .slice(-MAX_COACH_MESSAGES)
    : [];
  const chatHistory = Array.isArray(state.chatHistory)
    ? state.chatHistory
        .map((entry) => normalizeCoachHistoryMessage(entry))
        .filter(Boolean)
        .slice(-MAX_COACH_HISTORY)
    : [];
  return {
    version: COACH_CHAT_STATE_VERSION,
    messages,
    chatHistory,
    savedAt: Date.now(),
  };
}

export async function getCoachChatState() {
  const settings = await getSettings();
  return normalizeCoachChatState(settings?.coach_chat_state);
}

export async function setCoachChatState(nextState) {
  const normalized = normalizeCoachChatState(nextState);
  await updateSettings({ coach_chat_state: normalized });
  return normalized;
}

export async function clearCoachChatState() {
  await updateSettings({
    coach_chat_state: null,
  });
}

export async function setOpenAIKey(nextKey) {
  const trimmed = normalizeOpenAIKey(nextKey);
  await updateSettings({
    openai_api_key: trimmed,
    openai_api_key_status: trimmed ? "unknown" : "missing",
    openai_api_key_last_tested_at: null,
  });
}

export async function clearOpenAIKey() {
  await updateSettings({
    openai_api_key: "",
    openai_api_key_status: "missing",
    openai_api_key_last_tested_at: null,
  });
}

export async function setOpenAIKeyStatus(status) {
  if (!status) return;
  await updateSettings({
    openai_api_key_status: status,
    openai_api_key_last_tested_at: Date.now(),
  });
}

export async function testOpenAIKey(apiKeyOverride) {
  const settings = await getSettings();
  const apiKey = normalizeOpenAIKey(apiKeyOverride ?? settings?.openai_api_key);
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      reason: "missing",
      message: "Add an OpenAI API key first.",
    };
  }

  try {
    await testOpenAIKeyRequest({ apiKey });
    await updateSettings({
      openai_api_key_status: "valid",
      openai_api_key_last_tested_at: Date.now(),
    });
    return {
      ok: true,
      status: 200,
      reason: "valid",
      message: "Success! Your key is working.",
    };
  } catch (error) {
    const status = error?.status ?? 0;
    let reason = "unknown";
    let message = "We could not reach OpenAI. Please try again.";

    if (status === 401 || status === 403) {
      reason = "invalid";
      message = "That key was rejected. Double-check and try again.";
    } else if (status === 429) {
      reason = "rate_limited";
      message = "OpenAI is rate limiting this key. Please wait and retry.";
    } else if (status >= 500) {
      reason = "server";
      message = "OpenAI is having issues right now. Please retry soon.";
    } else if (status === 0) {
      reason = "network";
      message = "Network error. Check your connection and retry.";
    }

    if (reason === "invalid") {
      await updateSettings({
        openai_api_key_status: "invalid",
        openai_api_key_last_tested_at: Date.now(),
      });
    }

    return { ok: false, status, reason, message };
  }
}

export function useSettings() {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const apiKey = normalizeOpenAIKey(settings?.openai_api_key);
  const hasKey = Boolean(apiKey);
  const keyStatus = getOpenAIKeyStatus(settings);

  return {
    settings,
    apiKey,
    hasKey,
    keyStatus,
    maskedOpenAIKey: maskOpenAIKey(apiKey),
    coachMemoryEnabled: Boolean(settings?.coach_memory_enabled),
  };
}

export function useCoachMemoryEnabled() {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), [], null);
  const [coachMemoryEnabled, setCoachMemoryEnabledState] = useState(() => {
    const stored = readCoachMemoryEnabledFromStorage();
    return stored.exists ? stored.value : undefined;
  });
  const migratedRef = useRef(false);

  useEffect(() => {
    if (settings === null) return;
    const settingsValue = settings?.coach_memory_enabled;
    if (typeof settingsValue === "boolean") {
      setCoachMemoryEnabledState(settingsValue);
      writeCoachMemoryEnabledToStorage(settingsValue);
      return;
    }
    const stored = readCoachMemoryEnabledFromStorage();
    if (stored.exists) {
      setCoachMemoryEnabledState(stored.value);
      writeCoachMemoryEnabledToStorage(stored.value, stored.key);
      if (!migratedRef.current) {
        migratedRef.current = true;
        void updateSettings({ coach_memory_enabled: stored.value });
      }
      return;
    }
    setCoachMemoryEnabledState(false);
  }, [settings]);

  const setEnabled = useCallback(async (nextValue, options = {}) => {
    const resolved = Boolean(nextValue);
    setCoachMemoryEnabledState(resolved);
    await setCoachMemoryEnabled(resolved, options);
    return resolved;
  }, []);

  return {
    coachMemoryEnabled,
    setCoachMemoryEnabled: setEnabled,
  };
}

export { SETTINGS_ID };
