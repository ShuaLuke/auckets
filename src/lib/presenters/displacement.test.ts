import { describe, expect, it } from "vitest";

import type { DisplacementEvent } from "@/lib/db/repositories";

import { presentDisplacementEvents } from "./displacement";

function makeEvent(overrides: Partial<DisplacementEvent> = {}): DisplacementEvent {
  return {
    id: "evt_1",
    showId: "44444444-4444-4444-4444-444444444444",
    offerId: "55555555-5555-5555-5555-555555555555",
    userId: "user_1",
    kind: "outbid_out",
    detail: {},
    acknowledgedAt: null,
    createdAt: new Date("2026-05-29T12:00:00Z"),
    ...overrides,
  };
}

describe("presentDisplacementEvents", () => {
  it("frames an auto_bid_raise with the raised amount, section, and original offer", () => {
    const [view] = presentDisplacementEvents([
      makeEvent({
        kind: "auto_bid_raise",
        detail: { fromCents: 5000, toCents: 6500, steps: 3, tier: "premium" },
      }),
    ]);
    expect(view?.tone).toBe("info");
    expect(view?.headline).toBe("Auto-bid kept your spot");
    expect(view?.body).toBe(
      "Your auto-bid raised you to $65.00 to hold Premium (from your $50.00 offer).",
    );
  });

  it("frames a downward section_change as a warning", () => {
    const [view] = presentDisplacementEvents([
      makeEvent({
        kind: "section_change",
        detail: { fromTier: "premium", toTier: "mid", direction: "worse" },
      }),
    ]);
    expect(view?.tone).toBe("warning");
    expect(view?.headline).toBe("You moved sections");
    expect(view?.body).toContain("now projected in Mid, down from Premium");
  });

  it("frames an upward section_change as positive", () => {
    const [view] = presentDisplacementEvents([
      makeEvent({
        kind: "section_change",
        detail: { fromTier: "mid", toTier: "premium", direction: "better" },
      }),
    ]);
    expect(view?.tone).toBe("positive");
    expect(view?.headline).toBe("You moved up");
    expect(view?.body).toContain("now projected in Premium, up from Mid");
  });

  it("frames outbid_out as a warning naming the prior section", () => {
    const [view] = presentDisplacementEvents([
      makeEvent({ kind: "outbid_out", detail: { fromTier: "premium" } }),
    ]);
    expect(view?.tone).toBe("warning");
    expect(view?.headline).toBe("You're not in the projection right now");
    expect(view?.body).toContain("you were in Premium");
  });

  it("degrades gracefully when detail fields are missing", () => {
    const [view] = presentDisplacementEvents([
      makeEvent({ kind: "auto_bid_raise", detail: {} }),
    ]);
    // No fromCents → no "(from …)" clause; no tier → "the event".
    expect(view?.body).toBe(
      "Your auto-bid raised you to a higher amount to hold the event.",
    );
  });

  it("maps the row id through so the component can address the dismiss action", () => {
    const views = presentDisplacementEvents([
      makeEvent({ id: "evt_abc" }),
      makeEvent({ id: "evt_def" }),
    ]);
    expect(views.map((v) => v.id)).toEqual(["evt_abc", "evt_def"]);
  });
});
