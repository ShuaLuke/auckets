// Fan-facing displacement alerts on the Show detail right column — the real
// counterpart to the prototype's DisplacementToast (design Show.jsx, line
// 312). Renders the unacknowledged displacement_events for this fan + show
// (ADR-0018 §4) as a dismissible stack. Dismiss POSTs to the acknowledge
// endpoint and removes the toast optimistically.
//
// Note: the prototype's "Raise $5" button pre-filled the composer's price.
// Cross-component price hand-off is deferred — the composer sits right
// below, and the warning copy directs the fan to it. The interactive piece
// here is acknowledge/dismiss.

"use client";

import { ShieldCheck, TrendingDown, TrendingUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DisplacementAlertTone, DisplacementAlertView } from "@/lib/presenters";

type Props = {
  alerts: DisplacementAlertView[];
};

// Per-tone palette. Warning matches the prototype's amber toast exactly;
// info/positive are cohesive neutral/green variants.
const TONE_STYLES: Record<
  DisplacementAlertTone,
  { bg: string; border: string; accent: string; Icon: typeof TrendingDown }
> = {
  warning: { bg: "#F6E6CC", border: "#C99A4B", accent: "#8F6A2A", Icon: TrendingDown },
  info: { bg: "var(--card-warm, #F4F1E8)", border: "var(--border)", accent: "var(--fg-muted)", Icon: ShieldCheck },
  positive: { bg: "#E3EEDD", border: "#7FA06A", accent: "#4B6B38", Icon: TrendingUp },
};

// How long the height-collapse fold runs before the alert leaves the DOM.
// Matches --dur-base (180ms) plus a small buffer so the transition always
// finishes first. Reduced-motion users skip the fold (transition: none in
// design-system.css) and just see the alert leave after the same beat.
const COLLAPSE_MS = 200;

export function DisplacementAlerts({ alerts }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Alerts mid-fold: still rendered, collapsing via .auk-collapsible.
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [errorId, setErrorId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  // Two-phase dismiss: fold the alert shut (CSS height collapse + fade),
  // then remove it and fire the acknowledge POST. On failure both sets are
  // restored, so the alert unfolds back open and the fan can retry.
  function beginDismiss(id: string) {
    setPendingId(id);
    setErrorId(null);
    setClosing((prev) => new Set(prev).add(id));
    window.setTimeout(() => void dismiss(id), COLLAPSE_MS);
  }

  function restore(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setClosing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setErrorId(id);
  }

  async function dismiss(id: string) {
    // Optimistic remove — restore on failure so the fan can retry.
    setDismissed((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/displacement-events/${id}/acknowledge`, {
        method: "POST",
      });
      if (!res.ok) {
        restore(id);
        return;
      }
      setClosing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    } catch {
      restore(id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {visible.map((alert) => {
        const tone = TONE_STYLES[alert.tone];
        const Icon = tone.Icon;
        return (
          // .auk-collapsible: dismissing folds the alert's height shut
          // instead of snapping it out of the layout. .auk-reveal: a calm
          // slide-in on mount. Both are reduced-motion safe via the
          // design-system media queries.
          <div
            key={alert.id}
            className="auk-collapsible"
            data-closed={closing.has(alert.id) ? "true" : "false"}
          >
            <div className="auk-reveal">
              <div
                role="status"
                className="flex items-start gap-3 rounded-lg p-[14px]"
                style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
              >
            <Icon
              size={20}
              strokeWidth={1.75}
              style={{ color: tone.accent, flexShrink: 0, marginTop: 1 }}
              aria-hidden
            />
            <div className="flex-1">
              <div
                className="font-sans"
                style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-900, #0E0F0C)" }}
              >
                {alert.headline}
              </div>
              <div
                className="font-sans"
                style={{ fontSize: 12, color: tone.accent, marginTop: 2 }}
              >
                {alert.body}
              </div>
              {errorId === alert.id && (
                <div
                  className="font-sans"
                  style={{ fontSize: 11, color: "#722417", marginTop: 4 }}
                >
                  Couldn&apos;t dismiss — try again.
                </div>
              )}
            </div>
                <button
                  type="button"
                  onClick={() => beginDismiss(alert.id)}
                  disabled={pendingId === alert.id}
                  aria-label="Dismiss alert"
                  className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent"
                  style={{ color: tone.accent, cursor: "pointer", flexShrink: 0 }}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
