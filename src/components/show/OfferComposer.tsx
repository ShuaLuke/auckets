// The fan-side offer composer. Matches the prototype's left-column
// composer in design/ui_kits/auckets/screens/Show.jsx — group size,
// price, tier preference, optional auto-bid — and wires its submit to
// POST /api/offers.
//
// Scope decisions for slice 10:
//   - Market channel only. The Bleacher toggle in the prototype is
//     gated on NEW-8 (Cope hasn't confirmed) — including it now would
//     bake unstable UX into the UI port.
//   - Tier options match the prototype literally (3 of the 4 schema
//     values). The 4th — "this_or_better" — exists in the schema but
//     isn't surfaced in the prototype yet.
//   - preferredTier is hardcoded to "premium" for the two tier-bound
//     options. Real per-show tier picking lands in a later slice once
//     the venue's tier list is part of the show view.
//
// Stripe wiring (slice 21 + 20):
//   - When NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set, the inner form
//     is wrapped in <Elements> and a CardElement is rendered. On
//     submit we createPaymentMethod client-side and send the
//     PaymentMethod ID to POST /api/offers, which takes the real
//     PaymentIntent path. Both first submission and revision are
//     supported (slice 20 — revision cancels the prior auth and holds
//     a new one for the revised amount; the fan re-enters their card
//     on revision until saved-card reuse lands).
//   - When the key is absent, no card field renders and submit posts
//     without a payment-method ID — the route falls back to the dev
//     stub (gated on ALLOW_DEV_OFFER_STUB).

"use client";

import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { RadioGroup, type RadioOption } from "@/components/ui/RadioGroup";
import { Stepper } from "@/components/ui/Stepper";
import { TextInput } from "@/components/ui/TextInput";
import { env } from "@/lib/env";
import { formatCents, parseDollars } from "@/lib/money";
import { type OfferView, type ShowDetailView } from "@/lib/presenters";

type Props = {
  show: ShowDetailView;
  // Pre-populated from the user's existing offer (revise flow). Null
  // when the user hasn't submitted yet.
  existingOffer: OfferView | null;
};

type TierValue = "specific" | "this_or_worse" | "any";

const TIER_OPTIONS: ReadonlyArray<RadioOption<TierValue>> = [
  {
    value: "specific",
    label: "Premium only",
    hint: "Place me in premium or not at all.",
  },
  {
    value: "this_or_worse",
    label: "Premium or below",
    hint: "Waterfall me down if premium fills.",
  },
  {
    value: "any",
    label: "Anywhere I fit",
    hint: "I just want a seat.",
  },
];

const RANK_KEY_MULTIPLIER = 1000;

// loadStripe is called once at module load (the recommended pattern —
// it caches the Stripe.js script load). null when no publishable key
// is configured, which puts the composer in dev-stub mode.
const stripePromise: Promise<Stripe | null> | null =
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    ? loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    : null;

// CardElement styling — match the design's ink palette + sans font so
// the Stripe iframe doesn't look pasted-in. Stripe only lets us style a
// fixed set of properties on the iframe content.
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

function defaultPrice(existingOffer: OfferView | null): string {
  if (!existingOffer) return "42";
  return (existingOffer.priceCents / 100).toFixed(
    existingOffer.priceCents % 100 === 0 ? 0 : 2,
  );
}

// Outer component — decides Stripe mode and provides the Elements
// context when a publishable key is configured. The form itself lives
// in OfferComposerForm so it can use the useStripe/useElements hooks
// (which require an <Elements> ancestor).
export function OfferComposer({ show, existingOffer }: Props) {
  const stripeEnabled = stripePromise !== null;

  if (stripeEnabled) {
    return (
      <Elements stripe={stripePromise}>
        <OfferComposerForm
          show={show}
          existingOffer={existingOffer}
          stripeEnabled
        />
      </Elements>
    );
  }

  return (
    <OfferComposerForm
      show={show}
      existingOffer={existingOffer}
      stripeEnabled={false}
    />
  );
}

function OfferComposerForm({
  show,
  existingOffer,
  stripeEnabled,
}: Props & { stripeEnabled: boolean }) {
  const router = useRouter();
  // These hooks return null until Stripe.js finishes loading (and
  // always null when there's no <Elements> ancestor, i.e. stub mode).
  const stripe = useStripe();
  const elements = useElements();

  const [size, setSize] = useState(existingOffer?.size ?? 4);
  const [price, setPrice] = useState(defaultPrice(existingOffer));
  const [tier, setTier] = useState<TierValue>("this_or_worse");
  const [autoBid, setAutoBid] = useState(false);
  const [autoMax, setAutoMax] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceCents = parseDollars(price);
  const priceIsValid = priceCents !== null && priceCents > 0;
  const totalCents = priceIsValid ? priceCents * size : 0;
  const rankKey = priceIsValid ? priceCents * RANK_KEY_MULTIPLIER + size : null;

  const autoMaxCents = parseDollars(autoMax);
  const autoMaxIsValid =
    !autoBid || (autoMaxCents !== null && priceCents !== null && autoMaxCents >= priceCents);

  // In Stripe mode the form can't submit until Stripe.js has loaded
  // (stripe + elements non-null). In stub mode that gate doesn't apply.
  const stripeReady = !stripeEnabled || (stripe !== null && elements !== null);
  const canSubmit = priceIsValid && autoMaxIsValid && stripeReady && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || priceCents === null) return;

    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      showId: show.id,
      groupSize: size,
      pricePerTicketCents: priceCents,
      tierPreference: tier,
      channel: "market",
      autoBidEnabled: autoBid,
    };
    if (tier !== "any") {
      payload.preferredTier = "premium";
    }
    if (autoBid && autoMaxCents !== null) {
      payload.autoBidCapCents = autoMaxCents;
    }

    // Stripe mode: tokenize the card into a PaymentMethod before
    // posting. The route uses the PaymentMethod ID to create the real
    // PaymentIntent (auth hold). Any card error short-circuits here
    // with a user-facing message — we never post a half-formed offer.
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
      // Idempotency key per submit attempt — protects the real-path
      // PaymentIntent create from network-retry duplicates. Harmless
      // on the stub path (the route only reads it for Stripe).
      if (stripeEnabled && typeof crypto !== "undefined" && crypto.randomUUID) {
        headers["Idempotency-Key"] = crypto.randomUUID();
      }

      const res = await fetch("/api/offers", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // Refresh so the dashboard's "yourOffer" chip reflects the
        // new state on the way back.
        router.push("/dashboard");
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

  const submitLabel = existingOffer ? "Revise offer" : "Submit offer";

  return (
    <Card className="sticky top-20" style={{ padding: 24 }}>
      <Eyebrow className="mb-3.5">Your offer</Eyebrow>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        <Field
          label="Group size"
          hint="Up to 10 per fan, per show."
        >
          <Stepper value={size} onChange={setSize} min={1} max={10} />
        </Field>

        <Field
          label="Price per ticket"
          hint="No hidden fees. Stripe fees come from artist payout."
        >
          <TextInput
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            prefix="$"
            mono
            inputMode="decimal"
          />
        </Field>

        <Field label="Tier preference">
          <RadioGroup
            name="tierPreference"
            value={tier}
            onChange={setTier}
            options={TIER_OPTIONS}
          />
        </Field>

        {/* Auto-bid (ADR-0017). Matches the prototype's auto-raise
            toggle on Show.jsx lines 90-112. */}
        <div
          className="rounded-lg p-3.5"
          style={{ background: "var(--paper)" }}
        >
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={autoBid}
              onChange={(e) => setAutoBid(e.target.checked)}
              className="mt-[3px]"
              style={{ accentColor: "var(--brand)" }}
            />
            <div className="flex-1">
              <div
                className="font-sans text-[13px] font-medium"
                style={{ color: "var(--ink-900)" }}
              >
                Auto-raise if I&apos;m displaced
              </div>
              <div
                className="mt-0.5 font-sans text-[11px]"
                style={{ color: "var(--fg-subtle)" }}
              >
                Raise by $5 each time my projected seat drops, up to my cap.
              </div>
            </div>
          </label>
          {autoBid && (
            <div className="mt-3 flex items-center gap-2.5">
              <span
                className="font-sans text-xs"
                style={{ color: "var(--ink-500)", flexShrink: 0 }}
              >
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
            <div
              className="mt-2 font-sans text-xs"
              style={{ color: "var(--brick-500)" }}
            >
              Cap must be ≥ your price.
            </div>
          )}
        </div>

        {/* Card field — only in Stripe mode. The CardElement is a
            Stripe-hosted iframe; the fan's card details never touch
            our server, only the resulting PaymentMethod ID does. */}
        {stripeEnabled && (
          <Field
            label="Card"
            hint="Authorized now; only charged if you're placed."
          >
            <div
              className="rounded-lg px-3 py-3"
              style={{
                background: "var(--page)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <CardElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </Field>
        )}

        {/* Total / rank-key summary. Matches the prototype's panel
            on Show.jsx lines 125-139. */}
        <div
          className="flex flex-col gap-1.5 rounded-lg p-3"
          style={{ background: "var(--paper)" }}
        >
          <div className="flex justify-between text-xs" style={{ color: "var(--ink-500)" }}>
            <span>Total if placed</span>
            <span
              className="font-mono font-semibold"
              style={{ color: "var(--ink-900)" }}
            >
              {priceIsValid ? formatCents(totalCents) : "—"}
            </span>
          </div>
          <div className="flex justify-between text-xs" style={{ color: "var(--ink-500)" }}>
            <span>Rank key</span>
            <span
              className="rounded px-1.5 py-px font-mono text-xs"
              style={{ background: "var(--ink-100)", color: "var(--ink-700)" }}
            >
              {rankKey ?? "—"}
            </span>
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg p-3 font-sans text-xs"
            style={{
              background: "var(--brick-100)",
              color: "var(--brick-700)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <Button
          variant="brand"
          size="lg"
          type="submit"
          disabled={!canSubmit}
          className="justify-center"
        >
          {submitting ? "Submitting…" : submitLabel}
        </Button>

        <div
          className="text-center font-sans text-[11px]"
          style={{ color: "var(--fg-subtle)" }}
        >
          You can revise upward until 24h before doors. Never downward.
        </div>
      </form>
    </Card>
  );
}
