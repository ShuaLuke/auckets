// GET /api/shows — list open shows for any signed-in user.
//
// Flow (per CLAUDE.md hard constraints): auth → authorization → input
// validation → repository → presenter → NextResponse.json. No query params
// yet; pagination + filters arrive when the prototype Dashboard rows demand
// them.
//
// N+1 avoidance: every per-row enrichment (offer / assignment / arch row
// for the preview) is batched into one query at the route boundary. The
// presenter stays pure — it only consumes what this handler hands it.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  listOffersForUser,
  listOpenShows,
  listSeatAssignmentsByOfferIds,
  getVenueArchitecturesByIds,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowSummary,
  type ShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ShowSummaryView[] | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `now` is computed once at the route boundary so every row in the
  // response shares the same reference instant — otherwise a slow query
  // could leave half the page's countdowns lagging the other half.
  const now = new Date();
  const [rows, userOffers] = await Promise.all([
    listOpenShows(db),
    listOffersForUser(db, userId),
  ]);

  // Map the caller's offers by show id so per-row lookups are O(1).
  const offerByShowId = new Map<string, (typeof userOffers)[number]>();
  for (const offer of userOffers) {
    offerByShowId.set(offer.showId, offer);
  }

  // Fetch seat assignments only for the caller's offers (a fan may have
  // many shows but only a handful of placed offers). Empty-array branch
  // is handled by listSeatAssignmentsByOfferIds.
  const userOfferIds = userOffers.map((o) => o.id);
  const assignmentByOfferId = await listSeatAssignmentsByOfferIds(
    db,
    userOfferIds,
  );

  // For the yourOffer.preview text we need the architecture row's
  // (area, rowName). Each assignment has a venue_row_id pointing into
  // venue_architectures.rows JSONB. Group by architecture so we only
  // fetch each one once across the response.
  const archIdsForPreview = new Set<string>();
  for (const row of rows) {
    const offer = offerByShowId.get(row.id);
    if (offer && assignmentByOfferId.has(offer.id)) {
      archIdsForPreview.add(row.venueArchitectureId);
    }
  }
  const architectureById = await getVenueArchitecturesByIds(
    db,
    [...archIdsForPreview],
  );

  const view = rows.map((row) => {
    const offer = offerByShowId.get(row.id) ?? null;
    const assignment = offer ? assignmentByOfferId.get(offer.id) ?? null : null;
    let assignmentRow: { area: string; rowName: string } | null = null;
    if (assignment) {
      const arch = architectureById.get(row.venueArchitectureId);
      assignmentRow = arch?.rows.find((r) => r.id === assignment.venueRowId) ?? null;
    }
    return presentShowSummary(
      row,
      now,
      DEFAULT_TZ,
      offer,
      assignment,
      assignmentRow,
    );
  });
  return NextResponse.json(view);
}
