// ShowCreate — the artist/admin form for creating a show. Posts to
// POST /api/shows, which creates the show in 'draft'. Full row/tier
// control: the operator picks a venue + architecture, toggles exactly which
// rows are active for this show (NEW-4 partial-venue activation), and sets a
// floor price for every tier present among the active rows.
//
// Mirrors the OfferComposer conventions (client component, local state,
// fetch-then-router-navigate, inline error box). Server-side POST /api/shows
// re-validates everything; the client checks are just for a responsive form.

"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { Stepper } from "@/components/ui/Stepper";
import { TextInput } from "@/components/ui/TextInput";
import { parseDollars } from "@/lib/money";

export type ShowCreateVenue = {
  id: string;
  name: string;
  city: string | null;
};

export type ShowCreateRow = {
  id: string;
  area: string;
  section: string;
  rowName: string;
  tier: string | null;
  capacity: number;
};

export type ShowCreateArchitecture = {
  id: string;
  venueId: string;
  version: number;
  rows: ShowCreateRow[];
};

type Props = {
  artistId: string;
  venues: ShowCreateVenue[];
  architectures: ShowCreateArchitecture[];
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-strong)",
  background: "var(--page)",
  fontSize: 14,
  fontFamily: "var(--font-sans)",
  color: "var(--ink-900)",
};

export function ShowCreateForm({ artistId, venues, architectures }: Props) {
  const router = useRouter();

  const [venueId, setVenueId] = useState("");
  const [architectureId, setArchitectureId] = useState("");
  // Row ids active for this show. Seeded to "all rows" when an architecture
  // is selected; the operator toggles from there.
  const [activeRowIds, setActiveRowIds] = useState<Set<string>>(new Set());
  // Per-tier floor, as the raw dollar string the operator typed.
  const [floorsByTier, setFloorsByTier] = useState<Record<string, string>>({});
  const [offerWindowOpensAt, setOfferWindowOpensAt] = useState("");
  const [bindingAllocationAt, setBindingAllocationAt] = useState("");
  const [doorsAt, setDoorsAt] = useState("");
  const [maxGroupSize, setMaxGroupSize] = useState(10);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const architecturesForVenue = useMemo(
    () => architectures.filter((a) => a.venueId === venueId),
    [architectures, venueId],
  );
  const selectedArch = useMemo(
    () => architectures.find((a) => a.id === architectureId) ?? null,
    [architectures, architectureId],
  );

  // Tiers present among the currently-active rows — these are exactly the
  // tiers that need a floor (matches the server's required-tier check).
  const activeTiers = useMemo(() => {
    if (!selectedArch) return [] as string[];
    const tiers = new Set<string>();
    for (const row of selectedArch.rows) {
      if (activeRowIds.has(row.id) && row.tier) tiers.add(row.tier);
    }
    return [...tiers].sort();
  }, [selectedArch, activeRowIds]);

  function handleVenueChange(nextVenueId: string) {
    setVenueId(nextVenueId);
    // Auto-select when the venue has exactly one architecture; otherwise
    // clear so the operator picks. Either way reset rows/floors.
    const archs = architectures.filter((a) => a.venueId === nextVenueId);
    if (archs.length === 1) {
      selectArchitecture(archs[0]!);
    } else {
      setArchitectureId("");
      setActiveRowIds(new Set());
      setFloorsByTier({});
    }
  }

  function selectArchitecture(arch: ShowCreateArchitecture) {
    setArchitectureId(arch.id);
    // Default to all rows active; the operator toggles off what this show
    // doesn't use.
    setActiveRowIds(new Set(arch.rows.map((r) => r.id)));
    setFloorsByTier({});
  }

  function handleArchitectureChange(nextId: string) {
    const arch = architectures.find((a) => a.id === nextId);
    if (arch) selectArchitecture(arch);
  }

  function toggleRow(rowId: string) {
    setActiveRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  // Validate the floor for one tier → cents, or null if unset/invalid.
  function floorCents(tier: string): number | null {
    const raw = floorsByTier[tier];
    if (raw === undefined || raw.trim() === "") return null;
    const cents = parseDollars(raw);
    if (cents === null || cents <= 0) return null;
    return cents;
  }

  const allFloorsValid =
    activeTiers.length > 0 &&
    activeTiers.every((tier) => floorCents(tier) !== null);

  const datesPresent =
    offerWindowOpensAt !== "" &&
    bindingAllocationAt !== "" &&
    doorsAt !== "";

  const canSubmit =
    venueId !== "" &&
    architectureId !== "" &&
    activeRowIds.size > 0 &&
    allFloorsValid &&
    datesPresent &&
    !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !selectedArch) return;

    setSubmitting(true);
    setError(null);

    const tierFloorsCents: Record<string, number> = {};
    for (const tier of activeTiers) {
      const cents = floorCents(tier);
      if (cents === null) {
        setError(`Enter a valid floor price for the "${tier}" tier.`);
        setSubmitting(false);
        return;
      }
      tierFloorsCents[tier] = cents;
    }

    const payload = {
      artistId,
      venueId,
      venueArchitectureId: architectureId,
      offerWindowOpensAt: new Date(offerWindowOpensAt).toISOString(),
      bindingAllocationAt: new Date(bindingAllocationAt).toISOString(),
      doorsAt: new Date(doorsAt).toISOString(),
      tierFloorsCents,
      activeRowIds: [...activeRowIds],
      maxGroupSize,
    };

    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body: { showId?: string } = await res.json().catch(() => ({}));
        // Land on the new show's ShowAdmin so the operator can review and
        // announce it. router.refresh() isn't enough — we're navigating away.
        if (body.showId) {
          router.push(`/artists/${artistId}/shows/${body.showId}`);
        } else {
          router.push(`/artists/${artistId}`);
        }
        return;
      }
      const body: { error?: string } = await res.json().catch(() => ({}));
      setError(body.error ?? `Create failed (HTTP ${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ padding: 24 }}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <Eyebrow className="mb-3.5">New show</Eyebrow>
          <p
            className="font-sans text-[13px]"
            style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}
          >
            Created as a draft. Announce it to open the offer window.
          </p>
        </div>

        <Field label="Venue" htmlFor="venue">
          <select
            id="venue"
            value={venueId}
            onChange={(e) => handleVenueChange(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select a venue…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.city ? ` · ${v.city}` : ""}
              </option>
            ))}
          </select>
        </Field>

        {venueId !== "" && (
          <Field
            label="Seat map (architecture)"
            hint="Immutable snapshot the allocation runs against."
            htmlFor="architecture"
          >
            {architecturesForVenue.length === 0 ? (
              <p
                className="font-sans text-[13px]"
                style={{ color: "var(--brick-700)" }}
              >
                This venue has no published seat map yet.
              </p>
            ) : (
              <select
                id="architecture"
                value={architectureId}
                onChange={(e) => handleArchitectureChange(e.target.value)}
                style={selectStyle}
              >
                <option value="">Select a seat map…</option>
                {architecturesForVenue.map((a) => (
                  <option key={a.id} value={a.id}>
                    Version {a.version} ({a.rows.length} rows)
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {selectedArch && (
          <>
            <Field
              label="Active rows"
              hint={`${activeRowIds.size} of ${selectedArch.rows.length} rows active for this show.`}
            >
              <div
                className="flex flex-col gap-1.5 overflow-y-auto rounded-lg p-3"
                style={{
                  maxHeight: 280,
                  background: "var(--paper-2)",
                  border: "1px solid var(--border)",
                }}
              >
                {selectedArch.rows.map((row) => {
                  const checked = activeRowIds.has(row.id);
                  return (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-2.5 font-sans text-[13px]"
                      style={{ color: "var(--ink-900)" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(row.id)}
                        style={{ accentColor: "var(--brand)" }}
                      />
                      <span className="flex-1">
                        {row.section} · {row.rowName}
                        <span style={{ color: "var(--fg-faint)" }}>
                          {" "}
                          ({row.capacity} seats)
                        </span>
                      </span>
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        {row.tier ?? "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Tier floor prices"
              hint="The lowest price per ticket allowed in each active tier."
            >
              {activeTiers.length === 0 ? (
                <p
                  className="font-sans text-[13px]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  No tiered rows active. Activate at least one tiered row.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeTiers.map((tier) => (
                    <div key={tier} className="flex items-center gap-3">
                      <span
                        className="font-mono text-[12px]"
                        style={{ minWidth: 90, color: "var(--ink-700)" }}
                      >
                        {tier}
                      </span>
                      <TextInput
                        prefix="$"
                        mono
                        inputMode="decimal"
                        placeholder="0.00"
                        value={floorsByTier[tier] ?? ""}
                        onChange={(e) =>
                          setFloorsByTier((prev) => ({
                            ...prev,
                            [tier]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </>
        )}

        <Field
          label="Offer window opens"
          hint="When fans can start submitting offers."
          htmlFor="offerWindowOpensAt"
        >
          <TextInput
            id="offerWindowOpensAt"
            type="datetime-local"
            value={offerWindowOpensAt}
            onChange={(e) => setOfferWindowOpensAt(e.target.value)}
          />
        </Field>

        <Field
          label="Binding checkpoint"
          hint="Allocation runs and cards are captured. Must be ≤6 days after the window opens, and at/before doors."
          htmlFor="bindingAllocationAt"
        >
          <TextInput
            id="bindingAllocationAt"
            type="datetime-local"
            value={bindingAllocationAt}
            onChange={(e) => setBindingAllocationAt(e.target.value)}
          />
        </Field>

        <Field label="Doors" htmlFor="doorsAt">
          <TextInput
            id="doorsAt"
            type="datetime-local"
            value={doorsAt}
            onChange={(e) => setDoorsAt(e.target.value)}
          />
        </Field>

        <Field label="Max group size" htmlFor="maxGroupSize">
          <Stepper
            value={maxGroupSize}
            onChange={setMaxGroupSize}
            min={1}
            max={10}
          />
        </Field>

        {error && (
          <div
            className="rounded-lg px-3.5 py-3 font-sans text-[13px]"
            style={{ background: "var(--brick-100)", color: "var(--brick-700)" }}
          >
            {error}
          </div>
        )}

        <Button type="submit" variant="brand" size="lg" disabled={!canSubmit}>
          {submitting ? "Creating…" : "Create draft show"}
        </Button>
      </form>
    </Card>
  );
}
