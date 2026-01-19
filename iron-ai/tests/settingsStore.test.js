import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../src/db";
import {
  clearOpenAIKey,
  getCoachMemoryEnabled,
  getOpenAIKeyMasked,
  getOpenAIKeyStatus,
  getSettings,
  hasOpenAIKey,
  setCoachMemoryEnabled,
  setOpenAIKey,
} from "../src/state/settingsStore";

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

describe.sequential("settings store", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterAll(async () => {
    await db.delete();
    db.close();
  });

  it("persists and masks the OpenAI key", async () => {
    await setOpenAIKey("sk-test1234");

    const settings = await getSettings();
    expect(settings?.openai_api_key).toBe("sk-test1234");
    expect(hasOpenAIKey(settings)).toBe(true);
    expect(getOpenAIKeyStatus(settings)).toBe("unknown");
    expect(getOpenAIKeyMasked(settings?.openai_api_key)).toBe("sk-…1234");
  });

  it("clears the OpenAI key and status", async () => {
    await setOpenAIKey("sk-test1234");
    await clearOpenAIKey();

    const settings = await getSettings();
    expect(settings?.openai_api_key ?? "").toBe("");
    expect(hasOpenAIKey(settings)).toBe(false);
    expect(getOpenAIKeyStatus(settings)).toBe("missing");
  });

  it("persists coach memory enabled", async () => {
    await setCoachMemoryEnabled(true, { caller: "test" });
    expect(await getCoachMemoryEnabled()).toBe(true);

    const settings = await getSettings();
    expect(settings?.coach_memory_enabled).toBe(true);

    await setCoachMemoryEnabled(false, { caller: "test" });
    expect(await getCoachMemoryEnabled()).toBe(false);
  });

  it("migrates coach memory enabled from storage", async () => {
    const originalStorage = globalThis.localStorage;
    const memoryStorage = createMemoryStorage({ coachMemoryEnabled: "true" });
    globalThis.localStorage = memoryStorage;
    try {
      const value = await getCoachMemoryEnabled();
      expect(value).toBe(true);
      const settings = await getSettings();
      expect(settings?.coach_memory_enabled).toBe(true);
      expect(memoryStorage.getItem("ironai.coachMemoryEnabled")).toBe("true");
    } finally {
      if (originalStorage) {
        globalThis.localStorage = originalStorage;
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});
