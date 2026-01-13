import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../db";
import { testOpenAIKey as testOpenAIKeyRequest } from "../services/openai";

const SETTINGS_ID = 1;

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

export { SETTINGS_ID };
