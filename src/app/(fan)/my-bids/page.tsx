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
import { listBidsForUser } from "@/lib/db/repositories";
import { DEFAULT_TZ, presentBidView, type BidView } from "@/lib/presenters";

export const dynamic = "force-dynamic";

async function loadBids(userId: string): Promise<BidView[]> {
  const rows = await listBidsForUser(db, userId);
  return rows.map((row) => presentBidView(row, DEFAULT_TZ));
}

export default async function MyBidsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const bids = await loadBids(userId);

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-8 py-12">
        <div className="mb-7 flex items-baseline justify-between">
          <div>
            <Eyebrow className="mb-2">Bid history</Eyebrow>
            <h1 className="text-4xl">Your bids</h1>
            <p
              className="mt-1 font-sans text-sm"
              style={{ color: "var(--fg-muted)" }}
            >
              {bids.length === 0
                ? "Browse open shows to place your first bid."
                : bids.length === 1
                  ? "1 bid · across 1 show"
                  : `${bids.length} bids · across ${new Set(bids.map((b) => b.showId)).size} shows`}
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
            You haven&apos;t placed any bids yet.{" "}
            <Link
              href="/dashboard"
              style={{ color: "var(--fg)", textDecoration: "underline" }}
            >
              Find an open show
            </Link>{" "}
            to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bids.map((bid) => (
              <BidCard key={bid.offerId} bid={bid} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
