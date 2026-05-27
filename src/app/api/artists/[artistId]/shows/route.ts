// GET /api/artists/[artistId]/shows — artist-scoped show list for the
// Artist Dashboard. Only members of that artist (or AUCKETS_ADMIN) may read.
//
// Flow: auth → authorization (artist_members OR role=AUCKETS_ADMIN) →
// Zod-validate path param → repository → presenter → NextResponse.json.
// Each row carries: the per-show offer aggregate (count + median + top),
// the seat-assignment count (provisionalFilled), and the venue
// architecture's per-show capacity. Aggregates are batched — one GROUP
// BY query for offers, one for seat assignments, one IN-list query for
// architectures.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getOfferStatsByShowIds,
  getProvisionalFilledByShowIds,
  getVenueArchitecturesByIds,
  listShowsForArtist,
  userCanManageArtist,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistShowSummary,
  type ArtistShowSummaryView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: uuidParam,
});

export async function GET(
  _request: Request,
  { params }: { params: { artistId: string } },
): Promise<NextResponse<ArtistShowSummaryView[] | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid artistId" },
      { status: 400 },
    );
  }
  const { artistId } = parsed.data;

  const allowed = await userCanManageArtist(db, userId, artistId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const rows = await listShowsForArtist(db, artistId);
  const showIds = rows.map((r) => r.id);
  // Three parallel aggregates over the same show set, plus the
  // architectures needed for the capacity computation. Each is one
  // round-trip; the route was already at one round-trip pre-slice-5b
  // for the offer stats — this adds two more.
  const [offerStats, provisionalFilled, architectureById] = await Promise.all([
    getOfferStatsByShowIds(db, showIds),
    getProvisionalFilledByShowIds(db, showIds),
    getVenueArchitecturesByIds(
      db,
      [...new Set(rows.map((r) => r.venueArchitectureId))],
    ),
  ]);

  const view = rows.map((row) =>
    presentArtistShowSummary(
      row,
      // batched helpers backfill missing keys with zero-stats / 0,
      // so the ?? branches are belt-and-braces.
      offerStats.get(row.id) ?? {
        count: 0,
        ticketsCount: 0,
        medianCents: null,
        topCents: null,
      },
      provisionalFilled.get(row.id) ?? 0,
      architectureById.get(row.venueArchitectureId) ?? null,
      row.activeRowIds,
      now,
      DEFAULT_TZ,
    ),
  );
  return NextResponse.json(view);
}
