import { describe, expect, it } from "vitest";

import { getCoachAccessState } from "../src/features/coach/coachAccess";

describe("coach access", () => {
  it("blocks chat when key is missing", () => {
    const state = getCoachAccessState({ hasKey: false, keyStatus: "missing" });
    expect(state.canChat).toBe(false);
    expect(state.status).toBe("missing");
  });

  it("blocks chat when key is invalid", () => {
    const state = getCoachAccessState({ hasKey: true, keyStatus: "invalid" });
    expect(state.canChat).toBe(false);
    expect(state.message).toMatch(/rejected/i);
  });

  it("allows chat when key is present", () => {
    const state = getCoachAccessState({ hasKey: true, keyStatus: "valid" });
    expect(state.canChat).toBe(true);
    expect(state.message).toMatch(/saved on this device/i);
  });
});
