// ShowCreate — the artist/admin form for creating a show. Posts to
// POST /api/shows, which creates the show in 'draft'. Full row/tier
// control: the operator picks a venue + architecture, toggles exactly which
// rows are active for this show (NEW-4 partial-venue activation), and sets a
// floor price for every tier present among the active rows.
//
// Inline "create a new venue" (Julia, 2026-05-30): the venue picker carries a
// "+ Create a new venue" option that expands a panel — venue fields plus a
// simple tier generator (rows × seats × floor per tier). On submit that path
// is two requests: POST /api/venues (creates the venue + a generated seat-map
// architecture) then POST /api/shows against the returned ids, with every
// generated row active. The full per-row VenueBuilder stays post-beta.
//
// Mirrors the OfferComposer conventions (client component, local state,
// fetch-then-router-navigate, inline error box). The POST routes re-validate
// everything; the client checks are just for a responsive form.

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

// Sentinel value for the "+ Create a new venue" option in the venue select.
const NEW_VENUE = "__new__";

// One tier in the new-venue generator. Numbers are kept as numbers (Stepper
// drives them); floor is the raw dollar string the operator typed.
type TierDraft = {
  name: string;
  rowCount: number;
  seatsPerRow: number;
  isGa: boolean;
  floorDollars: string;
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

function emptyTier(): TierDraft {
  return { name: "", rowCount: 1, seatsPerRow: 10, isGa: false, floorDollars: "" };
}

// Captioned wrapper for a tier control — the bare Stepper/TextInput render no
// visible label (Stepper's `label` only feeds the buttons' aria-label), so a
// caption above each makes "1" / "10" / "$" self-explanatory.
function TierControl({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-sans text-[11px] uppercase"
        style={{ color: "var(--fg-subtle)", letterSpacing: "0.04em" }}
      >
        {caption}
      </span>
      {children}
    </div>
  );
}

// dollars → positive cents, or null if blank/invalid.
function floorToCents(raw: string): number | null {
  if (raw.trim() === "") return null;
  const cents = parseDollars(raw);
  if (cents === null || cents <= 0) return null;
  return cents;
}

export function ShowCreateForm({ artistId, venues, architectures }: Props) {
  const router = useRouter();

  // --- venue selection (existing) ---
  const [venueId, setVenueId] = useState("");
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [architectureId, setArchitectureId] = useState("");
  const [activeRowIds, setActiveRowIds] = useState<Set<string>>(new Set());
  const [floorsByTier, setFloorsByTier] = useState<Record<string, string>>({});

  // --- new venue (generator) ---
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [geoLat, setGeoLat] = useState("");
  const [geoLon, setGeoLon] = useState("");
  const [geoRadiusM, setGeoRadiusM] = useState("500");
  const [tiers, setTiers] = useState<TierDraft[]>([emptyTier()]);

  // --- shared ---
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

  // Tiers present among the currently-active rows (existing-venue mode) —
  // exactly the tiers that need a floor (matches the server's check).
  const activeTiers = useMemo(() => {
    if (!selectedArch) return [] as string[];
    const set = new Set<string>();
    for (const row of selectedArch.rows) {
      if (activeRowIds.has(row.id) && row.tier) set.add(row.tier);
    }
    return [...set].sort();
  }, [selectedArch, activeRowIds]);

  function handleVenueSelect(value: string) {
    if (value === NEW_VENUE) {
      setCreatingVenue(true);
      setVenueId("");
      setArchitectureId("");
      setActiveRowIds(new Set());
      setFloorsByTier({});
      return;
    }
    setCreatingVenue(false);
    setVenueId(value);
    const archs = architectures.filter((a) => a.venueId === value);
    if (archs.length === 1) selectArchitecture(archs[0]!);
    else {
      setArchitectureId("");
      setActiveRowIds(new Set());
      setFloorsByTier({});
    }
  }

  function selectArchitecture(arch: ShowCreateArchitecture) {
    setArchitectureId(arch.id);
    setActiveRowIds(new Set(arch.rows.map((r) => r.id)));
    setFloorsByTier({});
  }

  function toggleRow(rowId: string) {
    setActiveRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function updateTier(index: number, patch: Partial<TierDraft>) {
    setTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  // --- validation ---
  const datesPresent =
    offerWindowOpensAt !== "" && bindingAllocationAt !== "" && doorsAt !== "";

  const existingVenueValid =
    !creatingVenue &&
    venueId !== "" &&
    architectureId !== "" &&
    activeRowIds.size > 0 &&
    activeTiers.length > 0 &&
    activeTiers.every((tier) => floorToCents(floorsByTier[tier] ?? "") !== null);

  const tierNames = tiers.map((t) => t.name.trim());
  const newVenueValid =
    creatingVenue &&
    venueName.trim() !== "" &&
    tiers.length > 0 &&
    tierNames.every((n) => n !== "") &&
    new Set(tierNames).size === tierNames.length &&
    tiers.every(
      (t) =>
        t.rowCount >= 1 &&
        t.seatsPerRow >= 1 &&
        floorToCents(t.floorDollars) !== null,
    ) &&
    // geo lat+lon are all-or-nothing
    (geoLat.trim() === "") === (geoLon.trim() === "");

  const canSubmit =
    datesPresent && !submitting && (existingVenueValid || newVenueValid);

  // POST /api/shows for an already-chosen venue + architecture + tier floors.
  async function postShow(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body: { showId?: string } = await res.json().catch(() => ({}));
      router.push(
        body.showId
          ? `/artists/${artistId}/shows/${body.showId}`
          : `/artists/${artistId}`,
      );
      return true;
    }
    const body: { error?: string } = await res.json().catch(() => ({}));
    setError(body.error ?? `Create failed (HTTP ${res.status})`);
    return false;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const dates = {
      offerWindowOpensAt: new Date(offerWindowOpensAt).toISOString(),
      bindingAllocationAt: new Date(bindingAllocationAt).toISOString(),
      doorsAt: new Date(doorsAt).toISOString(),
    };

    try {
      if (creatingVenue) {
        // Step 1: create the venue + its generated architecture.
        const venuePayload: Record<string, unknown> = {
          name: venueName.trim(),
          geoRadiusM: Number(geoRadiusM) || 500,
          tiers: tiers.map((t) => ({
            name: t.name.trim(),
            rowCount: t.rowCount,
            seatsPerRow: t.seatsPerRow,
            isGa: t.isGa,
          })),
        };
        if (venueCity.trim() !== "") venuePayload.city = venueCity.trim();
        if (geoLat.trim() !== "" && geoLon.trim() !== "") {
          venuePayload.geoLat = Number(geoLat);
          venuePayload.geoLon = Number(geoLon);
        }

        const venueRes = await fetch("/api/venues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(venuePayload),
        });
        if (!venueRes.ok) {
          const body: { error?: string } = await venueRes
            .json()
            .catch(() => ({}));
          setError(body.error ?? `Venue create failed (HTTP ${venueRes.status})`);
          return;
        }
        const venue: {
          venueId: string;
          architectureId: string;
          rows: { id: string }[];
        } = await venueRes.json();

        // Step 2: create the show against the new venue. Every generated row
        // is active; floors come from the generator tiers.
        const tierFloorsCents: Record<string, number> = {};
        for (const t of tiers) {
          const cents = floorToCents(t.floorDollars);
          if (cents === null) {
            setError(`Enter a valid floor for the "${t.name}" tier.`);
            return;
          }
          tierFloorsCents[t.name.trim()] = cents;
        }
        await postShow({
          artistId,
          venueId: venue.venueId,
          venueArchitectureId: venue.architectureId,
          ...dates,
          tierFloorsCents,
          activeRowIds: venue.rows.map((r) => r.id),
          maxGroupSize,
        });
        return;
      }

      // Existing-venue path.
      const tierFloorsCents: Record<string, number> = {};
      for (const tier of activeTiers) {
        const cents = floorToCents(floorsByTier[tier] ?? "");
        if (cents === null) {
          setError(`Enter a valid floor for the "${tier}" tier.`);
          return;
        }
        tierFloorsCents[tier] = cents;
      }
      await postShow({
        artistId,
        venueId,
        venueArchitectureId: architectureId,
        ...dates,
        tierFloorsCents,
        activeRowIds: [...activeRowIds],
        maxGroupSize,
      });
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
            value={creatingVenue ? NEW_VENUE : venueId}
            onChange={(e) => handleVenueSelect(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select a venue…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.city ? ` · ${v.city}` : ""}
              </option>
            ))}
            <option value={NEW_VENUE}>+ Create a new venue…</option>
          </select>
        </Field>

        {/* ---- New-venue generator ---- */}
        {creatingVenue && (
          <div
            className="flex flex-col gap-4 rounded-lg p-4"
            style={{
              background: "var(--paper-2)",
              border: "1px solid var(--border)",
            }}
          >
            <Field label="Venue name" htmlFor="venueName">
              <TextInput
                id="venueName"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="The Fillmore"
              />
            </Field>
            <Field label="City" htmlFor="venueCity">
              <TextInput
                id="venueCity"
                value={venueCity}
                onChange={(e) => setVenueCity(e.target.value)}
                placeholder="San Francisco, CA"
              />
            </Field>
            <Field
              label="Geo gate (optional)"
              hint="Venue centre + radius for the at-the-door QR check. Latitude and longitude go together."
            >
              <div className="flex flex-wrap gap-2">
                <TextInput
                  inputMode="decimal"
                  placeholder="lat"
                  value={geoLat}
                  onChange={(e) => setGeoLat(e.target.value)}
                  wrapperStyle={{ flex: 1, minWidth: 90 }}
                />
                <TextInput
                  inputMode="decimal"
                  placeholder="lon"
                  value={geoLon}
                  onChange={(e) => setGeoLon(e.target.value)}
                  wrapperStyle={{ flex: 1, minWidth: 90 }}
                />
                <TextInput
                  inputMode="numeric"
                  suffix="m"
                  placeholder="500"
                  value={geoRadiusM}
                  onChange={(e) => setGeoRadiusM(e.target.value)}
                  wrapperStyle={{ width: 90 }}
                />
              </div>
            </Field>

            <Field
              label="Tiers"
              hint="Listed best-first. Each tier becomes a block of equal rows; floor is the lowest price allowed in that tier."
            >
              <div className="flex flex-col gap-3">
                {tiers.map((tier, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded-md p-3"
                    style={{
                      background: "var(--page)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <TextInput
                        placeholder="tier name (e.g. premium)"
                        value={tier.name}
                        onChange={(e) => updateTier(i, { name: e.target.value })}
                        wrapperStyle={{ flex: 1 }}
                      />
                      {tiers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setTiers((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <TierControl caption="Rows">
                        <Stepper
                          label="rows"
                          value={tier.rowCount}
                          onChange={(v) => updateTier(i, { rowCount: v })}
                          min={1}
                          max={100}
                        />
                      </TierControl>
                      <TierControl caption="Seats per row">
                        <Stepper
                          label="seats per row"
                          value={tier.seatsPerRow}
                          onChange={(v) => updateTier(i, { seatsPerRow: v })}
                          min={1}
                          max={500}
                        />
                      </TierControl>
                      <TierControl caption="Floor / ticket">
                        <div style={{ width: 110 }}>
                          <TextInput
                            prefix="$"
                            mono
                            inputMode="decimal"
                            placeholder="0.00"
                            value={tier.floorDollars}
                            onChange={(e) =>
                              updateTier(i, { floorDollars: e.target.value })
                            }
                          />
                        </div>
                      </TierControl>
                    </div>
                    <label
                      className="flex cursor-pointer items-center gap-2 font-sans text-[12px]"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      <input
                        type="checkbox"
                        checked={tier.isGa}
                        onChange={(e) => updateTier(i, { isGa: e.target.checked })}
                        style={{ accentColor: "var(--brand)" }}
                      />
                      General admission (no assigned seats)
                    </label>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setTiers((prev) => [...prev, emptyTier()])}
                >
                  + Add tier
                </Button>
              </div>
            </Field>
          </div>
        )}

        {/* ---- Existing-venue: architecture + rows + floors ---- */}
        {!creatingVenue && venueId !== "" && (
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
                onChange={(e) => {
                  const arch = architectures.find((a) => a.id === e.target.value);
                  if (arch) selectArchitecture(arch);
                }}
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

        {!creatingVenue && selectedArch && (
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
                {selectedArch.rows.map((row) => (
                  <label
                    key={row.id}
                    className="flex cursor-pointer items-center gap-2.5 font-sans text-[13px]"
                    style={{ color: "var(--ink-900)" }}
                  >
                    <input
                      type="checkbox"
                      checked={activeRowIds.has(row.id)}
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
                ))}
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

        {/* ---- Shared: schedule + group size ---- */}
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
