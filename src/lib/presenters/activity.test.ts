import { describe, expect, it } from "vitest";

import type {
  AllocationLog,
  Offer,
  OfferRevision,
  VenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import {
  formatTimeAgo,
  presentRecentActivity,
  type ActivityEvent,
} from "./activity";

const NOW = new Date("2026-05-27T12:00:00Z");

function makeArch(rows: Partial<VenueRow>[]): Pick<VenueArchitecture, "rows"> {
  return {
    rows: rows.map((r, i) => ({
      id: r.id ?? `row_${i}`,
      area: r.area ?? "Orchestra",
      section: r.section ?? "Main",
      rowName: r.rowName ?? "A",
      rowRank: r.rowRank ?? i + 1,
      capacity: r.capacity ?? 8,
      parity: r.parity ?? "EVEN",
      lean: r.lean ?? "CENTER",
      seatNumbers: r.seatNumbers ?? ["1", "2"],
      holds: r.holds ?? [],
      ...(r.tier !== undefined ? { tier: r.tier } : {}),
    })) as unknown as VenueArchitecture["rows"],
  };
}

function makeLog(overrides: Partial<AllocationLog> = {}): AllocationLog {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    showId: "44444444-4444-4444-4444-444444444444",
    action: "PLACED",
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1234",
    venueRowId: "row_a",
    seatNumbers: null,
    reason: "ok",
    snapshot: {},
    mode: "preview",
    createdAt: new Date("2026-05-27T11:59:00Z"),
    ...overrides,
  } as AllocationLog;
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1234",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 4200,
    tierPreference: "this_or_worse",
    preferredTier: "premium",
    rankKey: BigInt(4200 * 1000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_test",
    stripeSetupIntentId: "seti_test",
    status: "pool",
    submittedAt: new Date("2026-05-27T11:58:00Z"),
    revisedAt: null,
    ...overrides,
  } as Offer;
}

// Builds an OfferRevision with sensible defaults. snapshot mirrors the
// shape upsertOfferForUser writes (see offers.ts §upsertOfferForUser).
function makeRevision(overrides: Partial<OfferRevision> = {}): OfferRevision {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1234",
    snapshot: {
      pricePerTicketCents: 4200,
      groupSize: 4,
      tierPreference: "this_or_worse",
      preferredTier: "premium",
      channel: "market",
      autoBidEnabled: false,
      autoBidCapCents: null,
      autoBidIncrementCents: 500,
      privateThresholdCents: null,
      status: "pool",
    },
    recordedAt: new Date("2026-05-27T11:00:00Z"),
    ...overrides,
  };
}

describe("formatTimeAgo", () => {
  it('returns "just now" for events less than a minute old', () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
  });
  it("formats minutes for events under an hour", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m ago");
    expect(formatTimeAgo(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe("59m ago");
  });
  it("formats hours for events under a day", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() - 2 * 60 * 60_000), NOW)).toBe("2h ago");
    expect(formatTimeAgo(new Date(NOW.getTime() - 23 * 60 * 60_000), NOW)).toBe("23h ago");
  });
  it("formats days for older events", () => {
    expect(
      formatTimeAgo(new Date(NOW.getTime() - 3 * 24 * 60 * 60_000), NOW),
    ).toBe("3d ago");
  });
});

describe("presentRecentActivity", () => {
  it("emits a 'new' event for each offer", () => {
    const events = presentRecentActivity([makeOffer()], [], null, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("new");
    expect(events[0]?.message).toBe("New offer · $42.00 × 4 · premium or below");
    expect(events[0]?.timeAgo).toBe("2m ago");
  });

  it("emits both 'new' and 'revised' events for a revised offer", () => {
    const offer = makeOffer({
      submittedAt: new Date("2026-05-27T10:00:00Z"),
      revisedAt: new Date("2026-05-27T11:50:00Z"),
    });
    const events = presentRecentActivity([offer], [], null, NOW);
    expect(events).toHaveLength(2);
    // Revised is newer → first.
    expect(events[0]?.kind).toBe("revised");
    expect(events[0]?.message).toMatch(/^Revision · offer_/);
    // No history passed → fallback "now" form.
    expect(events[0]?.message).toContain("now $42.00 × 4");
    expect(events[1]?.kind).toBe("new");
  });

  describe("revision diffs (offerHistoryByOfferId)", () => {
    const OFFER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1234";

    it("shows '$X → $Y × N' when price changed", () => {
      // Offer was $30 → revised to $42.
      const offer = makeOffer({
        pricePerTicketCents: 4200,
        groupSize: 4,
        revisedAt: new Date("2026-05-27T11:50:00Z"),
      });
      // history: [initial @$30, current @$42]
      const history = [
        makeRevision({ snapshot: { pricePerTicketCents: 3000, groupSize: 4 } }),
        makeRevision({ snapshot: { pricePerTicketCents: 4200, groupSize: 4 } }),
      ];
      const historyMap = new Map([[OFFER_ID, history]]);
      const events = presentRecentActivity([offer], [], null, NOW, 10, historyMap);
      const revised = events.find((e) => e.kind === "revised");
      expect(revised?.message).toMatch(/\$30\.00 → \$42\.00 × 4/);
    });

    it("shows '$Y × M → N' when only group size changed", () => {
      // Price stayed $42, group went 2 → 4.
      const offer = makeOffer({
        pricePerTicketCents: 4200,
        groupSize: 4,
        revisedAt: new Date("2026-05-27T11:50:00Z"),
      });
      const history = [
        makeRevision({ snapshot: { pricePerTicketCents: 4200, groupSize: 2 } }),
        makeRevision({ snapshot: { pricePerTicketCents: 4200, groupSize: 4 } }),
      ];
      const historyMap = new Map([[OFFER_ID, history]]);
      const events = presentRecentActivity([offer], [], null, NOW, 10, historyMap);
      const revised = events.find((e) => e.kind === "revised");
      expect(revised?.message).toContain("$42.00 × 2 → 4");
    });

    it("falls back to 'now' form when history has only 1 row", () => {
      // Only the initial submission row exists (shouldn't happen for a
      // revised offer, but defensive).
      const offer = makeOffer({
        pricePerTicketCents: 4200,
        groupSize: 4,
        revisedAt: new Date("2026-05-27T11:50:00Z"),
      });
      const history = [
        makeRevision({ snapshot: { pricePerTicketCents: 4200, groupSize: 4 } }),
      ];
      const historyMap = new Map([[OFFER_ID, history]]);
      const events = presentRecentActivity([offer], [], null, NOW, 10, historyMap);
      const revised = events.find((e) => e.kind === "revised");
      expect(revised?.message).toContain("now $42.00 × 4");
    });

    it("falls back to 'now' form when the offer is not in the history map", () => {
      // Map is non-empty but doesn't include this offer's ID.
      const offer = makeOffer({
        pricePerTicketCents: 4200,
        groupSize: 4,
        revisedAt: new Date("2026-05-27T11:50:00Z"),
      });
      const historyMap = new Map([["other-offer-id", [makeRevision()]]]);
      const events = presentRecentActivity([offer], [], null, NOW, 10, historyMap);
      const revised = events.find((e) => e.kind === "revised");
      expect(revised?.message).toContain("now $42.00 × 4");
    });
  });

  it("uses composer-matching tier labels", () => {
    const specific = makeOffer({ tierPreference: "specific", preferredTier: "premium" });
    const worse = makeOffer({ tierPreference: "this_or_worse", preferredTier: "premium" });
    const any = makeOffer({ tierPreference: "any", preferredTier: null });
    expect(presentRecentActivity([specific], [], null, NOW)[0]?.message).toContain(
      "premium only",
    );
    expect(presentRecentActivity([worse], [], null, NOW)[0]?.message).toContain(
      "premium or below",
    );
    expect(presentRecentActivity([any], [], null, NOW)[0]?.message).toContain("anywhere");
  });

  it("sorts events by `at` descending across multiple offers", () => {
    const olderOffer = makeOffer({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      submittedAt: new Date("2026-05-27T10:00:00Z"),
    });
    const newerOffer = makeOffer({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      submittedAt: new Date("2026-05-27T11:55:00Z"),
    });
    const events = presentRecentActivity([olderOffer, newerOffer], [], null, NOW);
    expect(events[0]?.at.toISOString()).toBe("2026-05-27T11:55:00.000Z");
    expect(events[1]?.at.toISOString()).toBe("2026-05-27T10:00:00.000Z");
  });

  it("respects the limit parameter", () => {
    const offers: Offer[] = Array.from({ length: 15 }, (_, i) =>
      makeOffer({
        id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`,
        submittedAt: new Date(NOW.getTime() - (i + 1) * 60_000),
      }),
    );
    const events: ActivityEvent[] = presentRecentActivity(offers, [], null, NOW, 5);
    expect(events).toHaveLength(5);
  });

  describe("allocation log events", () => {
    it("maps a PLACED log to a 'placed' activity event with row name", () => {
      const arch = makeArch([{ id: "row_a", rowName: "A" }]);
      const events = presentRecentActivity(
        [],
        [makeLog({ action: "PLACED", venueRowId: "row_a" })],
        arch,
        NOW,
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("placed");
      expect(events[0]?.message).toMatch(/^Placed · offer_/);
      expect(events[0]?.message).toContain("Row A");
    });

    it("maps an ORPHAN_DETECTED log to an 'orphan' event", () => {
      const arch = makeArch([{ id: "row_b", rowName: "B" }]);
      const events = presentRecentActivity(
        [],
        [
          makeLog({
            action: "ORPHAN_DETECTED",
            venueRowId: "row_b",
            offerId: null,
            reason: "isolated_seat",
          }),
        ],
        arch,
        NOW,
      );
      expect(events[0]?.kind).toBe("orphan");
      expect(events[0]?.message).toBe("Orphan · Row B · isolated_seat");
    });

    it("maps a SKIPPED log to a 'skipped' event with the reason", () => {
      const events = presentRecentActivity(
        [],
        [makeLog({ action: "SKIPPED", reason: "no_compatible_tier" })],
        null,
        NOW,
      );
      expect(events[0]?.kind).toBe("skipped");
      expect(events[0]?.message).toContain("no_compatible_tier");
    });

    it("falls back to the raw rowId when architecture isn't provided", () => {
      const events = presentRecentActivity(
        [],
        [makeLog({ action: "PLACED", venueRowId: "row_z" })],
        null,
        NOW,
      );
      expect(events[0]?.message).toContain("Row row_z");
    });

    it("interleaves offer and log events sorted by `at` DESC", () => {
      const arch = makeArch([{ id: "row_a", rowName: "A" }]);
      const offer = makeOffer({
        submittedAt: new Date("2026-05-27T11:50:00Z"),
      });
      const log = makeLog({
        action: "PLACED",
        createdAt: new Date("2026-05-27T11:55:00Z"),
      });
      const events = presentRecentActivity([offer], [log], arch, NOW);
      expect(events).toHaveLength(2);
      // PLACED is newer → first
      expect(events[0]?.kind).toBe("placed");
      expect(events[1]?.kind).toBe("new");
    });

    it("respects the limit when offers + logs together exceed it", () => {
      const offers = Array.from({ length: 6 }, (_, i) =>
        makeOffer({
          id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`,
          submittedAt: new Date(NOW.getTime() - (i + 1) * 60_000),
        }),
      );
      const logs = Array.from({ length: 6 }, (_, i) =>
        makeLog({
          id: `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`,
          createdAt: new Date(NOW.getTime() - (i + 1) * 30_000),
        }),
      );
      const events = presentRecentActivity(offers, logs, null, NOW, 5);
      expect(events).toHaveLength(5);
    });
  });
});
