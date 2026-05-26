// GET /api/shows — list open shows for any signed-in user.
//
// Flow (per CLAUDE.md hard constraints): auth → authorization → input
// validation → repository → presenter → NextResponse.json. No query params
// yet; pagination + filters arrive when the prototype Dashboard rows demand
// them.
//
// N+1 avoidance: we fetch all of the caller's offers in one
// listOffersForUser() call and index them by show_id in memory, then hand
// the right offer (or null) into each per-row presenter. The alternative —
// one query per show — would explode on a fan with offers across many
// shows.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  listOffersForUser,
  listOpenShows,
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

  const offerByShowId = new Map<string, (typeof userOffers)[number]>();
  for (const offer of userOffers) {
    offerByShowId.set(offer.showId, offer);
  }

  const view = rows.map((row) =>
    presentShowSummary(row, now, DEFAULT_TZ, offerByShowId.get(row.id) ?? null),
  );
  return NextResponse.json(view);
}
