import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SUGGESTED_ACTION_STORAGE_KEY,
  clearPersistedSuggestedAction,
  readPersistedSuggestedAction,
  writePersistedSuggestedAction,
} from "../src/features/coach/suggestedActionStorage";

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
}

const sampleDraft = {
  kind: "create_workout",
  confidence: 0.9,
  risk: "low",
  title: "Push Workout",
  summary: "Push-focused workout draft.",
  payload: {
    name: "Push Workout",
    gymId: 2,
    exercises: [
      {
        exerciseId: 11,
        sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }],
      },
    ],
  },
};

describe("suggested action storage", () => {
  let originalLocalStorage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it("reads a valid persisted suggested action payload", () => {
    const writeResult = writePersistedSuggestedAction({
      sourceMessageId: 77,
      draft: sampleDraft,
    });
    expect(writeResult).toBe(true);

    const restored = readPersistedSuggestedAction();
    expect(restored?.sourceMessageId).toBe(77);
    expect(restored?.draft?.title).toBe("Push Workout");
    expect(restored?.draft?.payload?.exercises?.length).toBe(1);
  });

  it("clears malformed payloads safely", () => {
    globalThis.localStorage.setItem(SUGGESTED_ACTION_STORAGE_KEY, "{not json");
    const restored = readPersistedSuggestedAction();
    expect(restored).toBeNull();
    expect(globalThis.localStorage.getItem(SUGGESTED_ACTION_STORAGE_KEY)).toBeNull();
  });

  it("clears persisted payload explicitly", () => {
    writePersistedSuggestedAction({
      sourceMessageId: 77,
      draft: sampleDraft,
    });
    clearPersistedSuggestedAction();
    expect(globalThis.localStorage.getItem(SUGGESTED_ACTION_STORAGE_KEY)).toBeNull();
  });
});
