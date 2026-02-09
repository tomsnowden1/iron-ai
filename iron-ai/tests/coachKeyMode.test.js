import { describe, expect, it } from "vitest";

import { resolveCoachKeyMode } from "../src/config/coachKeyMode";

describe("coach key mode", () => {
  it("defaults to server for missing or invalid values", () => {
    expect(resolveCoachKeyMode(undefined)).toBe("server");
    expect(resolveCoachKeyMode("")).toBe("server");
    expect(resolveCoachKeyMode("client")).toBe("server");
  });

  it("accepts explicit user and server modes", () => {
    expect(resolveCoachKeyMode("user")).toBe("user");
    expect(resolveCoachKeyMode("server")).toBe("server");
    expect(resolveCoachKeyMode(" USER ")).toBe("user");
  });
});

