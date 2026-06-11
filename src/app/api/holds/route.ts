// POST /api/holds — file an artist-kind hold on a show. Per the
// schema comment in drizzle/schema.ts §17, artist-kind holds are the
// "comp" holds the artist places on specific seats (kept warm for
// family, press, etc.); venue-kind holds are ADA / sound desk /
// camera platform and stay creatable only via DBA/SQL for now until
// VENUE_STAFF lands (ADR-0012, Week 7).
//
// Flow: auth → ensure user mirror → Zod-validate body → load show
// (for the artist-id authorization + the architecture validation)
// → assert the venueRowId + seatNumbers are valid for that
// architecture → insert.
//
// The hold reaches the GAE on the next allocation compute: run-preview,
// run-binding, and the live projection route all merge this table into
// the venue architecture via mergeShowHoldsIntoArchitecture
// (src/lib/allocation/translate.ts) before building a plan. No other
// state changes here.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  createHold,
  ensureUserMirror,
  getShowById,
  userCanManageArtist,
} from "@/lib/db/repositories";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  showId: uuidParam,
  // Free-form label that appears as the source chip on the Holds card.
  // Capped at 80 chars to keep the chip from breaking the layout.
  source: z.string().trim().min(1, "source required").max(80),
  venueRowId: z.string().min(1, "venueRowId required"),
  seatNumbers: z
    .array(z.string().min(1))
    .min(1, "at least one seat required")
    .max(64, "too many seats in one hold"),
  notes: z.string().trim().max(500).optional(),
});

type Success = { id: string };
type ErrorBody = { error: string };

export async function POST(
  request: Request,
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const show = await getShowById(db, parsed.data.showId);
  if (!show) {
    return NextResponse.json({ error: "show not found" }, { status: 404 });
  }

  const allowed = await userCanManageArtist(db, userId, show.artistId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Validate the seats against the architecture. The architecture is
  // an immutable snapshot the show points at; bogus rowId or seats
  // that don't exist on the row would otherwise produce a hold the
  // GAE silently ignores. Surfacing the mistake at the boundary is
  // worth the extra lookup we just did anyway.
  const archRows = show.venueArchitecture.rows as readonly GaeVenueRow[];
  const row = archRows.find((r) => r.id === parsed.data.venueRowId);
  if (!row) {
    return NextResponse.json(
      { error: `venueRowId not in architecture` },
      { status: 400 },
    );
  }
  const validSeats = new Set(row.seatNumbers);
  const invalid = parsed.data.seatNumbers.filter((s) => !validSeats.has(s));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `seat(s) not in row: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  // Lazy-mirror so the createHold FK can resolve. Same pattern as
  // POST /api/artist-requests and POST /api/offers.
  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return NextResponse.json(
      { error: "no email on Clerk user" },
      { status: 400 },
    );
  }
  await ensureUserMirror(db, { id: userId, email });

  const created = await createHold(db, {
    showId: parsed.data.showId,
    source: parsed.data.source,
    // Artist-kind only via this endpoint. Venue-kind requires admin
    // and isn't surfaced in the UI yet.
    kind: "artist",
    venueRowId: parsed.data.venueRowId,
    seatNumbers: parsed.data.seatNumbers,
    ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
