// /admin — the AUCKETS ops command center. First section is the shows
// list: every show across every artist, all statuses, each row drilling
// into the existing ShowAdmin page. This is the spine the rest of the
// command center hangs off (offers, tickets, money, allocations, sim) —
// see the "Admin command center" initiative in docs/REMAINING_WORK.md.
//
// Authorization posture: notFound() on non-admin so the route's existence
// doesn't leak. Mirrors /admin/requests and the (artist) route group.
//
// Loading mirrors the artist dashboard (loadArtistDashboard) but unscoped
// across all artists — same repos, same presenter, no status filter.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminShowRow } from "@/components/admin/AdminShowRow";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getOfferStatsByShowIds,
  getProvisionalFilledByShowIds,
  getVenueArchitecturesByIds,
  listAllShows,
  userIsAdmin,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistShowSummary,
  type ArtistShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

type AdminShowEntry = {
  artistId: string;
  view: ArtistShowSummaryView;
};

async function loadAllShows(): Promise<AdminShowEntry[]> {
  const now = new Date();
  const rows = await listAllShows(db);
  const showIds = rows.map((r) => r.id);

  // Same three aggregates the artist dashboard fetches, just over the
  // full show set. Each is one batched DB hit keyed by show id.
  const [offerStats, provisionalFilled, architectureById] = await Promise.all([
    getOfferStatsByShowIds(db, showIds),
    getProvisionalFilledByShowIds(db, showIds),
    getVenueArchitecturesByIds(
      db,
      [...new Set(rows.map((r) => r.venueArchitectureId))],
    ),
  ]);

  return rows.map((row) => ({
    artistId: row.artistId,
    view: presentArtistShowSummary(
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
  }));
}

export default async function AdminHomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // 404 over 403: the route doesn't exist as far as non-admins are
  // concerned. Same posture as /admin/requests.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) notFound();

  const shows = await loadAllShows();
  const showCount = shows.length;
  const showWord = showCount === 1 ? "show" : "shows";

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Auckets ops</Eyebrow>
          <h1 className="text-4xl">Command center</h1>
          <p
            className="mt-1 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            {showCount} {showWord} across all artists. Click a show to manage it.
          </p>
        </div>

        {/* Section nav. Shows is here; Requests is the existing inbox.
            More sections (offers, tickets, money, allocations, sim) land
            as the command center grows — see REMAINING_WORK.md. */}
        <div className="mb-6 flex items-center gap-1">
          <span
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={{ background: "var(--ink-900)", color: "var(--paper)" }}
          >
            Shows
          </span>
          <Link
            href="/admin/artists"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={{
              background: "transparent",
              color: "var(--fg-muted)",
              border: "1px solid var(--border)",
            }}
          >
            Artists
          </Link>
          <Link
            href="/admin/requests"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={{
              background: "transparent",
              color: "var(--fg-muted)",
              border: "1px solid var(--border)",
            }}
          >
            Requests
          </Link>
          <Link
            href="/admin/staff"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={{
              background: "transparent",
              color: "var(--fg-muted)",
              border: "1px solid var(--border)",
            }}
          >
            Staff
          </Link>
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
            No shows yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shows.map((entry) => (
              <AdminShowRow
                key={entry.view.id}
                artistId={entry.artistId}
                show={entry.view}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
