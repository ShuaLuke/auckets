import { describe, expect, it } from "vitest";

import { rotationWindow, secondsUntilRotation } from "./token";

describe("rotationWindow", () => {
  it("buckets epoch-ms into 60s windows", () => {
    expect(rotationWindow(0)).toBe(0);
    expect(rotationWindow(59_999)).toBe(0);
    expect(rotationWindow(60_000)).toBe(1);
    expect(rotationWindow(120_000)).toBe(2);
  });
});

describe("secondsUntilRotation", () => {
  it("counts down 60 -> 1 across a window and resets at the boundary", () => {
    expect(secondsUntilRotation(0)).toBe(60);
    expect(secondsUntilRotation(1_000)).toBe(59);
    expect(secondsUntilRotation(59_000)).toBe(1);
    expect(secondsUntilRotation(59_999)).toBe(1);
    expect(secondsUntilRotation(60_000)).toBe(60);
  });

  it("never returns 0", () => {
    for (let ms = 0; ms < 60_000; ms += 137) {
      expect(secondsUntilRotation(ms)).toBeGreaterThanOrEqual(1);
    }
  });
});
