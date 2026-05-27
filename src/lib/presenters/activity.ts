// Presenter for the ShowAdmin Recent activity feed. Source today is
// the offers table only — submitted_at + revised_at on each row yields
// up to two events ("new offer" / "revision"). Allocation-run events
// ("Preview computed · 487 placed, 14 unplaced" in the prototype mock)
// will land once we wire the allocation_audit table into this feed.
//
// Each Offer can produce two ActivityEvent rows. We interleave both
// streams, sort by `at` DESC, then truncate to `limit` (default 10) to
// match the prototype's ~7-row Card. No per-revision diff is shown —
// the data model is last-write-wins on the offers row today, so the
// old price isn't available. The "Revised" event surfaces the current
// price + the revisedAt time so the artist sees something useful;
// full $X → $Y diffs land with the offer-revision-history follow-up.

import { formatCents } from "@/lib/money";

import type { Offer } from "@/lib/db/repositories";

const DEFAULT_LIMIT = 10;

// Composer-matching labels keep the activity feed's tier copy aligned
// with what the fan picked. Same mapping as src/lib/presenters/bids.ts
// — kept inline rather than imported to avoid coupling the two.
function tierLabelFor(
  tierPreference: string,
  preferredTier: string | null,
): string {
  if (tierPreference === "specific" && preferredTier) {
    return `${preferredTier} only`;
  }
  if (tierPreference === "this_or_worse" && preferredTier) {
    return `${preferredTier} or below`;
  }
  if (tierPreference === "this_or_better" && preferredTier) {
    return `${preferredTier} or above`;
  }
  return "anywhere";
}

// Short relative-time formatter for activity rows. Mirrors the
// prototype's "2m ago" / "1h ago" / "3d ago" style. For very recent
// events (< 1 minute) we say "just now" rather than "0m ago".
export function formatTimeAgo(at: Date, now: Date): string {
  const diffMs = now.getTime() - at.getTime();
  if (diffMs < 60_000) return "just now";
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const totalHours = Math.floor(diffMs / (60 * 60_000));
  if (totalHours < 24) return `${totalHours}h ago`;
  const totalDays = Math.floor(diffMs / (24 * 60 * 60_000));
  return `${totalDays}d ago`;
}

export type ActivityEvent = {
  kind: "new" | "revised";
  at: Date;
  timeAgo: string;
  // Last 4 of the offer ID for visual identity, matching the prototype's
  // "offer_8f3a" treatment. The full ID would dominate the row.
  offerTag: string;
  message: string;
};

function offerTagFor(id: string): string {
  // UUID is 36 chars with dashes; the trailing 4 are unique enough
  // for at-a-glance identification.
  return `offer_${id.slice(-4)}`;
}

function newOfferMessage(offer: Offer): string {
  const price = formatCents(offer.pricePerTicketCents);
  const tier = tierLabelFor(offer.tierPreference, offer.preferredTier);
  return `New offer · ${price} × ${offer.groupSize} · ${tier}`;
}

function revisedMessage(offer: Offer): string {
  // Without a revision history table the old price is gone. Surface
  // the current price + tag so the artist can correlate against the
  // offer they care about. The fuller "$30 → $40" form lands when
  // the project_offer_revision_history follow-up ships.
  const price = formatCents(offer.pricePerTicketCents);
  return `Revision · ${offerTagFor(offer.id)} · now ${price} × ${offer.groupSize}`;
}

export function presentRecentActivity(
  offerRows: readonly Offer[],
  now: Date,
  limit: number = DEFAULT_LIMIT,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const offer of offerRows) {
    events.push({
      kind: "new",
      at: offer.submittedAt,
      timeAgo: formatTimeAgo(offer.submittedAt, now),
      offerTag: offerTagFor(offer.id),
      message: newOfferMessage(offer),
    });
    if (offer.revisedAt) {
      events.push({
        kind: "revised",
        at: offer.revisedAt,
        timeAgo: formatTimeAgo(offer.revisedAt, now),
        offerTag: offerTagFor(offer.id),
        message: revisedMessage(offer),
      });
    }
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}
