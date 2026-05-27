import { describe, expect, it } from "vitest";

import type { OfferRevision } from "@/lib/db/repositories";

import { presentOfferHistory } from "./revisions";

function rev(
  id: string,
  recordedAt: Date,
  snapshot: Record<string, unknown>,
): OfferRevision {
  return {
    id,
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    snapshot,
    recordedAt,
  };
}

describe("presentOfferHistory", () => {
  it("returns an empty view when there are no revisions", () => {
    const view = presentOfferHistory([]);
    expect(view.entries).toEqual([]);
  });

  it("renders the first row as 'submitted' with the initial state", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "specific",
        preferredTier: "premium",
      }),
    ]);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.kind).toBe("submitted");
    expect(view.entries[0]?.summary).toBe("$30.00 × 4 · premium only");
    expect(view.entries[0]?.changes).toEqual([]);
  });

  it("renders subsequent rows as 'revised' with diff lines", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "this_or_worse",
        preferredTier: "premium",
      }),
      rev("r2", new Date("2026-05-27T11:00:00Z"), {
        pricePerTicketCents: 4000,
        groupSize: 4,
        tierPreference: "this_or_worse",
        preferredTier: "premium",
      }),
    ]);
    expect(view.entries).toHaveLength(2);
    expect(view.entries[1]?.kind).toBe("revised");
    expect(view.entries[1]?.summary).toBe("$30.00 → $40.00");
    expect(view.entries[1]?.changes).toEqual(["$30.00 → $40.00"]);
  });

  it("surfaces a group-size change", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "any",
        preferredTier: null,
      }),
      rev("r2", new Date("2026-05-27T11:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 6,
        tierPreference: "any",
        preferredTier: null,
      }),
    ]);
    expect(view.entries[1]?.changes).toEqual(["size 4 → 6"]);
  });

  it("surfaces a tier change", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "this_or_worse",
        preferredTier: "premium",
      }),
      rev("r2", new Date("2026-05-27T11:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "any",
        preferredTier: null,
      }),
    ]);
    expect(view.entries[1]?.changes).toEqual([
      "tier premium or below → anywhere",
    ]);
  });

  it("renders multiple diffs in `changes`, with the first as the summary", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "this_or_worse",
        preferredTier: "premium",
      }),
      rev("r2", new Date("2026-05-27T11:00:00Z"), {
        pricePerTicketCents: 4500,
        groupSize: 6,
        tierPreference: "any",
        preferredTier: null,
      }),
    ]);
    expect(view.entries[1]?.summary).toBe("$30.00 → $45.00");
    expect(view.entries[1]?.changes).toEqual([
      "$30.00 → $45.00",
      "size 4 → 6",
      "tier premium or below → anywhere",
    ]);
  });

  it("falls back to a 'no visible changes' note when nothing rendered changed", () => {
    const view = presentOfferHistory([
      rev("r1", new Date("2026-05-27T10:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "any",
        preferredTier: null,
      }),
      rev("r2", new Date("2026-05-27T11:00:00Z"), {
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: "any",
        preferredTier: null,
        autoBidEnabled: true,
      }),
    ]);
    expect(view.entries[1]?.summary).toBe("Updated (no visible field changes)");
  });
});
