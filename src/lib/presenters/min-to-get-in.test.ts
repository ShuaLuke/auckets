import { describe, expect, it } from "vitest";

import { presentMinToGetIn } from "./min-to-get-in";

const FLOORS = { premium: 4000, standard: 2500, bleacher: 1800 };

describe("presentMinToGetIn", () => {
  it("shows the marginal placed price as the live cutoff when the room is full", () => {
    const v = presentMinToGetIn(3200, FLOORS, 100, 100);
    expect(v.label).toBe("$32.00");
    expect(v.sub).toBe("to make the room");
    expect(v.isCutoff).toBe(true);
  });

  it("treats provisionalFilled > capacity as full (over-subscribed pool)", () => {
    const v = presentMinToGetIn(5000, FLOORS, 140, 100);
    expect(v.isCutoff).toBe(true);
    expect(v.label).toBe("$50.00");
  });

  it("falls back to the cheapest tier floor when seats remain", () => {
    const v = presentMinToGetIn(3200, FLOORS, 40, 100);
    expect(v.label).toBe("$18.00"); // min(4000, 2500, 1800)
    expect(v.sub).toBe("seats still open");
    expect(v.isCutoff).toBe(false);
  });

  it("uses the floor when nothing is placed yet, even if capacity is met-on-paper", () => {
    // No preview has run → marginalPlacedCents null → floor, not a cutoff.
    const v = presentMinToGetIn(null, FLOORS, 100, 100);
    expect(v.label).toBe("$18.00");
    expect(v.isCutoff).toBe(false);
  });

  it("ignores the cutoff when capacity is unknown (0) and shows the floor", () => {
    const v = presentMinToGetIn(3200, FLOORS, 0, 0);
    expect(v.label).toBe("$18.00");
    expect(v.isCutoff).toBe(false);
  });

  it("degrades to em-dash when there is neither a placement nor any floor", () => {
    const v = presentMinToGetIn(null, {}, 0, 0);
    expect(v.label).toBe("—");
    expect(v.sub).toBe("minimum offer");
    expect(v.isCutoff).toBe(false);
  });
});
