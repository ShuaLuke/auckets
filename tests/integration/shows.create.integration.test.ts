// Integration coverage for the ShowCreate write/read repo functions added
// alongside the form + POST /api/shows handler:
//
//   - createShow inserts a row in 'draft' with the editable inputs persisted
//     (tier floors, active rows, max group size) and the FKs honored.
//   - listVenues / listVenueArchitectures back the form's venue + seat-map
//     pickers; the latter must narrow the jsonb rows to a usable VenueRow[].
//
// Route-level validation (date ordering, ≤6-day window, tier-floor/active-row
// matching, authz) lives in the handler and isn't exercised here.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  createShow,
  listVenueArchitectures,
  listVenues,
} from "@/lib/db/repositories";
import { shows } from "../../drizzle/schema";

import { seedArtist, seedVenue, seedVenueArchitecture } from "./helpers";

describe("createShow (integration)", () => {
  it("inserts a draft show with editable inputs persisted", async () => {
    const artist = await seedArtist();
    const venue = await seedVenue();
    const architecture = await seedVenueArchitecture(venue.id);

    const now = new Date();
    const offerWindowOpensAt = new Date(now.getTime() + 60 * 60 * 1000);
    const bindingAllocationAt = new Date(
      now.getTime() + 5 * 24 * 60 * 60 * 1000,
    );
    const doorsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000 + 3_600_000);

    const created = await createShow(db, {
      artistId: artist.id,
      venueId: venue.id,
      venueArchitectureId: architecture.id,
      offerWindowOpensAt,
      bindingAllocationAt,
      doorsAt,
      tierFloorsCents: { premium: 6000 },
      activeRowIds: ["row_a"],
      maxGroupSize: 8,
    });

    // Born a draft — creation never opens an offer window.
    expect(created.status).toBe("draft");
    expect(created.artistId).toBe(artist.id);
    expect(created.maxGroupSize).toBe(8);
    expect(created.tierFloorsCents).toEqual({ premium: 6000 });
    expect(created.activeRowIds).toEqual(["row_a"]);

    // Round-trip from the DB to confirm it actually persisted.
    const fetched = await db
      .select()
      .from(shows)
      .where(eq(shows.id, created.id))
      .limit(1);
    expect(fetched[0]?.status).toBe("draft");
    expect(fetched[0]?.tierFloorsCents).toEqual({ premium: 6000 });
  });
});

describe("listVenues / listVenueArchitectures (integration)", () => {
  it("returns seeded venues name-ordered", async () => {
    await seedVenue({ name: "Zebra Hall" });
    await seedVenue({ name: "Apollo" });

    const venues = await listVenues(db);
    const names = venues.map((v) => v.name);
    // Both present, and Apollo sorts before Zebra Hall.
    expect(names).toContain("Apollo");
    expect(names).toContain("Zebra Hall");
    expect(names.indexOf("Apollo")).toBeLessThan(names.indexOf("Zebra Hall"));
  });

  it("returns architectures with rows narrowed to VenueRow[]", async () => {
    const venue = await seedVenue();
    const arch = await seedVenueArchitecture(venue.id);

    const all = await listVenueArchitectures(db);
    const mine = all.find((a) => a.id === arch.id);
    expect(mine).toBeDefined();
    expect(Array.isArray(mine?.rows)).toBe(true);
    expect(mine?.rows[0]?.id).toBe("row_a");
    expect(mine?.rows[0]?.tier).toBe("premium");
  });
});
