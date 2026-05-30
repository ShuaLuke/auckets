// Top of the Show page. Matches the prototype's header block in
// design/ui_kits/auckets/screens/Show.jsx (lines 38-55):
//
//   Eyebrow (artist · city)
//   h1 (venue, display font, large)
//   dateLong (sans, body)
//   ─────  (status badge + binding countdown on the right)
//
// Server-rendered — no client JS needed for the header itself.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { type ShowDetailView } from "@/lib/presenters";

type Props = {
  show: ShowDetailView;
};

export function ShowHeader({ show }: Props) {
  // Status badge on the show page uses the show's own status, not an
  // offer-derived tone. The composer is where the fan's offer takes
  // shape; the badge here is "what state is the show in" — which is
  // always `open` if a fan can compose an offer at all.
  const tone = show.status === "open" ? "open" : "upcoming";

  return (
    <header className="mb-9">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 border-0 font-sans text-[13px]"
        style={{ color: "var(--fg-muted)" }}
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
        Back to shows
      </Link>

      <div className="flex items-end justify-between gap-6">
        <div>
          <Eyebrow className="mb-2.5">
            {show.artist}
            {show.city ? ` · ${show.city}` : ""}
          </Eyebrow>
          <h1
            className="font-display"
            style={{
              fontSize: 56,
              lineHeight: 1,
              letterSpacing: "-0.035em",
              fontVariationSettings: '"opsz" 72',
            }}
          >
            {show.venue}
          </h1>
          <div
            className="mt-3 font-sans text-[15px]"
            style={{ color: "var(--ink-600)" }}
          >
            {show.dateLong}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <Badge tone={tone} pulse={tone === "open"}>
            {show.statusLabel}
          </Badge>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--ink-500)" }}
          >
            {show.status === "open"
              ? `Binding allocation runs in ${show.bindingCountdown}`
              : show.bindingCountdown}
          </span>
        </div>
      </div>
    </header>
  );
}
