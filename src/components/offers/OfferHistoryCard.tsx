// One card on /offers (the fan's offer history). Top row = current offer
// state, click-through to /shows/[showId] to revise. A native <details>
// disclosure below the row reveals the full revision history (oldest →
// newest) — built from offer_revisions, populated by upsertOfferForUser
// inside the same transaction.
//
// The `bid`-named prop + BidView type mirror the presenter layer; renaming
// that layer is a wider sweep deferred from the UI-3 copy pack. Nothing
// "bid" renders to the fan.

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { type BidView, type OfferHistoryView } from "@/lib/presenters";

import { Badge, type BadgeTone } from "@/components/ui/Badge";

type Props = {
  bid: BidView;
  history: OfferHistoryView;
};

function statusTone(label: string): BadgeTone {
  switch (label) {
    case "Placed":
    case "Ticket purchased":
      return "placed";
    case "In pool":
      return "open";
    case "Not placed":
    case "Payment failed":
      return "unplaced";
    case "Refunded":
    case "Resold":
    case "Gifted":
      return "skipped";
    default:
      return "upcoming";
  }
}

function splitDateShort(dateShort: string): { month: string; day: string } {
  const [month = "", day = ""] = dateShort.split(" ");
  return { month: month.toUpperCase(), day };
}

export function OfferHistoryCard({ bid, history }: Props) {
  const stub = splitDateShort(bid.dateShort);
  const tone = statusTone(bid.offerStatusLabel);
  // Hide the disclosure when there's nothing past the initial submission
  // to show. A single "submitted" entry is implicit in the top row's
  // "Submitted · X" copy.
  const hasMeaningfulHistory = history.entries.length > 1;
  return (
    <div
      // Hover lift matches the dashboard ShowRow idiom (border-strong +
      // shadow + motion-safe 1px rise) so every clickable row reads the
      // same. Lives on the wrapper, not the Link, so the lift covers the
      // whole card including the history disclosure strip.
      className="rounded-xl border border-[color:var(--border)] bg-[var(--page)] transition-[border-color,box-shadow,transform] duration-[120ms] ease-[var(--ease-out)] hover:border-[color:var(--border-strong)] hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-px"
    >
      <Link
        href={`/shows/${bid.showId}`}
        // flex-wrap below sm: the status column drops to its own line so
        // the meta text doesn't wrap word-by-word into it (390px bug,
        // same fix as ShowRow).
        className="flex flex-wrap items-center gap-3 px-4 py-[18px] no-underline sm:flex-nowrap md:gap-5 md:px-5"
      >
        {/* Date stub */}
        <div
          className="flex-shrink-0 rounded-md py-2.5 text-center"
          style={{ width: 64, background: "var(--paper)" }}
        >
          <div
            className="font-mono text-[11px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {stub.month}
          </div>
          <div className="mt-0.5 font-display text-[22px] font-bold leading-none">
            {stub.day}
          </div>
        </div>

        {/* Middle column — show + offer details */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Stacked below sm so the meta line gets full column width. */}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <h3 className="text-lg">{bid.venue}</h3>
            <span
              className="font-sans text-xs"
              style={{ color: "var(--fg-subtle)" }}
            >
              {bid.artist}
              {bid.city ? ` · ${bid.city}` : ""}
              {" · "}
              {bid.dateLong}
            </span>
          </div>
          <div
            className="font-mono text-[13px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {bid.pricePerTicket} × {bid.groupSize} = {bid.totalIfPlaced}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="font-sans text-[11px]"
              style={{ color: "var(--fg-muted)" }}
            >
              Tier ·{" "}
              <span style={{ color: "var(--fg)" }}>{bid.tierLabel}</span>
            </span>
            <span
              className="font-sans text-[11px]"
              style={{ color: "var(--fg-muted)" }}
            >
              Submitted ·{" "}
              <span style={{ color: "var(--fg)" }}>
                {bid.submittedDisplay}
              </span>
            </span>
            {bid.revisedDisplay && (
              <span
                className="font-sans text-[11px]"
                style={{ color: "var(--fg-muted)" }}
              >
                Revised ·{" "}
                <span style={{ color: "var(--fg)" }}>{bid.revisedDisplay}</span>
              </span>
            )}
          </div>
        </div>

        {/* Status badges — drop to their own full-width row below sm. */}
        <div className="order-last flex w-full items-center justify-between gap-2 pl-[76px] sm:order-none sm:w-auto sm:flex-col sm:items-end sm:gap-1.5 sm:pl-0">
          <Badge tone={tone}>{bid.offerStatusLabel}</Badge>
          {bid.showStatusHint && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--fg-subtle)" }}
            >
              {bid.showStatusHint}
            </span>
          )}
        </div>

        <ChevronRight
          size={18}
          strokeWidth={1.75}
          style={{ color: "var(--fg-faint)" }}
          aria-hidden
        />
      </Link>

      {hasMeaningfulHistory && (
        <details
          className="border-t px-5 py-3"
          style={{ borderColor: "var(--border-faint)" }}
        >
          <summary
            className="cursor-pointer font-sans text-[12px]"
            style={{ color: "var(--fg-muted)" }}
          >
            History · {history.entries.length} entr
            {history.entries.length === 1 ? "y" : "ies"}
          </summary>
          <ol className="mt-3 flex flex-col gap-2">
            {history.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex gap-3 font-mono text-[12px]"
                style={{ color: "var(--ink-700)", lineHeight: 1.45 }}
              >
                <span
                  className="flex-shrink-0"
                  style={{ minWidth: 130, color: "var(--fg-muted)" }}
                >
                  {entry.recordedDisplay}
                </span>
                <span>
                  {entry.kind === "submitted" ? "Submitted · " : "Revised · "}
                  {entry.summary}
                  {entry.changes.length > 1 && (
                    <span
                      className="ml-2"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      ({entry.changes.slice(1).join(", ")})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
