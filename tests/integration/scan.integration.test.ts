// Integration coverage for processTicketScan — the door-scan decision flow
// (Scanner, ADR-0015) against a real Postgres. Drives valid/invalid/expired/
// replay/unknown scans and asserts the ticket state transition + the
// append-only ticket_scans audit row.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { processTicketScan } from "@/lib/tickets/scan";
import { generateTicketToken } from "@/lib/tickets/token";
import {
  offers,
  seatAssignments,
  ticketScans,
  tickets,
} from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

const SECRET = "scan_test_secret_high_entropy_0001";

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

// A charged seat with an issued ticket carrying a known secret.
async function seedIssuedTicket() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
    status: "allocated",
  });
  const fan = await seedUser();
  const [offer] = await db
    .insert(offers)
    .values({
      showId: show.id,
      userId: fan.id,
      groupSize: 2,
      pricePerTicketCents: 6000,
      tierPreference: "any",
      stripePaymentMethodId: "pm_stub",
      stripePaymentIntentId: "pi_stub",
      status: "charged",
    })
    .returning();
  if (!offer) throw new Error("seedIssuedTicket: no offer");
  const [seat] = await db
    .insert(seatAssignments)
    .values({
      offerId: offer.id,
      showId: show.id,
      venueRowId: "row_a",
      seatNumbers: ["1", "2"],
      tier: "premium",
      isBinding: true,
    })
    .returning();
  if (!seat) throw new Error("seedIssuedTicket: no seat");
  const [ticket] = await db
    .insert(tickets)
    .values({ seatAssignmentId: seat.id, userId: fan.id, totpSecret: SECRET })
    .returning();
  if (!ticket) throw new Error("seedIssuedTicket: no ticket");
  return { ticketId: ticket.id, fanId: fan.id };
}

function scansFor(staffId: string) {
  return db
    .select()
    .from(ticketScans)
    .where(eq(ticketScans.scannedByStaffId, staffId));
}

describe("processTicketScan (integration)", () => {
  it("admits a valid token and marks the ticket scanned", async () => {
    const { ticketId } = await seedIssuedTicket();
    const staff = await seedUser();
    const { token } = generateTicketToken(ticketId, SECRET);

    const outcome = await processTicketScan(db, { token, staffId: staff.id });
    expect(outcome.result).toBe("ok");

    const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(t?.status).toBe("scanned");
    expect(t?.scannedByStaffId).toBe(staff.id);
    expect(t?.scannedAt).toBeInstanceOf(Date);

    const scans = await scansFor(staff.id);
    expect(scans).toHaveLength(1);
    expect(scans[0]?.result).toBe("ok");
    expect(scans[0]?.ticketId).toBe(ticketId);
  });

  it("flags a second scan of the same ticket as a replay", async () => {
    const { ticketId } = await seedIssuedTicket();
    const staff = await seedUser();
    const { token } = generateTicketToken(ticketId, SECRET);

    await processTicketScan(db, { token, staffId: staff.id });
    // A fresh token (next second) for the same, now-scanned ticket.
    const { token: again } = generateTicketToken(ticketId, SECRET);
    const replay = await processTicketScan(db, { token: again, staffId: staff.id });

    expect(replay.result).toBe("replay");
    const scans = await scansFor(staff.id);
    expect(scans.map((s) => s.result).sort()).toEqual(["ok", "replay"]);
  });

  it("rejects an expired token without admitting the ticket", async () => {
    const { ticketId } = await seedIssuedTicket();
    const staff = await seedUser();
    // Signed five minutes ago — well past the skew allowance.
    const { token } = generateTicketToken(ticketId, SECRET, Date.now() - 5 * 60_000);

    const outcome = await processTicketScan(db, { token, staffId: staff.id });
    expect(outcome.result).toBe("expired_token");

    const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(t?.status).toBe("issued"); // not admitted
  });

  it("rejects a token signed with the wrong secret as invalid", async () => {
    const { ticketId } = await seedIssuedTicket();
    const staff = await seedUser();
    const { token } = generateTicketToken(ticketId, "the_wrong_secret_xxxxxxxxxxxxxxx");

    const outcome = await processTicketScan(db, { token, staffId: staff.id });
    expect(outcome.result).toBe("invalid");

    const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(t?.status).toBe("issued");
  });

  it("logs a malformed token with no ticket reference", async () => {
    const staff = await seedUser();
    const outcome = await processTicketScan(db, { token: "garbage", staffId: staff.id });
    expect(outcome).toMatchObject({ result: "invalid", reason: "malformed", ticketId: null });

    const [scan] = await scansFor(staff.id);
    expect(scan?.result).toBe("invalid");
    expect(scan?.ticketId).toBeNull();
  });

  it("logs an unknown ticket id as invalid with a null reference", async () => {
    const staff = await seedUser();
    // Well-formed token shape, but the id isn't a real ticket.
    const { token } = generateTicketToken(
      "99999999-9999-9999-9999-999999999999",
      SECRET,
    );
    const outcome = await processTicketScan(db, { token, staffId: staff.id });
    expect(outcome).toMatchObject({ result: "invalid", reason: "unknown_ticket" });

    const [scan] = await scansFor(staff.id);
    expect(scan?.ticketId).toBeNull();
  });
});
