// One row on the fan-side Dashboard. Renders a single show from the
// API's ShowSummaryView. Prototype-fidelity port of the ShowRow in
// design/ui_kits/auckets/screens/Dashboard.jsx.
//
// Wired as a Next.js <Link> rather than the prototype's button —
// SSR-friendly navigation, no JS needed for the main click target.
// Per the prototype (Dashboard.jsx line 62): when the fan's ticket is
// ready, the row opens the ticket viewer (/tickets/[showId], the rotating
// QR); otherwise it opens the show. The viewer is the only UI entry point
// to a fan's QR, so this link is load-bearing for the attend path.

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { type ShowSummaryView } from "@/lib/presenters";

import { StandingLadder } from "./StandingLadder";

type Props = {
  show: ShowSummaryView;
};

// Choose a badge tone from the view fields. The prototype mock uses
// status as the tone directly, but its mock conflates show-status
// with offer-placement-status. Our API separates them, so we have to
// fold the two together here.
//
//   yourOffer.placed → 'placed' (Greenwood)
//   show.status==='open' AND window has opened ('Offers open' label) → 'open'
//   show.status==='open' AND window hasn't opened yet (date-suffixed label) → 'upcoming'
//   anything else (paused/closed/allocating/allocated/complete) → 'upcoming' as a safe fallback
function badgeToneFor(show: ShowSummaryView): BadgeTone {
  if (show.yourOffer?.placed) return "placed";
  if (show.status === "open" && show.statusLabel === "Offers open") return "open";
  return "upcoming";
}

// The prototype's "Placed · view ticket" label only appears when the
// ticket is ready to view. Our API's statusLabel doesn't include that
// suffix — the API doesn't know about the ticket. We compose it here.
function statusLabelFor(show: ShowSummaryView): string {
  if (show.yourOffer?.placed) {
    if (show.yourOffer.ticketReady) return "Placed · view ticket";
    return "Placed";
  }
  return show.statusLabel;
}

// "Sat · May 25 · 8pm" → "MAY" + "25" for the date stub.
function splitDateShort(dateShort: string): { month: string; day: string } {
  const [month = "", day = ""] = dateShort.split(" ");
  return { month: month.toUpperCase(), day };
}

export function ShowRow({ show }: Props) {
  const stub = splitDateShort(show.dateShort);
  const tone = badgeToneFor(show);
  const label = statusLabelFor(show);
  // A ready ticket routes to the viewer (the QR); otherwise to the show.
  const href = show.yourOffer?.ticketReady
    ? `/tickets/${show.id}`
    : `/shows/${show.id}`;

  return (
    <Link
      href={href}
      // flex-wrap below sm: the badge/countdown column drops to its own
      // full-width line under the show details instead of squeezing the
      // meta text into one-word-per-line wraps next to it (390px bug).
      className="group flex flex-wrap items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[var(--page)] px-4 py-[18px] no-underline transition-all duration-[120ms] ease-[var(--ease-out)] hover:border-[color:var(--border-strong)] hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-px sm:flex-nowrap md:gap-5 md:px-5"
    >
      {/* Date stub — with the ticket-stub perforation on its right edge. */}
      <div
        className="relative flex-shrink-0 rounded-md py-2.5 text-center"
        style={{ width: 64, background: "var(--paper)" }}
      >
        <div className="font-mono text-[11px]" style={{ color: "var(--fg-muted)" }}>
          {stub.month}
        </div>
        <div className="mt-0.5 font-display text-[22px] font-bold leading-none">
          {stub.day}
        </div>
        <span
          className="pointer-events-none absolute bottom-2 top-2 w-0.5"
          style={{
            right: -1,
            backgroundImage:
              "radial-gradient(circle, var(--border-strong) 1px, transparent 1.2px)",
            backgroundSize: "2px 9px",
          }}
          aria-hidden
        />
      </div>

      {/* Middle column — venue + artist + dateLong + yourOffer chip + ladder */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Stacked below sm so the artist · city meta gets the full column
            width instead of wrapping word-by-word beside the venue name. */}
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <h3 className="text-lg">{show.venue}</h3>
          <span className="font-sans text-xs" style={{ color: "var(--fg-subtle)" }}>
            {show.artist}
            {show.city ? ` · ${show.city}` : ""}
          </span>
        </div>
        <div className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
          {show.dateLong}
        </div>
        {show.yourOffer && (
          <div
            className="mt-1 inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 self-start rounded-md px-2.5 py-1"
            style={{ background: "var(--greenwood-50)" }}
          >
            <span
              className="font-mono text-xs tabular-nums"
              style={{ color: "var(--greenwood-700)" }}
            >
              up to {show.yourOffer.price} × {show.yourOffer.size}
            </span>
            <span
              className="font-sans text-[11px]"
              style={{ color: "var(--brand)" }}
            >
              · {show.yourOffer.intentNote}
            </span>
          </div>
        )}
        {show.yourOffer?.standing && (
          <StandingLadder standing={show.yourOffer.standing} />
        )}
      </div>

      {/* Right column — badge + closes countdown. Below sm it wraps to its
          own row (order-last + w-full), indented to align with the text
          column, with the badge and countdown side by side. */}
      <div className="order-last flex w-full flex-shrink-0 items-center justify-between gap-2 pl-[76px] sm:order-none sm:w-auto sm:flex-col sm:items-end sm:pl-0">
        <Badge tone={tone}>{label}</Badge>
        {show.closes && (
          <span className="font-mono text-[11px]" style={{ color: "var(--fg-subtle)" }}>
            {show.closes}
          </span>
        )}
      </div>

      <ChevronRight
        size={18}
        strokeWidth={1.75}
        className="mt-0.5 flex-shrink-0"
        style={{ color: "var(--fg-faint)" }}
        aria-hidden
      />
    </Link>
  );
}
