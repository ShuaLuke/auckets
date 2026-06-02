// Post-binding fan result — Change 03. One component, four faces, all leading
// with "you're in": the celebration (State A), the honest fallback (State B),
// the calm card-failure recovery, and the no-charge "this one filled up" edge.
// Pure presentation over the AllocationFinalView the route builds; the only
// interactivity is CTA navigation, so this stays a server component.
//
// Layout (placed + edges with a map): a full-width hero, then a two-column
// grid — left the RoomMap (real venue, your seats lit), right a stack of
// ResultRecap → WhyYouLanded → [NextInLine, fallback only] → CTAs. Collapses
// to a single column ≤860px with the map on top.
//
// PRICING MODEL: pay-as-bid / proxy. No uniform clearing line appears
// anywhere — every money string is the real amount the fan was charged.

import Link from "next/link";

import type { AllocationFinalView } from "@/lib/presenters";

import { NextInLine } from "./NextInLine";
import { ResultRecap } from "./ResultRecap";
import { RoomMap } from "./RoomMap";
import { WhyYouLanded } from "./WhyYouLanded";

export type RoomMapData = {
  sections: React.ComponentProps<typeof RoomMap>["sections"];
  venueName: string;
  capacity: number;
};

type Props = {
  view: AllocationFinalView;
  roomMap: RoomMapData | null;
};

// Anchor styled as a pill button. The shared Button is a <button>; CTAs here
// navigate, so we style a <Link> directly rather than nest a button in an
// anchor.
function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const style =
    variant === "primary"
      ? { background: "var(--ink-900)", color: "var(--paper)" }
      : { background: "transparent", color: "var(--ink-900)", border: "1px solid var(--border)" };
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full px-[18px] py-2 font-sans text-sm font-medium leading-none transition-colors duration-150"
      style={{ ...style, letterSpacing: "-0.01em" }}
    >
      {children}
    </Link>
  );
}

function Hero({
  background,
  eyebrow,
  title,
  seatline,
}: {
  background: string;
  eyebrow: string;
  title: string;
  seatline?: string;
}) {
  return (
    <div
      className="relative overflow-hidden text-center"
      style={{ background, color: "var(--paper)", padding: "48px 44px 40px" }}
    >
      <span
        className="font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--marquee-300)" }}
      >
        {eyebrow}
      </span>
      <h2
        className="font-display"
        style={{
          fontWeight: 700,
          fontSize: "clamp(2rem, 5vw, 3.4rem)",
          letterSpacing: "-0.04em",
          margin: "14px 0 0",
          lineHeight: 1.02,
        }}
      >
        {title}
      </h2>
      {seatline && (
        <div
          className="font-mono"
          style={{
            fontSize: "var(--text-md)",
            color: "color-mix(in srgb, var(--paper) 82%, transparent)",
            marginTop: 16,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {seatline}
        </div>
      )}
    </div>
  );
}

// A sunken note card (`.how`) for the edge-state explanations.
function NoteCard({
  heading,
  children,
  tone = "neutral",
}: {
  heading: string;
  children: React.ReactNode;
  tone?: "neutral" | "warm";
}) {
  return (
    <div
      className="rounded-lg"
      style={{
        background: tone === "warm" ? "var(--brand-bg)" : "var(--paper-2)",
        border: tone === "warm" ? "1px solid var(--greenwood-100)" : undefined,
        padding: "18px 20px",
      }}
    >
      <h4
        className="font-sans"
        style={{
          margin: "0 0 8px",
          fontWeight: 600,
          fontSize: "var(--text-sm)",
          color: tone === "warm" ? "var(--brand)" : "var(--fg)",
        }}
      >
        {heading}
      </h4>
      <p
        className="font-sans"
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          color: tone === "warm" ? "var(--greenwood-700)" : "var(--fg-muted)",
          lineHeight: 1.6,
        }}
      >
        {children}
      </p>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

export function AllocationResult({ view, roomMap }: Props) {
  const hero =
    view.kind === "placed" && view.state === "in-room" ? (
      <Hero
        background="var(--ink-900)"
        eyebrow="Seated fairly · confirmed"
        title="You're in the room."
        seatline={`${view.seatLine} · × ${view.size} tickets`}
      />
    ) : view.kind === "placed" ? (
      <Hero
        background="var(--ink-700)"
        eyebrow="Seated fairly · you're in"
        title="You're in — just not up front."
        seatline={`${view.seatLine} · × ${view.size} tickets, together`}
      />
    ) : view.kind === "card_failure" ? (
      <Hero
        background="var(--ink-700)"
        eyebrow="Seated fairly · you're in"
        title="You're in — one quick fix."
        seatline={`${view.seatLine} · × ${view.size} tickets`}
      />
    ) : (
      <Hero
        background="var(--ink-700)"
        eyebrow="Seated fairly"
        title="This one filled up — you're not charged."
      />
    );

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto px-4 py-10 md:px-7" style={{ maxWidth: 1000 }}>
        <div
          className="overflow-hidden"
          style={{
            background: "var(--page)",
            border: "1px solid var(--border-strong)",
            borderRadius: 14,
            boxShadow: "var(--shadow-md)",
          }}
        >
          {hero}

          <div className="grid grid-cols-1 min-[861px]:grid-cols-[1.1fr_1fr]">
            {roomMap && (
              <div
                className="border-b p-9 min-[861px]:border-b-0 min-[861px]:border-r"
                style={{ borderColor: "var(--border)" }}
              >
                <RoomMap
                  sections={roomMap.sections}
                  venueName={roomMap.venueName}
                  capacity={roomMap.capacity}
                />
              </div>
            )}

            <div className="flex flex-col gap-[26px] p-9">
              {view.kind === "placed" && (
                <>
                  <ResultRecap view={view} />
                  <WhyYouLanded view={view} />
                  {view.state === "fallback" &&
                    view.moveUpPosition !== null && (
                      <NextInLine position={view.moveUpPosition} />
                    )}
                </>
              )}

              {view.kind === "card_failure" && (
                <NoteCard heading="Keep your seats" tone="warm">
                  Your {view.size} seats are held
                  {view.deadlineLabel ? (
                    <>
                      {" "}
                      until <Mono>{view.deadlineLabel}</Mono>
                    </>
                  ) : (
                    " for a short window"
                  )}
                  . We just need a working card to charge{" "}
                  <Mono>{view.amountDueDisplay}</Mono> — no fees, ever. Update it
                  on the show page and they&apos;re yours.
                </NoteCard>
              )}

              {view.kind === "unplaced" && (
                <>
                  <NoteCard heading="You're not charged — not a cent." tone="warm">
                    More fans made offers than there were seats this time
                    {view.marginalDisplay ? (
                      <>
                        , and yours didn&apos;t reach the last seat taken (
                        <Mono>{view.marginalDisplay}</Mono>)
                      </>
                    ) : null}
                    . Your card authorization has been released in full — no
                    charge, no fees, ever. We&apos;ll let you know the moment
                    more dates open up.
                  </NoteCard>
                  <div
                    className="flex flex-col overflow-hidden rounded-lg"
                    style={{
                      gap: 1,
                      background: "var(--border)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <RecapRow label={`Your offer  × ${view.size}`} value={view.offerPriceDisplay} />
                    <RecapRow label="Charged" value="$0.00" />
                  </div>
                </>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                {view.kind === "card_failure" ? (
                  <>
                    <LinkButton href={`/shows/${view.showId}`}>Update card</LinkButton>
                    <LinkButton href="/dashboard" variant="ghost">
                      Back to my shows
                    </LinkButton>
                  </>
                ) : view.kind === "unplaced" ? (
                  <>
                    <LinkButton href="/">See other shows</LinkButton>
                    <LinkButton href="/dashboard" variant="ghost">
                      Back to my shows
                    </LinkButton>
                  </>
                ) : (
                  <>
                    {view.ticketReady ? (
                      <LinkButton href={`/tickets/${view.showId}`}>
                        View ticket
                      </LinkButton>
                    ) : (
                      <LinkButton href="/dashboard">Back to my shows</LinkButton>
                    )}
                    {view.ticketReady && (
                      <LinkButton href="/dashboard" variant="ghost">
                        Back to my shows
                      </LinkButton>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function RecapRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ background: "var(--page)", padding: "13px 16px" }}
    >
      <span className="font-sans" style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono"
        style={{ fontSize: "var(--text-md)", color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
    </div>
  );
}
