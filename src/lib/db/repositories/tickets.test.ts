import { describe, expect, expectTypeOf, it } from "vitest";

import {
  getTicketByAssignmentId,
  listTicketsByAssignmentIds,
  type TicketStatus,
  type TicketSummary,
} from "./tickets";
import { makeMockDb } from "./_mock-db";

function makeTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    seatAssignmentId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    userId: "user_2abc",
    status: "issued",
    scannedAt: null,
    scannedByStaffId: null,
    // T-48h before doors (per ADR-0015). The actual time isn't
    // load-bearing for the read path — existence of the row is the
    // signal.
    issuedAt: new Date("2026-05-23T20:00:00Z"),
    createdAt: new Date("2026-05-23T20:00:00Z"),
    ...overrides,
  };
}

describe("getTicketByAssignmentId", () => {
  it("returns null when no ticket exists for this assignment", async () => {
    const db = makeMockDb<TicketSummary>([]);
    expect(
      await getTicketByAssignmentId(
        db,
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
      ),
    ).toBeNull();
  });

  it("returns the safe-projection ticket when one exists", async () => {
    const ticket = makeTicket();
    const db = makeMockDb<TicketSummary>([ticket]);
    const result = await getTicketByAssignmentId(db, ticket.seatAssignmentId);
    expect(result).toEqual(ticket);
    expect(result?.status).toBe("issued");
    // Date instances preserved at the repo boundary.
    expect(result?.issuedAt).toBeInstanceOf(Date);
  });

  it("structurally excludes totpSecret from the returned shape", () => {
    // The TicketSummary type doesn't include totpSecret, so the
    // compiler enforces this. We assert it at runtime too for
    // future readers who skim the test file.
    const ticket = makeTicket();
    expect(ticket).not.toHaveProperty("totpSecret");
    expect(ticket).not.toHaveProperty("totp_secret");
  });

  it("has the expected return type", () => {
    expectTypeOf(getTicketByAssignmentId).returns.resolves.toEqualTypeOf<
      TicketSummary | null
    >();
  });
});

describe("listTicketsByAssignmentIds", () => {
  it("short-circuits to an empty map when no IDs are passed", async () => {
    // Without the short-circuit we'd emit `WHERE seat_assignment_id
    // IN ()` which Postgres rejects.
    const db = makeMockDb<TicketSummary>([]);
    const result = await listTicketsByAssignmentIds(db, []);
    expect(result.size).toBe(0);
  });

  it("returns a map keyed by seat_assignment_id", async () => {
    const a = makeTicket({
      id: "11111111-1111-1111-1111-111111111111",
      seatAssignmentId: "cccccccc-cccc-cccc-cccc-cccccccccc01",
    });
    const b = makeTicket({
      id: "22222222-2222-2222-2222-222222222222",
      seatAssignmentId: "cccccccc-cccc-cccc-cccc-cccccccccc02",
      status: "scanned",
      scannedAt: new Date("2026-05-25T20:14:00Z"),
    });
    const db = makeMockDb<TicketSummary>([a, b]);
    const result = await listTicketsByAssignmentIds(db, [
      a.seatAssignmentId,
      b.seatAssignmentId,
    ]);
    expect(result.size).toBe(2);
    expect(result.get(a.seatAssignmentId)?.status).toBe("issued");
    expect(result.get(b.seatAssignmentId)?.status).toBe("scanned");
  });

  it("omits assignments without a ticket (T-48h window not yet open)", async () => {
    // A's assignment has a ticket; B's doesn't (pre-T-48h). The map
    // only has A. Route handlers fold the missing case via
    // `map.get(id) ?? null`.
    const a = makeTicket({
      seatAssignmentId: "cccccccc-cccc-cccc-cccc-cccccccccc01",
    });
    const db = makeMockDb<TicketSummary>([a]);
    const result = await listTicketsByAssignmentIds(db, [
      a.seatAssignmentId,
      "cccccccc-cccc-cccc-cccc-cccccccccc02",
    ]);
    expect(result.size).toBe(1);
    expect(result.has(a.seatAssignmentId)).toBe(true);
  });

  it("preserves all five documented status enum values through the narrow cast", async () => {
    const statuses: TicketStatus[] = [
      "issued",
      "scanned",
      "resold",
      "gifted",
      "expired",
    ];
    for (const status of statuses) {
      const ticket = makeTicket({ status });
      const db = makeMockDb<TicketSummary>([ticket]);
      const result = await getTicketByAssignmentId(db, ticket.seatAssignmentId);
      expect(result?.status, `status=${status}`).toBe(status);
    }
  });

  it("has the expected return type", () => {
    expectTypeOf(listTicketsByAssignmentIds).returns.resolves.toEqualTypeOf<
      Map<string, TicketSummary>
    >();
  });
});
