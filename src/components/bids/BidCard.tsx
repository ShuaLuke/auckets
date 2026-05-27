// One card on /my-bids. Each card represents the current state of a
// single bid (no revision history yet — that's parked as a follow-up
// per project_offer_revision_history memory). Card links through to
// the corresponding /shows/[showId] page so the user can revise.

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { type BidView } from "@/lib/presenters";

import { Badge, type BadgeTone } from "@/components/ui/Badge";

type Props = {
  bid: BidView;
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

export function BidCard({ bid }: Props) {
  const stub = splitDateShort(bid.dateShort);
  const tone = statusTone(bid.offerStatusLabel);
  return (
    <Link
      href={`/shows/${bid.showId}`}
      className="flex items-center gap-5 rounded-xl border px-5 py-[18px] no-underline transition-shadow hover:shadow-[0_4px_12px_rgba(14,15,12,0.06)]"
      style={{ background: "var(--page)", borderColor: "var(--border)" }}
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

      {/* Middle column — show + bid details */}
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
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
            Tier · <span style={{ color: "var(--fg)" }}>{bid.tierLabel}</span>
          </span>
          <span
            className="font-sans text-[11px]"
            style={{ color: "var(--fg-muted)" }}
          >
            Submitted ·{" "}
            <span style={{ color: "var(--fg)" }}>{bid.submittedDisplay}</span>
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

      {/* Status badges */}
      <div className="flex flex-col items-end gap-1.5">
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
  );
}
