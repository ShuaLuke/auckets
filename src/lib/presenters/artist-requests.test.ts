import { describe, expect, it } from "vitest";

import type { ArtistRequestInboxRow } from "@/lib/db/repositories";

import { presentArtistRequestInboxRow } from "./artist-requests";

const NOW = new Date("2026-05-27T12:00:00Z");

function makeRow(overrides: Partial<ArtistRequestInboxRow> = {}): ArtistRequestInboxRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    requestedBy: "user_2cope",
    kind: "comp",
    details: "Comp 4 to my manager",
    status: "open",
    executedBy: null,
    executedAt: null,
    notes: null,
    createdAt: new Date("2026-05-27T11:50:00Z"),
    filerEmail: "cope@auckets.com",
    showVenueName: "Lincoln Theatre",
    showVenueCity: "Washington, DC",
    showDoorsAt: new Date("2026-06-15T23:00:00Z"),
    artistId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    artistName: "Citizen Cope",
    ...overrides,
  };
}

describe("presentArtistRequestInboxRow", () => {
  it("maps kind to a human label and includes show context", () => {
    const view = presentArtistRequestInboxRow(makeRow(), null, NOW);
    expect(view.kindLabel).toBe("Comp guests");
    expect(view.showContext).toBe(
      "Citizen Cope · Washington, DC · Lincoln Theatre · Mon · Jun 15 · 7pm",
    );
    expect(view.filerEmail).toBe("cope@auckets.com");
    expect(view.filedTimeAgo).toBe("10m ago");
  });

  it("omits the city segment when venue.city is null", () => {
    const view = presentArtistRequestInboxRow(
      makeRow({ showVenueCity: null }),
      null,
      NOW,
    );
    expect(view.showContext).toBe(
      "Citizen Cope · Lincoln Theatre · Mon · Jun 15 · 7pm",
    );
  });

  it("returns executor=null on an open row", () => {
    const view = presentArtistRequestInboxRow(makeRow(), null, NOW);
    expect(view.executor).toBeNull();
    expect(view.status).toBe("open");
  });

  it("surfaces executor info on actioned rows", () => {
    const view = presentArtistRequestInboxRow(
      makeRow({
        status: "executed",
        executedBy: "user_2admin",
        executedAt: new Date("2026-05-27T11:58:00Z"),
        notes: "Comped row F seats 5-8.",
      }),
      "ops@auckets.com",
      NOW,
    );
    expect(view.executor).toEqual({
      email: "ops@auckets.com",
      timeAgo: "2m ago",
      display: "Wed · May 27 · 7:58am",
      notes: "Comped row F seats 5-8.",
    });
  });

  it("falls back to the executor user_id when the email lookup is missing", () => {
    const view = presentArtistRequestInboxRow(
      makeRow({
        status: "denied",
        executedBy: "user_2admin",
        executedAt: new Date("2026-05-27T11:58:00Z"),
        notes: "Can't comp inside binding.",
      }),
      null,
      NOW,
    );
    expect(view.executor?.email).toBe("user_2admin");
  });

  it("uses every supported kind label", () => {
    for (const kind of ["comp", "override", "pause", "end_early"] as const) {
      const view = presentArtistRequestInboxRow(makeRow({ kind }), null, NOW);
      expect(view.kindLabel).not.toBe(kind);
      expect(view.kindLabel.length).toBeGreaterThan(3);
    }
  });
});
