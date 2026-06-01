// Fan-side bid history. Lists every offer the user has placed across
// every show — open, paused, closed, allocated, complete. Reverse-
// chrono by submitted_at.
//
// No revision history per offer yet — see project_offer_revision_history
// memory for the follow-up that needs a new offer_revisions table +
// writes on every upsert.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { BidCard } from "@/components/bids/BidCard";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  listBidsForUser,
  listOfferRevisionsByOfferIds,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentBidView,
  presentOfferHistory,
  type BidView,
  type OfferHistoryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

type LoadedBid = {
  bid: BidView;
  history: OfferHistoryView;
};

async function loadBids(userId: string): Promise<LoadedBid[]> {
  const rows = await listBidsForUser(db, userId);
  const revisionsByOfferId = await listOfferRevisionsByOfferIds(
    db,
    rows.map((r) => r.offer.id),
  );
  return rows.map((row) => ({
    bid: presentBidView(row, DEFAULT_TZ),
    history: presentOfferHistory(
      revisionsByOfferId.get(row.offer.id) ?? [],
      DEFAULT_TZ,
    ),
  }));
}

export default async function MyBidsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const loaded = await loadBids(userId);
  const bids = loaded.map((l) => l.bid);

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-4 py-12 md:px-8">
        <div className="mb-7 flex items-baseline justify-between">
          <div>
            <Eyebrow className="mb-2">Offer history</Eyebrow>
            <h1 className="text-4xl">Your offers</h1>
            <p
              className="mt-1 font-sans text-sm"
              style={{ color: "var(--fg-muted)" }}
            >
              {bids.length === 0
                ? "Browse open shows to make your first offer."
                : bids.length === 1
                  ? "1 offer · across 1 show"
                  : `${bids.length} offers · across ${new Set(bids.map((b) => b.showId)).size} shows`}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="font-sans text-[13px] no-underline"
            style={{ color: "var(--fg-muted)" }}
          >
            ← Back to dashboard
          </Link>
        </div>

        {bids.length === 0 ? (
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            You haven&apos;t made an offer yet. When you find a show you love,
            tell us what the night&apos;s worth to you — we&apos;ll handle the
            rest.{" "}
            <Link
              href="/dashboard"
              style={{ color: "var(--fg)", textDecoration: "underline" }}
            >
              Find an open show
            </Link>
            .
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {loaded.map(({ bid, history }) => (
              <BidCard key={bid.offerId} bid={bid} history={history} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
