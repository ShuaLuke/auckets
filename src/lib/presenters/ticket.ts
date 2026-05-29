// Presenter for the fan TicketViewer. Turns the raw ticket / seat-assignment
// / show / venue rows into the formatted, client-safe shape the
// <TicketViewer> component renders.
//
// Per the presenter convention (repos return raw shapes; formatting lives
// here): dateLong, the human row name, joined seat list, and the paid amount
// are all derived here. The venue geo (lat/lon/radius) is passed through as
// numbers for the client-side geo-gate — note the totp_secret never appears
// in this shape (the tickets repo never selects it).

import { formatCents } from "@/lib/money";
import type { TicketStatus } from "@/lib/db/repositories/tickets";

import { DEFAULT_TZ, formatDateLong } from "./format";

export type TicketViewSeat = {
  section: string; // tier label, e.g. "Premium"
  row: string; // human row name, e.g. "AA"
  seats: string; // "7 · 9 · 11 · 13"
  paid: string; // "$168.00"
};

// Venue centroid + radius for the client geo-gate. lat/lon are null when the
// venue hasn't had coordinates configured yet — the component treats that as
// "can't gate" and shows the ticket (the gate is best-effort UX, not the
// security boundary).
export type TicketVenueGeo = {
  lat: number | null;
  lon: number | null;
  radiusM: number;
};

export type TicketView = {
  ticketId: string;
  ticketStatus: TicketStatus;
  artist: string;
  venue: string;
  city: string;
  dateLong: string;
  seat: TicketViewSeat;
  geo: TicketVenueGeo;
};

export type PresentTicketInput = {
  artistName: string;
  venueName: string;
  venueCity: string | null;
  doorsAt: Date;
  // NUMERIC columns come back from Drizzle as strings; null when unset.
  geoLat: string | null;
  geoLon: string | null;
  geoRadiusM: number;
  // Venue-architecture rows, used to map the stored venueRowId to a human
  // row name. Only the two fields we need are required by the contract.
  rows: ReadonlyArray<{ id: string; rowName: string }>;
  seatAssignment: {
    venueRowId: string;
    seatNumbers: string[];
    tier: string;
    chargedAmountCents: number | null;
  };
  ticket: { id: string; status: TicketStatus };
};

// "premium" -> "Premium"; "ga" -> "GA" (general admission keeps its
// acronym). Tiers are stored lowercase at placement time.
function tierLabel(tier: string): string {
  if (tier.toLowerCase() === "ga") return "GA";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// Parse a NUMERIC-as-string coordinate to a finite number, or null.
function toCoord(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function presentTicketView(
  input: PresentTicketInput,
  tz: string = DEFAULT_TZ,
): TicketView {
  const row = input.rows.find((r) => r.id === input.seatAssignment.venueRowId);

  return {
    ticketId: input.ticket.id,
    ticketStatus: input.ticket.status,
    artist: input.artistName,
    venue: input.venueName,
    city: input.venueCity ?? "",
    dateLong: formatDateLong(input.doorsAt, tz),
    seat: {
      section: tierLabel(input.seatAssignment.tier),
      // Fall back to the raw id if the architecture no longer lists the row
      // (shouldn't happen — seats only get assigned to active rows).
      row: row?.rowName ?? input.seatAssignment.venueRowId,
      seats: input.seatAssignment.seatNumbers.join(" · "),
      // chargedAmountCents is set when the PaymentIntent captured at binding.
      // A null here means the seat was placed but not yet charged — show $0
      // rather than crash; the page only routes here for issued tickets.
      paid: formatCents(input.seatAssignment.chargedAmountCents ?? 0),
    },
    geo: {
      lat: toCoord(input.geoLat),
      lon: toCoord(input.geoLon),
      radiusM: input.geoRadiusM,
    },
  };
}
