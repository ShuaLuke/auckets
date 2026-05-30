// Artist Dashboard ("My shows"). Prototype-fidelity port of
// design/ui_kits/auckets/screens/ArtistDashboard.jsx — server component
// for the page shell, the data feeds from the same repos GET
// /api/artists/[id]/shows + /stats use.
//
// FUTURE CLEANUP: the loading logic below duplicates the two API route
// handlers. Same posture as the fan-side Dashboard — extract a shared
// loadArtistDashboard(artistId, now) helper once a third consumer needs
// it (e.g. an ArtistShow detail page). For now the duplication is
// contained and easy to read.

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { ArtistShowRow } from "@/components/artist/ArtistShowRow";
import { SnapshotStats } from "@/components/artist/SnapshotStats";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getArtistById,
  getOfferStatsByShowIds,
  getOfferStatsForArtist,
  getProvisionalFilledByShowIds,
  getVenueArchitecturesByIds,
  listShowsForArtist,
  userCanManageArtist,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistShowSummary,
  presentArtistSnapshotStats,
  type ArtistShowSummaryView,
  type ArtistSnapshotStatsView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: uuidParam,
});

type LoadedView = {
  artistName: string;
  shows: ArtistShowSummaryView[];
  snapshot: ArtistSnapshotStatsView;
};

async function loadArtistDashboard(
  artistId: string,
): Promise<LoadedView | null> {
  const artist = await getArtistById(db, artistId);
  if (!artist) return null;

  const now = new Date();
  const rows = await listShowsForArtist(db, artistId);
  const showIds = rows.map((r) => r.id);

  // Same shape as GET /api/artists/[id]/shows + /stats, in parallel.
  // The snapshot stat is independent of the per-show aggregates, so it
  // rides along in the same Promise.all to keep the round-trip count
  // down. Each of the four queries is one DB hit.
  const [snapshotStats, offerStats, provisionalFilled, architectureById] =
    await Promise.all([
      getOfferStatsForArtist(db, artistId),
      getOfferStatsByShowIds(db, showIds),
      getProvisionalFilledByShowIds(db, showIds),
      getVenueArchitecturesByIds(
        db,
        [...new Set(rows.map((r) => r.venueArchitectureId))],
      ),
    ]);

  const shows = rows.map((row) =>
    presentArtistShowSummary(
      row,
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

  // Cross-show fill totals for the snapshot's "Capacity filled" cell.
  // Counts every show in the artist's row list. Pre-binding states are
  // the meaningful set for "if allocation ran now", so we exclude shows
  // whose status is already past the binding gate (allocated /
  // complete) — those have permanent placements, not provisional ones.
  let totalFilled = 0;
  let totalCapacity = 0;
  for (const show of shows) {
    if (show.status === "allocated" || show.status === "complete") continue;
    totalFilled += show.provisionalFilled;
    totalCapacity += show.capacity;
  }

  return {
    artistName: artist.name,
    shows,
    snapshot: presentArtistSnapshotStats(snapshotStats, {
      totalFilled,
      totalCapacity,
    }),
  };
}

type Props = {
  params: { artistId: string };
};

export default async function ArtistDashboardPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) notFound();

  // Authorization: 404 (not 403) so we don't leak the existence of
  // artists the caller can't see. Mirrors the fan-side notFound() for
  // shows that don't exist — same posture.
  const allowed = await userCanManageArtist(db, userId, parsed.data.artistId);
  if (!allowed) notFound();

  const data = await loadArtistDashboard(parsed.data.artistId);
  if (!data) notFound();

  const showCount = data.shows.length;
  const showWord = showCount === 1 ? "show" : "shows";
  const pluralOffers = data.snapshot.offersInPool === 1 ? "offer" : "offers";
  const pluralTickets = data.snapshot.ticketsInPool === 1 ? "ticket" : "tickets";

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <Eyebrow className="mb-2">Artist</Eyebrow>
            <h1 className="text-4xl">{data.artistName}</h1>
            <p
              className="mt-1 font-sans text-sm"
              style={{ color: "var(--fg-muted)" }}
            >
              {showCount} {showWord} · {data.snapshot.offersInPool}{" "}
              {pluralOffers} for {data.snapshot.ticketsInPool} {pluralTickets}
            </p>
          </div>
          {/* Prototype has a "New show" button here. Show-creation flow
              doesn't exist yet — omitted until that slice lands rather
              than rendering a button that does nothing. */}
        </div>

        <div className="mb-6">
          <SnapshotStats stats={data.snapshot} showCount={showCount} />
        </div>

        {showCount === 0 ? (
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            No shows on this artist yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.shows.map((show) => (
              <ArtistShowRow
                key={show.id}
                artistId={parsed.data.artistId}
                show={show}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
