// Preview-allocation button + modal dialog on the ShowAdmin page.
// Maps to design/ui_kits/auckets/screens/ShowAdmin.jsx — the
// "Preview allocation" button (lines 37-39) plus the AllocationDialog
// (lines 305-337).
//
// Auth: the endpoint is admin-only per ADR-0013 (even artists don't
// trigger this directly; they file a Request action that AUCKETS ops
// executes). The page chooses whether to render this component based
// on userIsAdmin(); the API still enforces 403 server-side as the
// authoritative check.

"use client";

import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

type PreviewStats = {
  totalOffers: number;
  placedOffers: number;
  placedSeats: number;
  unplacedOffers: number;
  orphanSeats: number;
  unfilledSeats: number;
  fillRate: number;
};

type SuccessBody = {
  showId: string;
  mode: "preview";
  ranAt: string;
  stats: PreviewStats;
  assignmentsWritten: number;
  logsWritten: number;
};

type Props = {
  showId: string;
};

export function PreviewAllocationButton({ showId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuccessBody | null>(null);

  function close() {
    if (running) return;
    setOpen(false);
    // Clear stale result/error on close so the next open starts fresh.
    setError(null);
    setResult(null);
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/shows/${showId}/allocate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null) ?? `Allocation failed (HTTP ${res.status})`,
        );
        return;
      }
      setResult(body as SuccessBody);
      // Refresh server data so the BigStats card / capacity bar /
      // Recent activity all pick up the new assignment rows.
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
        variant="brand"
        onClick={() => setOpen(true)}
        aria-label="Preview allocation"
      >
        <Zap size={14} strokeWidth={2} aria-hidden />
        Preview allocation
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(14,15,12,0.4)" }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-allocation-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-7"
            style={{
              width: "min(480px, calc(100vw - 32px))",
              background: "var(--page)",
              boxShadow:
                "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
            }}
          >
            <p
              className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              Preview allocation
            </p>
            <h3
              id="preview-allocation-title"
              className="mb-3 text-[22px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              {result ? "Preview complete." : "Run a non-binding preview?"}
            </h3>

            {!result && !error && (
              <p
                className="mb-5 font-sans text-sm"
                style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
              >
                The GAE ranks every offer, walks the venue, and places groups.{" "}
                <strong style={{ color: "var(--fg)" }}>
                  Nothing is charged.
                </strong>{" "}
                You&apos;ll see provisional placement, orphans, and unplaced
                offers. Run as many previews as you like.
              </p>
            )}

            {result && (
              <div className="mb-5 flex flex-col gap-2">
                <p
                  className="font-sans text-sm"
                  style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
                >
                  Snapshot from the latest run — page will refresh with the new
                  numbers.
                </p>
                <div
                  className="rounded-lg p-3 font-mono text-[11px]"
                  style={{ background: "var(--paper)", color: "var(--ink-700)", lineHeight: 1.65 }}
                >
                  <div>
                    placed_offers={result.stats.placedOffers} / {result.stats.totalOffers}
                  </div>
                  <div>placed_seats={result.stats.placedSeats}</div>
                  <div>unplaced_offers={result.stats.unplacedOffers}</div>
                  <div>orphan_seats={result.stats.orphanSeats}</div>
                  <div>unfilled_seats={result.stats.unfilledSeats}</div>
                  <div>
                    fill_rate={(result.stats.fillRate * 100).toFixed(1)}%
                  </div>
                  <div>
                    assignments_written={result.assignmentsWritten} · logs={result.logsWritten}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div
                className="mb-5 rounded-lg p-3 font-sans text-[13px]"
                style={{
                  background: "#F2D9D3",
                  color: "#722417",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            {!result && !error && (
              <div
                className="mb-5 rounded-lg p-3 font-mono text-[11px]"
                style={{ background: "var(--paper)", color: "var(--ink-500)", lineHeight: 1.6 }}
              >
                <div>mode=<span style={{ color: "var(--brand)" }}>preview</span></div>
                <div>orphan_policy=leave</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={close}
                disabled={running}
              >
                {result ? "Close" : "Cancel"}
              </Button>
              {!result && (
                <Button
                  variant="brand"
                  onClick={run}
                  disabled={running}
                >
                  <Zap size={14} strokeWidth={2} aria-hidden />
                  {running ? "Running…" : error ? "Try again" : "Run preview"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
