// Binding-allocation button + confirm dialog on the ShowAdmin page.
// The dangerous sibling of PreviewAllocationButton: where preview is
// re-runnable and money-free, binding is one-shot and irreversible — it
// captures every placed offer's card authorization (the fan is charged),
// releases the auths on unplaced offers, and closes the show.
//
// Because a misclick here moves real money, the dialog guards the action
// two ways: a prominent "this is irreversible" warning listing the exact
// consequences, and a type-to-confirm field — the capture button stays
// disabled until the operator types BIND. The API is the authoritative
// check (admin-gated per ADR-0013, refuses with 503 when Stripe isn't
// configured, 409 when the show isn't in an allocatable status); this
// component only decides whether to render the button and how hard to
// make it to fire by accident.

"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

type BindingStats = {
  totalOffers: number;
  placedOffers: number;
  placedSeats: number;
  unplacedOffers: number;
  orphanSeats: number;
  unfilledSeats: number;
  fillRate: number;
};

// Mirrors the BindingSuccess body from POST /api/shows/[showId]/allocate.
type SuccessBody = {
  showId: string;
  mode: "binding";
  ranAt: string;
  stats: BindingStats;
  assignmentsWritten: number;
  logsWritten: number;
  // Placed offers whose auth was captured (fan charged).
  captured: number;
  // Placed offers whose capture failed (e.g. auth lapsed) — need follow-up.
  cardFailures: number;
  // Unplaced offers whose auth was released.
  cancelled: number;
};

// The operator must type this exactly (case-insensitive) to arm the
// capture button.
const CONFIRM_WORD = "BIND";

type Props = {
  showId: string;
};

export function BindingAllocationButton({ showId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuccessBody | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  function close() {
    if (running) return;
    setOpen(false);
    // Reset everything so the next open starts from a clean, un-armed state.
    setError(null);
    setResult(null);
    setConfirmText("");
  }

  async function run() {
    // Belt-and-braces: the button is disabled until confirmed, but guard
    // here too so a stray programmatic call can't fire an unconfirmed bind.
    if (!confirmed || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/shows/${showId}/allocate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "binding" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null) ?? `Binding failed (HTTP ${res.status})`,
        );
        return;
      }
      setResult(body as SuccessBody);
      // Refresh server data so placements, statuses, and the activity feed
      // pick up the binding run.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label="Run binding allocation"
        style={{ color: "var(--brick-700)", borderColor: "var(--brick-500)" }}
      >
        <AlertTriangle size={14} strokeWidth={2} aria-hidden />
        Run binding
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(14,15,12,0.4)" }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="binding-allocation-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-7"
            style={{
              width: "min(520px, calc(100vw - 32px))",
              background: "var(--page)",
              boxShadow:
                "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
            }}
          >
            <p
              className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--brick-500)" }}
            >
              Binding allocation
            </p>
            <h3
              id="binding-allocation-title"
              className="mb-3 text-[22px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              {result
                ? "Binding complete."
                : "Capture cards and seat the room?"}
            </h3>

            {!result && !error && (
              <>
                <div
                  className="mb-4 rounded-lg p-4 font-sans text-[13px]"
                  style={{
                    background: "var(--brick-100)",
                    color: "var(--brick-700)",
                    lineHeight: 1.5,
                  }}
                >
                  <p className="mb-2">
                    <strong>This is irreversible.</strong> Running binding
                    allocation will:
                  </p>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                    <li>
                      Capture every placed offer&apos;s card authorization —
                      fans are charged.
                    </li>
                    <li>Release the holds on offers that aren&apos;t placed.</li>
                    <li>Close the show to new offers and revisions.</li>
                    <li>It cannot be undone or run again.</li>
                  </ul>
                  <p className="mt-2">
                    You are capturing funds now. In Stripe <strong>test
                    mode</strong> this uses test cards; in <strong>live
                    mode</strong> it charges real money.
                  </p>
                </div>

                <label
                  className="mb-1.5 block font-sans text-[13px] font-medium"
                  style={{ color: "var(--fg)" }}
                  htmlFor="binding-confirm-input"
                >
                  Type <span className="font-mono">{CONFIRM_WORD}</span> to
                  confirm
                </label>
                <input
                  id="binding-confirm-input"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={CONFIRM_WORD}
                  className="mb-5 w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
                  style={{
                    borderColor: confirmed
                      ? "var(--brick-500)"
                      : "var(--border-strong)",
                    background: "var(--paper)",
                  }}
                />
              </>
            )}

            {result && (
              <div className="mb-5 flex flex-col gap-2">
                <p
                  className="font-sans text-sm"
                  style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
                >
                  The room is seated and cards have been captured — the page
                  will refresh with the final numbers.
                </p>
                <div
                  className="rounded-lg p-3 font-mono text-[11px]"
                  style={{
                    background: "var(--paper)",
                    color: "var(--ink-700)",
                    lineHeight: 1.65,
                  }}
                >
                  <div>
                    captured={result.captured} (fans charged) ·
                    card_failures={result.cardFailures}
                  </div>
                  <div>cancelled={result.cancelled} (auths released)</div>
                  <div>
                    placed_offers={result.stats.placedOffers} /{" "}
                    {result.stats.totalOffers}
                  </div>
                  <div>placed_seats={result.stats.placedSeats}</div>
                  <div>unplaced_offers={result.stats.unplacedOffers}</div>
                  <div>
                    fill_rate={(result.stats.fillRate * 100).toFixed(1)}%
                  </div>
                  <div>
                    assignments_written={result.assignmentsWritten} ·
                    logs={result.logsWritten}
                  </div>
                </div>
                {result.cardFailures > 0 && (
                  <p
                    className="rounded-lg p-3 font-sans text-[13px]"
                    style={{
                      background: "var(--brick-100)",
                      color: "var(--brick-700)",
                      lineHeight: 1.5,
                    }}
                  >
                    {result.cardFailures} placed{" "}
                    {result.cardFailures === 1 ? "offer" : "offers"} failed to
                    capture (auth may have lapsed). These seats need follow-up.
                  </p>
                )}
              </div>
            )}

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
              <Button variant="ghost" onClick={close} disabled={running}>
                {result ? "Close" : "Cancel"}
              </Button>
              {!result && (
                <Button
                  variant="primary"
                  onClick={run}
                  disabled={running || !confirmed}
                  style={{ background: "var(--brick-500)", color: "#fff" }}
                  aria-label="Capture cards and seat the room"
                >
                  <AlertTriangle size={14} strokeWidth={2} aria-hidden />
                  {running ? "Capturing…" : "Capture & seat"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
