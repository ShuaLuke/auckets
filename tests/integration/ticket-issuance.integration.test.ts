// Integration coverage for issueTicketsForDueShows — the ticket-issuance
// sweep (ADR-0015) against a real Postgres. Verifies it mints tickets for the
// paid seats of bound shows inside the T-48h horizon, skips everything else,
// and is idempotent.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { issueTicketsForDueShows } from "@/lib/tickets/issuance";
import { offers, seatAssignments, shows, tickets } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

const HOUR = 60 * 60 * 1000;

const ROW = [
  {
    id: "row_a",
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
    isGa: false,
  },
];

// An 'allocated' show with doors `doorsInHours` away.
async function seedAllocatedShow(doorsInHours: number) {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
    status: "allocated",
  });
  await db
    .update(shows)
    .set({ doorsAt: new Date(Date.now() + doorsInHours * HOUR) })
    .where(eq(shows.id, show.id));
  return show;
}

// A seat assignment for an offer in the given status (default 'charged').
async function seedSeat(showId: string, status = "charged") {
  const user = await seedUser();
  const [offer] = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: 2,
      pricePerTicketCents: 6000,
      tierPreference: "any",
      stripePaymentMethodId: "pm_stub",
      stripePaymentIntentId: "pi_stub",
      status,
    })
    .returning();
  if (!offer) throw new Error("seedSeat: no offer");
  const [seat] = await db
    .insert(seatAssignments)
    .values({
      offerId: offer.id,
      showId,
      venueRowId: "row_a",
      seatNumbers: ["1", "2"],
      tier: "premium",
      isBinding: true,
    })
    .returning();
  if (!seat) throw new Error("seedSeat: no seat");
  return { offerId: offer.id, seatAssignmentId: seat.id, userId: offer.userId };
}

function ticketsForSeat(seatAssignmentId: string) {
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.seatAssignmentId, seatAssignmentId));
}

describe("issueTicketsForDueShows (integration)", () => {
  it("issues a ticket with a secret for a charged seat of a due show", async () => {
    const show = await seedAllocatedShow(24); // within 48h
    const seat = await seedSeat(show.id, "charged");

    const result = await issueTicketsForDueShows(db, new Date());
    expect(result.ticketsIssued).toBe(1);

    const [ticket] = await ticketsForSeat(seat.seatAssignmentId);
    expect(ticket?.userId).toBe(seat.userId);
    expect(ticket?.status).toBe("issued");
    expect(typeof ticket?.totpSecret).toBe("string");
    expect((ticket?.totpSecret ?? "").length).toBeGreaterThan(20);
  });

  it("skips seats whose offer isn't charged", async () => {
    const show = await seedAllocatedShow(24);
    const charged = await seedSeat(show.id, "charged");
    const failed = await seedSeat(show.id, "card_failure");

    const result = await issueTicketsForDueShows(db, new Date());
    expect(result.ticketsIssued).toBe(1);

    expect(await ticketsForSeat(charged.seatAssignmentId)).toHaveLength(1);
    expect(await ticketsForSeat(failed.seatAssignmentId)).toHaveLength(0);
  });

  it("is idempotent — a second sweep issues nothing new", async () => {
    const show = await seedAllocatedShow(24);
    const seat = await seedSeat(show.id, "charged");

    const first = await issueTicketsForDueShows(db, new Date());
    expect(first.ticketsIssued).toBe(1);

    const second = await issueTicketsForDueShows(db, new Date());
    expect(second.ticketsIssued).toBe(0);
    expect(await ticketsForSeat(seat.seatAssignmentId)).toHaveLength(1);
  });

  it("does not issue for a show whose doors are beyond the 48h horizon", async () => {
    const show = await seedAllocatedShow(72); // outside the horizon
    const seat = await seedSeat(show.id, "charged");

    const result = await issueTicketsForDueShows(db, new Date());
    expect(result.ticketsIssued).toBe(0);
    expect(await ticketsForSeat(seat.seatAssignmentId)).toHaveLength(0);
  });

  it("does not issue for a show that isn't allocated yet", async () => {
    // 'open' show inside the time horizon — bound hasn't happened.
    const venue = await seedVenue();
    const arch = await seedVenueArchitecture(venue.id, { rows: ROW });
    const { show } = await seedShow({
      venueId: venue.id,
      venueArchitectureId: arch.id,
      status: "open",
    });
    await db
      .update(shows)
      .set({ doorsAt: new Date(Date.now() + 24 * HOUR) })
      .where(eq(shows.id, show.id));
    const seat = await seedSeat(show.id, "charged");

    const result = await issueTicketsForDueShows(db, new Date());
    expect(result.ticketsIssued).toBe(0);
    expect(await ticketsForSeat(seat.seatAssignmentId)).toHaveLength(0);
  });
});
