import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../src/db";
import {
  clearOpenAIKey,
  getOpenAIKeyMasked,
  getOpenAIKeyStatus,
  getSettings,
  hasOpenAIKey,
  setOpenAIKey,
} from "../src/state/settingsStore";

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
});
