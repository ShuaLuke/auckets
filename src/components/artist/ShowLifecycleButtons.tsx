// Direct ops lifecycle controls on the ShowAdmin header: Pause / Resume /
// Close. Admin-only (the page gates rendering; POST /api/shows/[id]/transition
// re-checks server-side, the authoritative gate). Which buttons appear depends
// on the show's current status — there's exactly one legal transition per
// running state:
//
//   open    → [Pause]  [End early]
//   paused  → [Resume] [End early]
//   else    → (nothing — draft has its own Announce button; closed/allocated/
//              complete are past the point a lifecycle control means anything)
//
// Each action confirms once before firing (mirrors AnnounceShowButton's
// lighter-touch dialog — none of these moves money, so no type-to-confirm).
// "End early" is the close transition: it shuts the offer window but does NOT
// capture cards (ADR-0013) — binding stays a separate, explicit step. It wears
// the same brick (destructive) styling as the Run-binding button.

"use client";

import { Pause, Play, SquareX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import { type ShowStatus } from "@/lib/presenters";

import { Button, type ButtonVariant } from "@/components/ui/Button";

type Action = "pause" | "resume" | "close";

// Brick (destructive) styling, reused from BindingAllocationButton — applied to
// the End-early trigger and its confirm button so closing the window reads as
// the consequential action it is.
const DANGER_STYLE: CSSProperties = {
  color: "var(--brick-700)",
  borderColor: "var(--brick-500)",
};

// Per-action presentation + dialog copy. Keeps the markup below a single
// parameterized block instead of three near-identical components.
const ACTIONS: Record<
  Action,
  {
    // Trigger-button label + variant.
    label: string;
    variant: ButtonVariant;
    icon: typeof Pause;
    // Optional inline style for destructive actions (End early).
    dangerStyle?: CSSProperties;
    // Confirm-dialog copy.
    eyebrow: string;
    title: string;
    body: string;
    confirmLabel: string;
    pendingLabel: string;
  }
> = {
  pause: {
    label: "Pause",
    variant: "secondary",
    icon: Pause,
    eyebrow: "Pause show",
    title: "Pause this show?",
    body: "Pausing halts the offer window — fans can't submit or revise offers, and scheduled binding is held until you resume. Nothing is charged. You can resume any time.",
    confirmLabel: "Pause show",
    pendingLabel: "Pausing…",
  },
  resume: {
    label: "Resume",
    variant: "primary",
    icon: Play,
    eyebrow: "Resume show",
    title: "Resume this show?",
    body: "Resuming reopens the offer window — fans can submit and revise offers again, and scheduled binding picks the show back up.",
    confirmLabel: "Resume show",
    pendingLabel: "Resuming…",
  },
  close: {
    label: "End early",
    variant: "secondary",
    icon: SquareX,
    dangerStyle: DANGER_STYLE,
    eyebrow: "End offer window",
    title: "End this show's offer window early?",
    body: "This closes the offer window now — no new or revised offers. It does NOT charge anyone: binding stays a separate, explicit step you run when you're ready to seat the room. This can't be undone from here.",
    confirmLabel: "End offer window",
    pendingLabel: "Ending…",
  },
};

// The legal transitions out of each status — drives which buttons render.
// Exported for unit testing; mirrors the from-status guards on the server
// transitions (pauseShow: open→paused, resumeShow: paused→open, closeShow:
// open|paused→closed).
export function actionsFor(status: ShowStatus): Action[] {
  if (status === "open") return ["pause", "close"];
  if (status === "paused") return ["resume", "close"];
  return [];
}

type Props = {
  showId: string;
  status: ShowStatus;
};

export function ShowLifecycleButtons({ showId, status }: Props) {
  const router = useRouter();
  // Which action's confirm dialog is open (null = none). Only one at a time.
  const [pending, setPending] = useState<Action | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status);
  if (actions.length === 0) return null;

  function openDialog(action: Action) {
    setPending(action);
    setError(null);
  }

  function closeDialog() {
    if (running) return;
    setPending(null);
    setError(null);
  }

  async function run(action: Action) {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (respBody && typeof respBody === "object" && "error" in respBody
            ? String((respBody as { error: unknown }).error)
            : null) ?? `Request failed (HTTP ${res.status})`,
        );
        return;
      }
      // Success: refresh so the badge, status banner, and the now-changed set
      // of lifecycle buttons reflect the new state.
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {actions.map((action) => {
        const cfg = ACTIONS[action];
        const Icon = cfg.icon;
        return (
          <Button
            key={action}
            variant={cfg.variant}
            onClick={() => openDialog(action)}
            aria-label={`${cfg.label} show`}
            {...(cfg.dangerStyle ? { style: cfg.dangerStyle } : {})}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden />
            {cfg.label}
          </Button>
        );
      })}

      {pending && (
        <ConfirmDialog
          cfg={ACTIONS[pending]}
          running={running}
          error={error}
          onCancel={closeDialog}
          onConfirm={() => run(pending)}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  cfg,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  cfg: (typeof ACTIONS)[Action];
  running: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const Icon = cfg.icon;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(14,15,12,0.4)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="show-lifecycle-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl p-7"
        style={{
          width: "min(480px, calc(100vw - 32px))",
          background: "var(--page)",
          boxShadow: "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
        }}
      >
        <p
          className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--fg-muted)" }}
        >
          {cfg.eyebrow}
        </p>
        <h3
          id="show-lifecycle-title"
          className="mb-3 text-[22px]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {cfg.title}
        </h3>

        <p
          className="mb-5 font-sans text-[13px]"
          style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
        >
          {cfg.body}
        </p>

        {error && (
          <div
            className="mb-5 rounded-lg p-3 font-sans text-[13px]"
            style={{
              background: "var(--brick-100)",
              color: "var(--brick-700)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button
            variant={cfg.variant}
            onClick={onConfirm}
            disabled={running}
            aria-label={`Confirm ${cfg.confirmLabel}`}
            {...(cfg.dangerStyle ? { style: cfg.dangerStyle } : {})}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden />
            {running ? cfg.pendingLabel : cfg.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
