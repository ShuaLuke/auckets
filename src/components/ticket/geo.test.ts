import { describe, expect, it } from "vitest";

import { haversineMeters, isWithinVenue } from "./geo";

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters({ lat: 40.7, lon: -74 }, { lat: 40.7, lon: -74 })).toBe(0);
  });

  it("approximates ~111m for a 0.001° latitude step", () => {
    // 0.001° of latitude is ~111.2m anywhere on Earth.
    const d = haversineMeters({ lat: 40.0, lon: -74.0 }, { lat: 40.001, lon: -74.0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(113);
  });

  it("is symmetric", () => {
    const a = { lat: 38.916, lon: -77.032 };
    const b = { lat: 38.92, lon: -77.04 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});

describe("isWithinVenue", () => {
  it("is true inside the radius and on the boundary", () => {
    expect(isWithinVenue(400, 500)).toBe(true);
    expect(isWithinVenue(500, 500)).toBe(true);
  });

  it("is false beyond the radius", () => {
    expect(isWithinVenue(501, 500)).toBe(false);
    expect(isWithinVenue(4200, 500)).toBe(false);
  });
});
