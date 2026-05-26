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
//   - Live preview / venue map / rank board (right column in the
//     prototype) are NOT included here. They're decorative for the
//     submit flow and need synthetic placement math that doesn't
//     reflect real allocation. Slice 11+.
//
// The submit POST is the dev stub (ALLOW_DEV_OFFER_STUB=true) until
// ADR-0003 is decided. When the flag is off the route returns 503 and
// the composer renders the message.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { RadioGroup, type RadioOption } from "@/components/ui/RadioGroup";
import { Stepper } from "@/components/ui/Stepper";
import { TextInput } from "@/components/ui/TextInput";
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

function defaultPrice(existingOffer: OfferView | null): string {
  if (!existingOffer) return "42";
  return (existingOffer.priceCents / 100).toFixed(
    existingOffer.priceCents % 100 === 0 ? 0 : 2,
  );
}

export function OfferComposer({ show, existingOffer }: Props) {
  const router = useRouter();

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

  const canSubmit = priceIsValid && autoMaxIsValid && !submitting;

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
    // preferredTier is required for the two tier-bound options.
    // Hardcoded to "premium" for now — real tier picking lands when
    // the show view exposes its full tier list.
    if (tier !== "any") {
      payload.preferredTier = "premium";
    }
    if (autoBid && autoMaxCents !== null) {
      payload.autoBidCapCents = autoMaxCents;
    }

    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // Refresh so the dashboard's "yourOffer" chip reflects the
        // new state on the way back. router.push is client-side
        // navigation; refresh forces the RSC to re-fetch.
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
