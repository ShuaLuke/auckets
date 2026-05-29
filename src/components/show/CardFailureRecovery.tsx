// Fan-facing card-failure recovery (ADR-0003 §5) — the real counterpart to
// the prototype's CardFailure.jsx. Shown when the fan's own offer is in
// 'card_failure' within the recovery window (the page gates on the presenter).
// A warning banner opens a modal that collects a new card via Stripe Elements
// and POSTs it to /api/offers/[offerId]/recover; on success the seat is saved.
//
// Mirrors OfferComposer's outer/inner <Elements> split: the hooks
// (useStripe/useElements) need an <Elements> ancestor, so the interactive
// form lives in the inner component and only mounts when a publishable key is
// configured. Without one (dev), the banner explains recovery isn't available
// here rather than rendering a dead card field.

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
import { env } from "@/lib/env";
import type { CardFailureRecoveryView } from "@/lib/presenters";

type Props = { view: CardFailureRecoveryView };

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

export function CardFailureRecovery({ view }: Props) {
  if (stripePromise) {
    return (
      <Elements stripe={stripePromise}>
        <RecoveryBanner view={view} stripeEnabled />
      </Elements>
    );
  }
  return <RecoveryBanner view={view} stripeEnabled={false} />;
}

function RecoveryBanner({
  view,
  stripeEnabled,
}: Props & { stripeEnabled: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg p-4"
      style={{ background: "#F6E6CC", border: "1px solid #C99A4B" }}
      role="alert"
    >
      <div className="flex-1" style={{ minWidth: 240 }}>
        <div
          className="font-sans"
          style={{ fontSize: 14, fontWeight: 600, color: "#0E0F0C" }}
        >
          Your card was declined — your seat is still held.
        </div>
        <div
          className="font-sans"
          style={{ fontSize: 12, color: "#8F6A2A", marginTop: 2 }}
        >
          Update your card in the next {view.minutesLeft} min to keep your
          seat. We&apos;ll charge {view.amountLabel}.
        </div>
      </div>
      {stripeEnabled ? (
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          Update card
        </Button>
      ) : (
        <span className="font-sans" style={{ fontSize: 12, color: "#8F6A2A" }}>
          Card updates aren&apos;t available in this environment.
        </span>
      )}
      {open && (
        <RecoveryModal view={view} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function RecoveryModal({
  view,
  onClose,
}: {
  view: CardFailureRecoveryView;
  onClose: () => void;
}) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;

    setSubmitting(true);
    setError(null);
    try {
      const { error: pmError, paymentMethod } =
        await stripe.createPaymentMethod({ type: "card", card });
      if (pmError || !paymentMethod) {
        setError(pmError?.message ?? "Couldn't read that card.");
        return;
      }

      const res = await fetch(`/api/offers/${view.offerId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripePaymentMethodId: paymentMethod.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        const message =
          data && typeof data === "object" && "error" in data
            ? String(data.error)
            : `Recovery failed (HTTP ${res.status})`;
        setError(
          res.status === 410
            ? "The recovery window has expired — your seat was released."
            : message,
        );
        return;
      }

      setSucceeded(true);
      // Let the success state breathe, then re-render the page (the banner
      // drops out — the offer is now 'charged').
      setTimeout(() => router.refresh(), 1300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "rgba(14,15,12,.4)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Update your card"
    >
      <div
        className="w-full rounded-2xl bg-white p-8"
        style={{ maxWidth: 440, boxShadow: "0 24px 48px rgba(14,15,12,.20)" }}
      >
        {succeeded ? (
          <div className="text-center">
            <h3
              className="font-sans"
              style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}
            >
              Your seat is saved.
            </h3>
            <p className="font-sans" style={{ fontSize: 14, color: "#46443B" }}>
              We&apos;ve charged your new card {view.amountLabel}. The seat
              stays yours.
            </p>
          </div>
        ) : (
          <>
            <h3
              className="font-sans"
              style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}
            >
              Update your card
            </h3>
            <p
              className="font-sans"
              style={{ fontSize: 13, color: "#46443B", marginBottom: 16 }}
            >
              We&apos;ll charge {view.amountLabel} to reclaim your seat.
            </p>
            <div
              className="rounded-lg p-3"
              style={{ border: "1px solid rgba(14,15,12,.22)", marginBottom: 12 }}
            >
              <CardElement options={CARD_ELEMENT_OPTIONS} />
            </div>
            {error && (
              <div
                className="font-sans"
                style={{ fontSize: 12, color: "#A93C2A", marginBottom: 12 }}
              >
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={submitting || !stripe}
              >
                {submitting ? "Charging…" : `Pay ${view.amountLabel}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
