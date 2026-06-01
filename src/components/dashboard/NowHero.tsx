// The NowHero lead band on the fan dashboard (Change 02 §A): the fan's
// single most important state, given the full stage. Two variants off one
// ticket-stub shell — a green "you're in the room" ticket-ready card, and a
// "seats lock in" binding-imminent card. The page picks at most one via
// presentNowHero; everything here is pre-computed copy.
//
// Server component. The countdown is plain text and never animates
// (README §7). The perforation + QR chip are the ticket-stub motif at full
// craft — the dashboard's signature, not decoration for its own sake.

import Link from "next/link";

import { type NowHeroView } from "@/lib/presenters";

type Props = {
  hero: NowHeroView;
};

// A small decorative QR glyph for the stub — the REAL rotating QR lives in
// the ticket viewer; this is a visual cue only. Not a scannable code.
function QrGlyph() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={40}
      height={40}
      aria-hidden
      style={{ color: "var(--ink-900)" }}
    >
      <path
        fill="currentColor"
        d="M0 0h12v12H0V0Zm3 3v6h6V3H3Zm17-3h12v12H20V0Zm3 3v6h6V3h-6ZM0 20h12v12H0V20Zm3 3v6h6v-6H3Zm14-3h3v3h-3v-3Zm6 0h3v3h-3v-3Zm3 3h3v3h-3v-3Zm-9 3h3v3h-3v-3Zm6 0h3v6h-3v-6Zm-6 6h3v3h-3v-3Zm6 0h6v3h-6v-3ZM5 5h2v2H5V5Zm20 0h2v2h-2V5ZM5 25h2v2H5v-2Z"
      />
    </svg>
  );
}

function MetaStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ color: "var(--marquee-300)" }}
      >
        {k}
      </span>
      <span
        className="font-mono text-[15px] tabular-nums"
        style={{ color: "var(--paper)" }}
      >
        {v}
      </span>
    </div>
  );
}

const SUB_COLOR = "color-mix(in srgb, var(--paper) 78%, transparent)";

export function NowHero({ hero }: Props) {
  const isTicket = hero.kind === "ticket-ready";
  const href = isTicket ? `/tickets/${hero.showId}` : `/shows/${hero.showId}`;
  const cta = isTicket ? "View ticket →" : "Review your offer →";

  return (
    <div
      className="auk-reveal relative mb-6 grid items-center gap-6 overflow-hidden rounded-xl px-7 py-[26px]"
      style={{
        gridTemplateColumns: "1fr auto",
        background: "var(--greenwood-700)",
        color: "var(--paper)",
      }}
    >
      {/* Ticket-stub perforation between content and action (≥md only). */}
      <span
        className="pointer-events-none absolute bottom-0 top-0 hidden w-0.5 md:block"
        style={{
          left: "64.5%",
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--paper) 50%, transparent) 1.4px, transparent 1.6px)",
          backgroundSize: "2px 13px",
          backgroundRepeat: "repeat-y",
        }}
        aria-hidden
      />

      {/* Left — the story */}
      <div className="flex flex-col gap-2.5">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ color: "var(--marquee-300)" }}
        >
          {hero.eyebrow}
        </span>
        <h2
          className="font-display text-[28px] font-bold leading-tight"
          style={{ letterSpacing: "-0.025em" }}
        >
          {hero.title}
        </h2>
        <p
          className="max-w-[42ch] font-sans text-[13px] leading-snug"
          style={{ color: SUB_COLOR }}
        >
          {hero.sub}
        </p>

        <div className="mt-2 flex flex-wrap gap-x-7 gap-y-2">
          {hero.kind === "ticket-ready" ? (
            <>
              <MetaStat k="Seats" v={hero.seats} />
              <MetaStat k="You paid" v={hero.paid} />
              <MetaStat k="Doors" v={hero.doors} />
            </>
          ) : (
            <>
              <MetaStat k="Your offer" v={hero.offerLine} />
              <MetaStat k="You'd land" v={hero.projectedTier} />
              <MetaStat k="Locks" v={hero.locks} />
            </>
          )}
        </div>
      </div>

      {/* Right — the action */}
      <div className="flex flex-col items-center gap-3">
        {isTicket && (
          <span
            className="flex h-16 w-16 items-center justify-center rounded-lg"
            style={{ background: "var(--paper)" }}
            aria-hidden
          >
            <QrGlyph />
          </span>
        )}
        <Link
          href={href}
          className="rounded-full px-4 py-2 text-center font-sans text-[13px] font-medium no-underline transition-shadow hover:shadow-[var(--shadow-md)]"
          style={{ background: "var(--paper)", color: "var(--ink-900)" }}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
