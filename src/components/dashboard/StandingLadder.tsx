// The calm "you're in, the question is where" strip under each active offer
// on the fan dashboard (Change 02 §D). Guaranteed-floor framing (README
// §6.1): it ALWAYS leads with "You're in" and frames the next tier as an
// upgrade opportunity — never a rank, never "you're below the line."
//
// Server component, dumb renderer: every value is pre-computed by
// presentStanding. The only derived thing here is the fill width, which is
// pure geometry off the cents the view already carries.

import { type StandingView } from "@/lib/presenters";

type Props = {
  standing: StandingView;
};

export function StandingLadder({ standing }: Props) {
  const { projectedTier, positionHint, capCents, nextTier, inTopTier } =
    standing;

  // How far the cap sits toward the next-tier line. Clamped so the bar is
  // always visibly present and never overruns the threshold nub.
  const fillPct = nextTier
    ? Math.max(8, Math.min(94, (capCents / nextTier.lineCents) * 100))
    : 100;

  return (
    <div
      className="mt-2 grid items-center gap-x-3.5 gap-y-3 rounded-md border px-[15px] py-[13px]"
      style={{
        gridTemplateColumns: "auto 1fr auto",
        background: "var(--page)",
        borderColor: "var(--border)",
      }}
    >
      {/* "You're in" — spans the full width, always first (README §6.1). */}
      <div className="col-span-3 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: "var(--brand)" }}
          aria-hidden
        />
        <span className="font-sans text-[13px]" style={{ color: "var(--fg)" }}>
          {inTopTier ? (
            <>You&apos;re in — front section. Nothing more to do.</>
          ) : (
            <>
              You&apos;re in — you&apos;d land in{" "}
              <strong>{projectedTier}</strong>, {positionHint}
            </>
          )}
        </span>
      </div>

      {nextTier ? (
        <>
          <span
            className="font-mono text-[9px] uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-subtle)" }}
          >
            Reach {nextTier.label}
          </span>
          <span
            className="relative block h-1.5 rounded-full"
            style={{ background: "var(--ink-100)" }}
          >
            <span
              className="absolute left-0 top-0 h-full rounded-full"
              style={{ background: "var(--brand)", width: `${fillPct}%` }}
              aria-hidden
            />
            {/* nub at the next-tier threshold */}
            <span
              className="absolute right-0 top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded"
              style={{ background: "var(--fg-faint)" }}
              aria-hidden
            />
          </span>
          <span
            className="whitespace-nowrap font-mono text-[13px] tabular-nums"
            style={{ color: "var(--fg)" }}
          >
            +{nextTier.deltaDisplay} → {nextTier.lineDisplay}
          </span>
        </>
      ) : (
        // Top tier (or no honest reach): a calm, fully-filled rail, no dial.
        <span
          className="col-span-3 block h-1.5 rounded-full"
          style={{ background: "var(--brand)" }}
          aria-hidden
        />
      )}
    </div>
  );
}
