// Add hold dialog + button. Opens from the Holds card header on
// ShowAdmin. Lets the artist (or admin) pick a row, toggle seats,
// type a source label + optional notes, and POST /api/holds. Per
// the schema comment, this endpoint only creates artist-kind holds
// — venue-kind (ADA / sound desk) stays admin-via-SQL until the
// VENUE_STAFF role lands.
//
// Seat picker is a wrap of toggle chips, not a grid — venue rows in
// practice are 10-30 seats and chips degrade gracefully on narrow
// rows + read nicely with the seat label inline. The server
// re-validates row + seat membership; this dialog is the
// convenience layer.

"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";

// What the page passes in for the row picker. Pre-projected so the
// client doesn't see the full architecture jsonb.
export type AddHoldRow = {
  id: string;
  rowName: string;
  area: string;
  section: string;
  seatNumbers: readonly string[];
};

type Props = {
  showId: string;
  rows: readonly AddHoldRow[];
};

export function AddHoldButton({ showId, rows }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rowId, setRowId] = useState<string>(rows[0]?.id ?? "");
  const [selectedSeats, setSelectedSeats] = useState<readonly string[]>([]);
  const [source, setSource] = useState("Artist comp");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRow = useMemo(
    () => rows.find((r) => r.id === rowId) ?? rows[0],
    [rows, rowId],
  );

  function close() {
    if (submitting) return;
    setOpen(false);
    setError(null);
    setSelectedSeats([]);
    setSource("Artist comp");
    setNotes("");
    setRowId(rows[0]?.id ?? "");
  }

  function toggleSeat(seat: string) {
    setSelectedSeats((prev) =>
      prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat],
    );
  }

  function changeRow(nextId: string) {
    setRowId(nextId);
    // Clearing the seat selection on row change avoids the bug where
    // a seat number happens to exist in two rows and the user thinks
    // they're holding "F · 5" but the server reads "B · 5".
    setSelectedSeats([]);
  }

  async function send() {
    if (selectedSeats.length === 0) {
      setError("Pick at least one seat.");
      return;
    }
    if (source.trim().length === 0) {
      setError("Source label can't be blank.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        showId,
        source: source.trim(),
        venueRowId: rowId,
        seatNumbers: selectedSeats,
      };
      if (notes.trim().length > 0) body.notes = notes.trim();
      const res = await fetch("/api/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setError(
          (data && typeof data === "object" && "error" in data
            ? String(data.error)
            : null) ?? `Failed (HTTP ${res.status})`,
        );
        return;
      }
      router.refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (rows.length === 0) {
    // The page only renders this button when active rows exist; the
    // empty-state guard exists for defense.
    return null;
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Add hold"
      >
        <Plus size={12} strokeWidth={2} aria-hidden />
        Add hold
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(14,15,12,0.4)" }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-hold-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-7"
            style={{
              width: 560,
              maxHeight: "calc(100vh - 48px)",
              overflowY: "auto",
              background: "var(--page)",
              boxShadow:
                "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
            }}
          >
            <p
              className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              Hold
            </p>
            <h3
              id="add-hold-title"
              className="mb-2 text-[22px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              Hold seats for a comp.
            </h3>
            <p
              className="mb-5 font-sans text-[13px]"
              style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
            >
              Held seats stay out of the allocation pool. The GAE picks up
              the change on the next preview run.
            </p>

            <div className="mb-4 flex flex-col gap-1.5">
              <label
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--fg-muted)" }}
              >
                Row
              </label>
              <select
                value={rowId}
                onChange={(e) => changeRow(e.target.value)}
                className="rounded-lg p-2 font-sans text-sm"
                style={{
                  background: "var(--page)",
                  color: "var(--fg)",
                  border: "1px solid var(--border-strong)",
                  outline: "none",
                }}
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.area} · {r.section} · Row {r.rowName} ({r.seatNumbers.length} seats)
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4 flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span
                  className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Seats {activeRow ? `· Row ${activeRow.rowName}` : ""}
                </span>
                <span
                  className="font-mono text-[11px] tabular-nums"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {selectedSeats.length} selected
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(activeRow?.seatNumbers ?? []).map((seat) => {
                  const picked = selectedSeats.includes(seat);
                  return (
                    <button
                      key={seat}
                      type="button"
                      onClick={() => toggleSeat(seat)}
                      className="rounded-md px-2 py-1 font-mono text-[12px] tabular-nums"
                      style={{
                        minWidth: 32,
                        background: picked ? "var(--brand)" : "var(--paper)",
                        color: picked ? "var(--brand-fg)" : "var(--ink-700)",
                        border: picked
                          ? "1px solid var(--brand)"
                          : "1px solid var(--border)",
                      }}
                    >
                      {seat}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-1.5">
              <label
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--fg-muted)" }}
              >
                Source
              </label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                maxLength={80}
                className="rounded-lg p-2 font-sans text-sm"
                style={{
                  background: "var(--page)",
                  color: "var(--fg)",
                  border: "1px solid var(--border-strong)",
                  outline: "none",
                }}
              />
              <span
                className="font-sans text-[11px]"
                style={{ color: "var(--fg-muted)" }}
              >
                Shows as the chip text on the row. Defaults to &ldquo;Artist
                comp.&rdquo;
              </span>
            </div>

            <div className="mb-5 flex flex-col gap-1.5">
              <label
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--fg-muted)" }}
              >
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Who or what is this for?"
                rows={2}
                maxLength={500}
                className="rounded-lg p-2 font-sans text-sm"
                style={{
                  background: "var(--page)",
                  color: "var(--fg)",
                  border: "1px solid var(--border-strong)",
                  outline: "none",
                  resize: "vertical",
                  minHeight: 60,
                }}
              />
            </div>

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

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="brand" onClick={send} disabled={submitting}>
                {submitting ? "Holding…" : "Hold seats"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
