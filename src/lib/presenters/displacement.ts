// Presenter: turn raw displacement_events rows (ADR-0018 §4) into fan-facing
// alert copy for the DisplacementAlerts component. Repositories return the
// raw rows (kind + jsonb detail); all wording + tone lives here so the
// component stays a dumb renderer.

import { formatCents } from "@/lib/money";

import type { DisplacementEvent } from "@/lib/db/repositories";

// Visual treatment the component maps to an icon + colour.
export type DisplacementAlertTone = "warning" | "info" | "positive";

export type DisplacementAlertView = {
  id: string;
  tone: DisplacementAlertTone;
  headline: string;
  body: string;
};

function tierLabel(tier: unknown): string {
  if (typeof tier !== "string" || tier.length === 0) return "the event";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Map one event to its view. Unknown kinds (forward-compat with a future
// event type) collapse to a neutral info line rather than throwing — the
// detector is the source of truth for which kinds exist.
function presentOne(event: DisplacementEvent): DisplacementAlertView {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  const base = { id: event.id };

  switch (event.kind) {
    case "auto_bid_raise": {
      const to = num(detail.toCents);
      const from = num(detail.fromCents);
      const tier = tierLabel(detail.tier);
      const toStr = to === null ? "a higher amount" : formatCents(to);
      const fromClause = from === null ? "" : ` (from your ${formatCents(from)} offer)`;
      return {
        ...base,
        tone: "info",
        headline: "Auto-bid kept your spot",
        body: `Your auto-bid raised you to ${toStr} to hold ${tier}${fromClause}.`,
      };
    }
    case "section_change": {
      const from = tierLabel(detail.fromTier);
      const to = tierLabel(detail.toTier);
      if (detail.direction === "better") {
        return {
          ...base,
          tone: "positive",
          headline: "You moved up",
          body: `You're now projected in ${to}, up from ${from}.`,
        };
      }
      return {
        ...base,
        tone: "warning",
        headline: "You moved sections",
        body: `A higher offer landed above yours — you're now projected in ${to}, down from ${from}.`,
      };
    }
    case "outbid_out": {
      const from = tierLabel(detail.fromTier);
      return {
        ...base,
        tone: "warning",
        headline: "You're not in the projection right now",
        body: `You've dropped out of the projection (you were in ${from}). Raise your offer below to get back in.`,
      };
    }
    default:
      return {
        ...base,
        tone: "info",
        headline: "Where you'd land changed",
        body: "Where you'd land was updated.",
      };
  }
}

// Present a list of events (already filtered to the relevant show + the
// calling user, unacknowledged, newest-first by the repo).
export function presentDisplacementEvents(
  events: readonly DisplacementEvent[],
): DisplacementAlertView[] {
  return events.map(presentOne);
}
