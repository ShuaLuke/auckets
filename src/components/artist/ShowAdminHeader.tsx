// Header for the per-show ShowAdmin page. Prototype-fidelity port of
// the header block in design/ui_kits/auckets/screens/ShowAdmin.jsx
// (lines 24-56) — minus the "Preview allocation" and "Request action"
// buttons, which need their own admin flow slices.
//
// Status banner ("Offers open · binding in 28d") is rendered inline
// here rather than as a separate Card.

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { type ArtistShowSummaryView } from "@/lib/presenters";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { PreviewAllocationButton } from "./PreviewAllocationButton";

type Props = {
  artistId: string;
  show: ArtistShowSummaryView;
  // Whether to render the "Preview allocation" button. Admin-only per
  // ADR-0013 (the API enforces this too, server-side, as the
  // authoritative check).
  canRunPreview: boolean;
};

function badgeToneFor(show: ArtistShowSummaryView): BadgeTone {
  if (show.status === "open" && show.statusLabel === "Offers open") return "open";
  return "upcoming";
}

export function ShowAdminHeader({ artistId, show, canRunPreview }: Props) {
  const tone = badgeToneFor(show);
  const offerWord = show.offers === 1 ? "offer" : "offers";
  const ticketWord = show.ticketsCount === 1 ? "ticket" : "tickets";

  return (
    <div className="mb-7 flex flex-col gap-6">
      <Link
        href={`/artists/${artistId}`}
        className="inline-flex items-center gap-1.5 no-underline"
        style={{ color: "var(--fg-muted)" }}
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
        <span className="font-sans text-[13px]">Back to my shows</span>
      </Link>

      <div className="flex items-end justify-between gap-6">
        <div>
          {show.city && <Eyebrow className="mb-2">{show.city}</Eyebrow>}
          <h1
            className="font-display text-[44px] font-bold"
            style={{ letterSpacing: "-0.03em", lineHeight: 1.1 }}
          >
            {show.venue}
          </h1>
          <p
            className="mt-2 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            {show.dateLong} · {show.capacity} seats · {show.offers}{" "}
            {offerWord} for {show.ticketsCount} {ticketWord}
          </p>
        </div>
        {canRunPreview && (
          <div className="flex items-center gap-2">
            <PreviewAllocationButton showId={show.id} />
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-6 rounded-xl px-[18px] py-[14px]"
        style={{ background: "var(--ink-900)" }}
      >
        <div className="flex items-baseline gap-4">
          <Badge tone={tone}>{show.statusLabel}</Badge>
          {show.closes && (
            <span
              className="font-sans text-sm"
              style={{ color: "var(--paper)" }}
            >
              Binding allocation runs in{" "}
              <strong
                className="font-mono"
                style={{ fontWeight: 600 }}
              >
                {show.closes.replace(" until binding", "")}
              </strong>
            </span>
          )}
        </div>
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--ink-300)" }}
        >
          Preview compute · per request (continuous compute ships later)
        </span>
      </div>
    </div>
  );
}
