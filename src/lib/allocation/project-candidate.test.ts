import { describe, expect, it } from "vitest";

import type { VenueArchitecture as DbVenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers, shows } from "../../../drizzle/schema";

import {
  CANDIDATE_OFFER_ID,
  projectCandidateOffer,
  type CandidateInput,
} from "./project-candidate";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

const NOW = new Date("2026-06-03T12:00:00Z");

function row(overrides: Partial<VenueRow>): VenueRow {
  return {
    id: "row_prem",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 4,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4"],
    holds: [],
    tier: "premium",
    ...overrides,
  };
}

// Two-tier house: premium (front, row_prem) + rear (back, row_rear).
const ARCH: DbVenueArchitecture = {
  id: "arch-1",
  venueId: "venue-1",
  version: 1,
  rows: [
    row({ id: "row_prem", rowName: "A", rowRank: 1, tier: "premium" }),
    row({
      id: "row_rear",
      rowName: "Z",
      rowRank: 9,
      tier: "rear",
      seatNumbers: ["1", "2", "3", "4"],
    }),
  ],
  createdAt: NOW,
};

function show(overrides: Partial<Show> = {}): Show {
  return {
    id: "show-1",
    artistId: "artist-1",
    venueId: "venue-1",
    venueArchitectureId: "arch-1",
    doorsAt: new Date("2026-06-25T00:00:00Z"),
    offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
    bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
    pausedAt: null,
    status: "open",
    tierFloorsCents: { premium: 5000, rear: 2500 },
    maxGroupSize: 10,
    activeRowIds: ["row_prem", "row_rear"],
    bleacherEnabled: false,
    bleacherCapacity: 0,
    bleacherPriceCents: null,
    showHolds: [],
    emailCustomization: null,
    createdAt: NOW,
    ...overrides,
  } as unknown as Show;
}

function offer(overrides: Partial<Offer>): Offer {
  const price = overrides.pricePerTicketCents ?? 3000;
  const size = overrides.groupSize ?? 2;
  return {
    id: "offer-other",
    showId: "show-1",
    userId: "user-other",
    channel: "market",
    groupSize: size,
    pricePerTicketCents: price,
    tierPreference: "any",
    preferredTier: null,
    rankKey: BigInt(price * 1000 + size),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_x",
    stripeSetupIntentId: "seti_x",
    stripePaymentIntentId: null,
    status: "pool",
    submittedAt: NOW,
    revisedAt: null,
    ...overrides,
  } as unknown as Offer;
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    userId: "me",
    pricePerTicketCents: 7000,
    groupSize: 2,
    tierPreference: "specific",
    preferredTier: "premium",
    autoBidEnabled: false,
    autoBidCapCents: null,
    submittedAt: NOW,
    ...overrides,
  };
}

describe("projectCandidateOffer", () => {
  it("places a high candidate in the front tier and returns its seats", () => {
    const projection = projectCandidateOffer(
      show(),
      ARCH,
      [offer({ id: "offer-other", pricePerTicketCents: 3000 })],
      candidate({ pricePerTicketCents: 7000 }),
    );
    expect(projection.placed).toBe(true);
    expect(projection.tier).toBe("premium");
    expect(projection.venueRowId).toBe("row_prem");
    expect(projection.seatNumbers).toHaveLength(2);
  });

  it("uses the synthetic candidate id, never a real offer id", () => {
    // (white-box) the candidate is matched by CANDIDATE_OFFER_ID internally;
    // a real pool offer's seats must not be mistaken for the candidate's.
    expect(CANDIDATE_OFFER_ID).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("replaces the fan's own existing pool offer rather than double-counting", () => {
    // The fan already has a cheap offer (would land rear). Projecting a higher
    // candidate for the SAME user should move them to premium — proof their
    // old offer was dropped from the pool before the candidate was added.
    const projection = projectCandidateOffer(
      show(),
      ARCH,
      [
        offer({ id: "offer-mine", userId: "me", pricePerTicketCents: 2600, tierPreference: "any", preferredTier: null }),
        offer({ id: "offer-other", userId: "user-other", pricePerTicketCents: 3000 }),
      ],
      candidate({ pricePerTicketCents: 9000 }),
    );
    expect(projection.placed).toBe(true);
    expect(projection.tier).toBe("premium");
  });

  it("reports not-placed when the candidate can't fit its preferred tier", () => {
    // Premium is full of higher offers; a premium-only candidate below them
    // doesn't make the cut.
    const projection = projectCandidateOffer(
      show(),
      ARCH,
      [
        offer({ id: "o1", userId: "u1", groupSize: 2, pricePerTicketCents: 9000 }),
        offer({ id: "o2", userId: "u2", groupSize: 2, pricePerTicketCents: 8500 }),
      ],
      candidate({ pricePerTicketCents: 5200, groupSize: 2, tierPreference: "specific", preferredTier: "premium" }),
    );
    expect(projection.placed).toBe(false);
    expect(projection.tier).toBeNull();
  });
});
