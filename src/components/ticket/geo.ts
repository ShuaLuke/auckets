// Geo helpers for the fan TicketViewer's geo-gate (ADR-0015).
//
// The gate is a UX boundary, not the security boundary: it decides whether
// to *show* a fan their rotating QR based on proximity to the venue, to
// discourage casual remote hand-off. The authoritative geo check happens
// server-side at scan time (the Scanner slice validates the door device's
// location and writes ticket_scans.distance_m). These helpers are pure so
// they're unit-testable without a browser or the geolocation API.

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle (haversine) distance between two points, in whole meters.
// Accurate to well under a meter at city scale — far finer than the ~500m
// venue radius needs — and cheap enough to run on every position update.
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function isWithinVenue(distanceM: number, radiusM: number): boolean {
  return distanceM <= radiusM;
}
