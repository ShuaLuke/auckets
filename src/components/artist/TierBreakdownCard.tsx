// Per-tier breakdown card on the ShowAdmin page. Maps to the three
// tier options the OfferComposer actually surfaces today — see
// presentTierBreakdown for the schema-value mapping.
//
// Visual layout is a 3-column tile grid, similar in spirit to the
// "Price floor by section" card in design/ui_kits/auckets/screens/
// ShowAdmin.jsx (lines 139-167). That prototype shows per-tier price
// floors, which we don't have a data model for yet — this card shows
// what the artist CAN see today: how many offers and tickets are
// pulling toward each tier preference.

import { type TierBreakdownView } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  breakdown: TierBreakdownView;
};

export function TierBreakdownCard({ breakdown }: Props) {
  const total = breakdown.totalOffers;
  return (
    <Card className="p-5">
      <div className="mb-[14px] flex items-baseline justify-between">
        <Eyebrow>Tier preference breakdown</Eyebrow>
        <span
          className="font-sans text-xs"
          style={{ color: "var(--fg-muted)" }}
        >
          {breakdown.totalOffers}{" "}
          {breakdown.totalOffers === 1 ? "offer" : "offers"} ·{" "}
          {breakdown.totalTickets}{" "}
          {breakdown.totalTickets === 1 ? "ticket" : "tickets"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {breakdown.buckets.map((b) => {
          const offerWord = b.offers === 1 ? "offer" : "offers";
          const ticketWord = b.tickets === 1 ? "ticket" : "tickets";
          const share = total > 0 ? Math.round((b.offers / total) * 100) : 0;
          return (
            <div
              key={b.key}
              className="flex flex-col gap-1.5 rounded-lg p-[14px]"
              style={{ background: "var(--paper)" }}
            >
              <div
                className="font-sans text-[13px] font-semibold"
                style={{ color: "var(--fg)" }}
              >
                {b.label}
              </div>
              <div
                className="font-sans text-[11px]"
                style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}
              >
                {b.hint}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className="font-mono text-[20px] tabular-nums"
                  style={{ color: "var(--fg)" }}
                >
                  {b.tickets}
                </span>
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {ticketWord}
                </span>
              </div>
              <div
                className="font-mono text-[11px]"
                style={{ color: "var(--fg-muted)" }}
              >
                {b.offers} {offerWord} · {share}% of pool
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
