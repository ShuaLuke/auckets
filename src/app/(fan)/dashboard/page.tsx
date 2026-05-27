// Fan-side Dashboard. Prototype-fidelity port of
// design/ui_kits/auckets/screens/Dashboard.jsx — same layout, same
// styling tokens. Data comes from the read-side repositories that
// GET /api/shows uses; this server component duplicates that loading
// today so the page is fully SSR-rendered.
//
// FUTURE CLEANUP: extract the loading logic into a shared helper
// (e.g. src/lib/dashboard/load.ts) once a second consumer needs it.
// Slice 10 will add the Show page which has its own loading needs,
// so the duplication doesn't compound yet — first cleanup target.

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { ShowRow } from "@/components/dashboard/ShowRow";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getVenueArchitecturesByIds,
  listOffersForUser,
  listOpenShows,
  listSeatAssignmentsByOfferIds,
  listTicketsByAssignmentIds,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowSummary,
  type ShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

async function loadDashboardData(userId: string): Promise<ShowSummaryView[]> {
  // Same loading shape as GET /api/shows. See the route handler for
  // the rationale on each step (N+1 avoidance, single `now` for
  // consistent countdowns, etc.).
  const now = new Date();
  const [rows, userOffers] = await Promise.all([
    listOpenShows(db),
    listOffersForUser(db, userId),
  ]);

  const offerByShowId = new Map<string, (typeof userOffers)[number]>();
  for (const offer of userOffers) {
    offerByShowId.set(offer.showId, offer);
  }

  const userOfferIds = userOffers.map((o) => o.id);
  const assignmentByOfferId = await listSeatAssignmentsByOfferIds(
    db,
    userOfferIds,
  );

  const archIdsForPreview = new Set<string>();
  const assignmentIdsForTickets: string[] = [];
  for (const row of rows) {
    const offer = offerByShowId.get(row.id);
    if (!offer) continue;
    const assignment = assignmentByOfferId.get(offer.id);
    if (!assignment) continue;
    archIdsForPreview.add(row.venueArchitectureId);
    assignmentIdsForTickets.push(assignment.id);
  }
  const [architectureById, ticketByAssignmentId] = await Promise.all([
    getVenueArchitecturesByIds(db, [...archIdsForPreview]),
    listTicketsByAssignmentIds(db, assignmentIdsForTickets),
  ]);

  return rows.map((row) => {
    const offer = offerByShowId.get(row.id) ?? null;
    const assignment = offer ? assignmentByOfferId.get(offer.id) ?? null : null;
    let assignmentRow: { area: string; rowName: string } | null = null;
    let ticket = null;
    if (assignment) {
      const arch = architectureById.get(row.venueArchitectureId);
      assignmentRow =
        arch?.rows.find((r) => r.id === assignment.venueRowId) ?? null;
      ticket = ticketByAssignmentId.get(assignment.id) ?? null;
    }
    return presentShowSummary(
      row,
      now,
      DEFAULT_TZ,
      offer,
      assignment,
      assignmentRow,
      ticket,
    );
  });
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  const shows = await loadDashboardData(userId);

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-8 py-12">
        <div className="mb-7 flex items-baseline justify-between">
          <div>
            <Eyebrow className="mb-2">Welcome back</Eyebrow>
            <h1 className="text-4xl">Shows</h1>
          </div>
          <span className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
            Signed in as{" "}
            <span className="font-medium" style={{ color: "var(--fg)" }}>
              {email}
            </span>
          </span>
        </div>

        {shows.length === 0 ? (
          // Empty state — no open shows. Mirrors the prototype's tone
          // (sunken paper card, muted text) without inventing copy
          // that doesn't exist in the design.
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            No open shows right now. Check back closer to the next
            announced date.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shows.map((show) => (
              <ShowRow key={show.id} show={show} />
            ))}
          </div>
        )}

        {/* Bid history link — small affordance below the show list.
            Page lists every offer the user has placed across every
            show (open + past). */}
        <div className="mt-6 text-right">
          <Link
            href="/my-bids"
            className="font-sans text-[13px] no-underline"
            style={{ color: "var(--fg-muted)" }}
          >
            View bid history →
          </Link>
        </div>

        {/* "Heads up" note — matches Dashboard.jsx lines 66-73. */}
        <div
          className="mt-6 rounded-xl p-5 font-sans text-[13px]"
          style={{
            background: "var(--paper-2)",
            color: "var(--fg-muted)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--fg)" }}>Heads up.</strong>{" "}
          Allocation is binding 24 hours before doors. Until then, your
          placement is a non-binding preview — you can revise upward,
          never downward.
        </div>
      </div>
    </main>
  );
}
