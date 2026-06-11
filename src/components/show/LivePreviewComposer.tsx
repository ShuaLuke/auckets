// LivePreviewComposer — Change 04. Flips the show page so the venue map +
// live "right now, you'd be in {tier}" projection is the centerpiece and the
// offer is a price DIAL the fan turns and watches. Same engine, same
// submission underneath — the feeling changes completely.
//
// What's live: turning the dial (or changing group size / tier) debounces a
// call to POST /api/shows/[id]/projection (read-only, cached server-side) and
// re-shades the map + standing line within ~250ms. The map holds its last
// state while a refresh is in flight — never a spinner, never an error.
//
// What's SACRED and unchanged: submission. The exact POST /api/offers payload,
// the Stripe createPaymentMethod tokenization, idempotency key, and revision
// flow are ported verbatim from OfferComposer. The live preview is purely
// additive — if it's slow or down, the dial still submits.
//
// Voice: guaranteed-floor, never a raw rank (README §6.1). Pay-as-bid: you pay
// exactly what you offer — no clearing line, no fees.

"use client";

import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { dialTickFractions } from "@/components/show/dial-ticks";
import { LiveRoomMap } from "@/components/show/LiveRoomMap";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { RadioGroup, type RadioOption } from "@/components/ui/RadioGroup";
import { Stepper } from "@/components/ui/Stepper";
import { TextInput } from "@/components/ui/TextInput";
import { env } from "@/lib/env";
import { useAnimatedNumber } from "@/lib/hooks/use-animated-number";
import { formatCents, parseDollars } from "@/lib/money";
import {
  type FanSection,
  type LiveProjectionView,
  type OfferView,
  type ShowDetailView,
} from "@/lib/presenters";

type Props = {
  show: ShowDetailView;
  existingOffer: OfferView | null;
  sections: readonly FanSection[];
  venueName: string;
  capacity: number;
  initialProjection: LiveProjectionView | null;
};

type TierValue = "specific" | "this_or_worse" | "any";

const TIER_OPTIONS: ReadonlyArray<RadioOption<TierValue>> = [
  {
    value: "specific",
    label: "Front section only",
    hint: "Seat me up front, or not at all.",
  },
  {
    value: "this_or_worse",
    label: "Up front, or wherever I fit",
    hint: "Aim high; settle me back if it fills.",
  },
  {
    value: "any",
    label: "Anywhere I fit — just get me in",
    hint: "I just want to be in the room.",
  },
];

const PROJECTION_DEBOUNCE_MS = 250;

// Must match the thumb size in design-system.css (.auk-dial::-webkit-slider-thumb
// / ::-moz-range-thumb). Used to align tier-floor ticks with the thumb's
// center: a range thumb travels (track width − thumb width), not the full
// track, so a tick at fraction f sits at half-thumb + f × (100% − thumb).
const DIAL_THUMB_PX = 22;

const stripePromise: Promise<Stripe | null> | null =
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    ? loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    : null;

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: "#0E0F0C",
      fontFamily: '"Geist", system-ui, sans-serif',
      fontSize: "15px",
      "::placeholder": { color: "#9C9789" },
    },
    invalid: { color: "#A93C2A" },
  },
} as const;

function defaultPrice(existingOffer: OfferView | null, fallbackCents: number): string {
  const cents = existingOffer?.priceCents ?? fallbackCents;
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

// Cheapest tier floor (the "just get me in" price) and a sensible dial ceiling
// (double the priciest floor — room to reach for the front without a runaway
// slider; the exact input still allows anything above).
function dialBounds(tierFloorsCents: Record<string, number>): {
  floorCents: number;
  minDollars: number;
  maxDollars: number;
} {
  const floors = Object.values(tierFloorsCents);
  const floorCents = floors.length > 0 ? Math.min(...floors) : 1500;
  const topCents = floors.length > 0 ? Math.max(...floors) : 6000;
  return {
    floorCents,
    minDollars: Math.max(1, Math.floor(floorCents / 100)),
    maxDollars: Math.max(Math.ceil((topCents * 2) / 100), 10),
  };
}

export function LivePreviewComposer(props: Props) {
  const stripeEnabled = stripePromise !== null;
  if (stripeEnabled) {
    return (
      <Elements stripe={stripePromise}>
        <LivePreviewComposerForm {...props} stripeEnabled />
      </Elements>
    );
  }
  return <LivePreviewComposerForm {...props} stripeEnabled={false} />;
}

function LivePreviewComposerForm({
  show,
  existingOffer,
  sections,
  venueName,
  capacity,
  initialProjection,
  stripeEnabled,
}: Props & { stripeEnabled: boolean }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();

  const tierFloors = show.tierFloorsCents;
  const bounds = dialBounds(tierFloors);

  const [size, setSize] = useState(existingOffer?.size ?? 2);
  const [price, setPrice] = useState(defaultPrice(existingOffer, bounds.floorCents));
  const [tier, setTier] = useState<TierValue>("this_or_worse");
  const [autoBid, setAutoBid] = useState(false);
  const [autoMax, setAutoMax] = useState(
    () => `${Math.round((bounds.floorCents * 2) / 100)}`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  // Live projection state. Seeded with the server's first-paint projection so
  // the map + standing aren't blank before the first dial move.
  const [projection, setProjection] = useState<LiveProjectionView | null>(
    initialProjection,
  );
  const [projecting, setProjecting] = useState(false);

  const priceCents = parseDollars(price);
  const priceIsValid = priceCents !== null && priceCents > 0;
  const totalCents = priceIsValid ? priceCents * size : 0;

  const autoMaxCents = parseDollars(autoMax);
  const autoMaxIsValid =
    !autoBid ||
    (autoMaxCents !== null && priceCents !== null && autoMaxCents >= priceCents);
  const holdCents = autoBid && autoMaxCents !== null ? autoMaxCents * size : totalCents;

  const stripeReady = !stripeEnabled || (stripe !== null && elements !== null);
  const canSubmit = priceIsValid && autoMaxIsValid && stripeReady && !submitting;

  // Rolling dollar displays (UI-4): tween in integer cents so the money lines
  // count up/down with the dial instead of snapping. The hook snaps instantly
  // under prefers-reduced-motion.
  const animatedPriceCents = useAnimatedNumber(priceCents ?? 0);
  const animatedHoldCents = useAnimatedNumber(holdCents);

  const windowClosed =
    projection !== null && projection.available === false;

  // --- Live projection: debounced, abortable, calm on failure -------------
  const seq = useRef(0);
  useEffect(() => {
    if (!priceIsValid || priceCents === null || windowClosed) return;
    const mySeq = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setProjecting(true);
      fetch(`/api/shows/${show.id}/projection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          pricePerTicketCents: priceCents,
          groupSize: size,
          tierPreference: tier,
          preferredTier: tier === "any" ? null : "premium",
          autoBidEnabled: autoBid,
          autoBidCapCents: autoBid && autoMaxCents !== null ? autoMaxCents : null,
        }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<LiveProjectionView>) : null))
        .then((value) => {
          // Ignore stale responses (the dial moved again before this landed).
          if (value && mySeq === seq.current) setProjection(value);
        })
        .catch(() => {
          // Network/abort: hold the last projection. Submission still works.
        })
        .finally(() => {
          if (mySeq === seq.current) setProjecting(false);
        });
    }, PROJECTION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    show.id,
    priceCents,
    priceIsValid,
    size,
    tier,
    autoBid,
    autoMaxCents,
    windowClosed,
  ]);

  const expressGetMeIn = useCallback(() => {
    setTier("any");
    setPrice(`${Math.max(1, Math.round(bounds.floorCents / 100))}`);
  }, [bounds.floorCents]);

  // --- Submission (ported verbatim from OfferComposer — sacred path) ------
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || priceCents === null) return;

    setSubmitting(true);
    setError(null);
    setSucceeded(false);

    const payload: Record<string, unknown> = {
      showId: show.id,
      groupSize: size,
      pricePerTicketCents: priceCents,
      tierPreference: tier,
      channel: "market",
      autoBidEnabled: autoBid,
    };
    if (tier !== "any") payload.preferredTier = "premium";
    if (autoBid && autoMaxCents !== null) payload.autoBidCapCents = autoMaxCents;

    if (stripeEnabled) {
      if (!stripe || !elements) {
        setError("Payment form is still loading. Try again in a moment.");
        setSubmitting(false);
        return;
      }
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setError("Card field not found. Reload the page and try again.");
        setSubmitting(false);
        return;
      }
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
      });
      if (pmError || !paymentMethod) {
        setError(pmError?.message ?? "Could not validate your card.");
        setSubmitting(false);
        return;
      }
      payload.stripePaymentMethodId = paymentMethod.id;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (stripeEnabled && typeof crypto !== "undefined" && crypto.randomUUID) {
        headers["Idempotency-Key"] = crypto.randomUUID();
      }
      const res = await fetch("/api/offers", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSucceeded(true);
        router.refresh();
        return;
      }
      const body: { error?: string } = await res.json().catch(() => ({}));
      setError(body.error ?? `Submission failed (HTTP ${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = existingOffer ? "Update my offer" : "Make this my offer";

  // The dial's clamped dollar value, its fill (feeds the track gradient via a
  // CSS custom property), and the tier-floor tick positions.
  const dialValue = Math.min(
    bounds.maxDollars,
    Math.max(bounds.minDollars, Math.round((priceCents ?? 0) / 100)),
  );
  const dialFillPct =
    bounds.maxDollars > bounds.minDollars
      ? ((dialValue - bounds.minDollars) /
          (bounds.maxDollars - bounds.minDollars)) *
        100
      : 0;
  const dialTicks = dialTickFractions(
    tierFloors,
    bounds.minDollars,
    bounds.maxDollars,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Hero: the live map + the standing line. */}
      <div
        className="overflow-hidden rounded-xl border"
        style={{ background: "var(--page)", borderColor: "var(--border)" }}
      >
        <div className="border-b p-6 md:p-7" style={{ borderColor: "var(--border)" }}>
          <StandingReadout
            projection={projection}
            size={size}
            projecting={projecting}
          />
        </div>
        <div className="p-6 md:p-7">
          <LiveRoomMap
            sections={sections}
            venueName={venueName}
            capacity={capacity}
            yourSeats={
              projection && projection.available ? projection.yourSeats : null
            }
            updating={projecting}
          />
        </div>
      </div>

      {/* The dial + form. */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-[18px] rounded-xl border p-6 md:p-7"
        style={{ background: "var(--page)", borderColor: "var(--border)" }}
      >
        <div>
          <Eyebrow className="mb-2">What&apos;s this night worth to you?</Eyebrow>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <input
                type="range"
                min={bounds.minDollars}
                max={bounds.maxDollars}
                step={1}
                value={dialValue}
                onChange={(e) => setPrice(e.target.value)}
                aria-label="Price per ticket"
                className="auk-dial w-full cursor-pointer"
                // Feeds the filled-track gradient in design-system.css.
                // Cast: React.CSSProperties doesn't model custom properties.
                style={{ "--auk-dial-fill": `${dialFillPct}%` } as React.CSSProperties}
              />
              {/* Tier-floor ticks, aligned to the thumb's travel (the thumb
                  center spans width − thumb, not the full track). */}
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                {dialTicks.map((t) => (
                  <span
                    key={t.tier}
                    className="auk-dial-tick"
                    style={{
                      left: `calc(${DIAL_THUMB_PX / 2}px + (100% - ${DIAL_THUMB_PX}px) * ${t.fraction})`,
                    }}
                  />
                ))}
                {/* TODO(liveness slice): when the projection carries a live
                    "min offer to get in right now" value, render it here as a
                    distinct marker. LiveProjectionView doesn't expose one yet. */}
              </div>
            </div>
            <div style={{ width: 120 }}>
              <TextInput
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                prefix="$"
                mono
                inputMode="decimal"
                aria-label="Exact price per ticket"
              />
            </div>
          </div>
          <p
            className="mt-2 font-sans text-xs"
            style={{ color: "var(--fg-subtle)", lineHeight: 1.5 }}
          >
            You pay exactly what you offer if you&apos;re seated —{" "}
            <span
              className="font-mono"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {priceIsValid ? formatCents(animatedPriceCents) : "—"}
            </span>{" "}
            a ticket. Never a fee.
          </p>
        </div>

        {/* Express path — quiet, one tap. */}
        <button
          type="button"
          onClick={expressGetMeIn}
          className="self-start rounded-full px-3 py-1.5 font-sans text-[13px]"
          style={{ border: "1px solid var(--border)", color: "var(--fg-muted)", background: "transparent" }}
        >
          Don&apos;t want to pick a price? Get me in at the floor — any seat.
        </button>

        <Field label="How many of you?" hint="Up to 10 per fan. We seat your group together.">
          <Stepper value={size} onChange={setSize} min={1} max={show.maxGroupSize ?? 10} />
        </Field>

        <Field label="Where would you like to be?">
          <RadioGroup name="tierPreference" value={tier} onChange={setTier} options={TIER_OPTIONS} />
        </Field>

        <div className="rounded-lg p-3.5" style={{ background: "var(--paper)" }}>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={autoBid}
              onChange={(e) => setAutoBid(e.target.checked)}
              className="mt-[3px]"
              style={{ accentColor: "var(--brand)" }}
            />
            <div className="flex-1">
              <div className="font-sans text-[13px] font-medium" style={{ color: "var(--ink-900)" }}>
                Auto-raise to hold my section
              </div>
              <div className="mt-0.5 font-sans text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                We&apos;ll raise your offer only if someone passes you — never
                above your cap. You only ever pay what it takes to hold your
                seats.
              </div>
            </div>
          </label>
          {autoBid && (
            <div className="mt-3 flex items-center gap-2.5">
              <span className="font-sans text-xs" style={{ color: "var(--ink-500)", flexShrink: 0 }}>
                Cap
              </span>
              <TextInput
                value={autoMax}
                onChange={(e) => setAutoMax(e.target.value)}
                prefix="$"
                mono
                inputMode="decimal"
                wrapperStyle={{ flex: 1 }}
              />
            </div>
          )}
          {autoBid && !autoMaxIsValid && (
            <div className="mt-2 font-sans text-xs" style={{ color: "var(--brick-500)" }}>
              Cap must be ≥ your offer.
            </div>
          )}
        </div>

        {stripeEnabled && (
          <Field label="Card" hint="Held now; only ever charged if you're seated.">
            <div
              className="rounded-lg px-3 py-3"
              style={{ background: "var(--page)", border: "1px solid var(--border-strong)" }}
            >
              <CardElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </Field>
        )}

        {error && (
          <div
            className="rounded-lg p-3 font-sans text-xs"
            style={{ background: "var(--brick-100)", color: "var(--brick-700)", lineHeight: 1.5 }}
          >
            {error}
          </div>
        )}

        {/* Honest anticipation, not a verdict: nothing is decided until the
            window closes, so this confirms the offer, names where the live
            projection has the fan right now, and points at the lock. */}
        {succeeded && !error && (
          <div
            className="auk-reveal rounded-lg p-4 font-sans text-[13px]"
            style={{
              background: "var(--brand-bg)",
              color: "var(--fg)",
              border: "1px solid var(--brand)",
              lineHeight: 1.55,
            }}
          >
            <strong>Your offer is in.</strong>{" "}
            {projection &&
            projection.available &&
            projection.placed &&
            projection.tierLabel
              ? `Right now that lands you in ${projection.tierLabel}${
                  projection.rowName ? `, around Row ${projection.rowName}` : ""
                }. `
              : "The map above shows where you stand as offers come in. "}
            Seats lock when the window closes — we&apos;ll email you the moment
            they&apos;re decided. Until then, you can raise your offer any time.
          </div>
        )}

        <Button variant="brand" size="lg" type="submit" disabled={!canSubmit} className="justify-center">
          {submitting ? "Saving…" : submitLabel}
        </Button>

        {/* The reassurance line, verbatim (README §5), then the honest
            pending-hold explainer (pay-as-bid — never a clearing line). */}
        <p className="text-center font-sans text-xs" style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}>
          You&apos;re only ever charged if you&apos;re in — and never a penny in
          fees.
        </p>
        {priceIsValid && (
          <p className="text-center font-sans text-[11px]" style={{ color: "var(--fg-subtle)", lineHeight: 1.5 }}>
            You&apos;ll see a pending hold of{" "}
            <span
              className="font-mono"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCents(animatedHoldCents)}
            </span>
            ; it&apos;s
            only captured if you&apos;re seated, and only ever what you offered.
            You can raise your offer until 24h before doors — never lower it once
            placed.
          </p>
        )}
      </form>
    </div>
  );
}

function StandingReadout({
  projection,
  size,
  projecting,
}: {
  projection: LiveProjectionView | null;
  size: number;
  projecting: boolean;
}) {
  // Window closed / preview unavailable — calm, never an error.
  if (projection && projection.available === false) {
    return (
      <div>
        <Eyebrow className="mb-2">Right now</Eyebrow>
        <p className="font-sans text-base" style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}>
          Offers aren&apos;t open right now. We&apos;ll show your projected seats
          again the moment they are.
        </p>
      </div>
    );
  }

  // The pulse (.auk-computing) makes the wait read as the engine working.
  const updatingTag = projecting ? (
    <span
      className="auk-computing ml-2 font-mono text-[11px]"
      style={{ color: "var(--fg-faint)" }}
    >
      updating…
    </span>
  ) : null;

  // No placement at the current price (rare under the guaranteed floor, but
  // possible on a genuinely oversubscribed show).
  if (projection && projection.available && !projection.placed) {
    return (
      <div>
        <Eyebrow className="mb-2">Right now{updatingTag}</Eyebrow>
        <p
          className="auk-textswap font-display text-2xl"
          style={{ lineHeight: 1.15 }}
        >
          This one&apos;s filling up — raise your offer to get in.
        </p>
      </div>
    );
  }

  if (!projection || !projection.available) {
    // First paint with no projection yet.
    return (
      <div>
        <Eyebrow className="mb-2">Right now{updatingTag}</Eyebrow>
        <p className="font-sans text-base" style={{ color: "var(--fg-muted)" }}>
          Set a price to see where you&apos;d be seated.
        </p>
      </div>
    );
  }

  const groupTail =
    size > 1 ? `, your ${size} seats together` : "";
  const seatLine =
    projection.rowName && projection.seatRange
      ? `${projection.tierLabel} · Row ${projection.rowName} · seats ${projection.seatRange}`
      : projection.tierLabel ?? "";

  return (
    <div>
      <Eyebrow className="mb-2">Right now, you&apos;d be in{updatingTag}</Eyebrow>
      {/* Keyed remount: when the projected tier or row changes, the headline
          crossfades in (.auk-textswap) instead of swapping flatly. Size-only
          rewordings keep the node — no flicker while stepping the group. */}
      <p
        key={`${projection.tierLabel ?? ""}|${projection.rowName ?? ""}`}
        className="auk-textswap font-display text-2xl"
        style={{ lineHeight: 1.15 }}
      >
        {projection.tierLabel}
        {projection.rowName ? ` — around Row ${projection.rowName}` : ""}
        {groupTail}.
      </p>
      <p className="mt-2 font-mono text-sm" style={{ color: "var(--fg-muted)" }}>
        {seatLine}
      </p>
      {projection.standing?.nextTier && (
        <p
          key={projection.standing.nextTier.label}
          className="auk-textswap mt-3 font-sans text-sm"
          style={{ color: "var(--brand)" }}
        >
          You&apos;re in. Raise to reach {projection.standing.nextTier.label}{" "}
          (+{projection.standing.nextTier.deltaDisplay}).
        </p>
      )}
      {projection.standing?.inTopTier && (
        <p
          className="auk-textswap mt-3 font-sans text-sm"
          style={{ color: "var(--brand)" }}
        >
          You&apos;re in the front section — nothing more to do.
        </p>
      )}
    </div>
  );
}
