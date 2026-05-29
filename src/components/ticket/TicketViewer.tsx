// Fan-facing ticket viewer — prototype-fidelity port of
// design/ui_kits/auckets/screens/TicketViewer.jsx (rotating geo-gated QR,
// ADR-0015).
//
// What's REAL here:
//   - The geo-gate uses navigator.geolocation + a haversine distance to the
//     venue centroid (src/components/ticket/geo.ts). Within venue.geoRadiusM
//     the ticket unlocks; otherwise it stays gated.
//   - The QR renders a real scannable code (qrcode.react) and rotates on the
//     true 60s window with a live countdown.
//
// What's a deliberate STUB (separate backend slices, flagged in the PR):
//   - The token in the QR is a placeholder (src/components/ticket/token.ts),
//     NOT the server-signed TOTP. tickets.totp_secret must never reach the
//     client, so the real token comes from a future GET /api/tickets/[id]/token.
//   - The authoritative geo check happens server-side at scan time (Scanner
//     slice). This client gate only discourages casual remote hand-off.
//   - Resale / gift are present but disabled (ResaleFlow is unbuilt).

"use client";

import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Gift,
  Info,
  Loader2,
  MapPin,
  MapPinOff,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { TicketView } from "@/lib/presenters/ticket";

import { haversineMeters, isWithinVenue } from "./geo";
import {
  buildPlaceholderToken,
  rotationWindow,
  secondsUntilRotation,
  ROTATION_PERIOD_MS,
} from "./token";

type GeoState = "prompt" | "requesting" | "granted" | "denied" | "far";

// Design palette (dark ticket theme).
const C = {
  bg: "#0E0F0C",
  paper: "#F4F1E8",
  ink: "#0E0F0C",
  gold: "#C99A4B",
  green: "#1F4A2E",
  muted: "#9C9789",
  panelInk: "#46443B",
  card: "#1C1B17",
} as const;

export function TicketViewer({ view }: { view: TicketView }) {
  const [geoState, setGeoState] = useState<GeoState>("prompt");
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Drive the rotation countdown. 1s tick is enough for the "rotates in Ns"
  // label and the bar; the QR value only changes at the 60s boundary.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function requestGeo() {
    setGeoState("requesting");

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("denied");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Venue coordinates not configured yet → we can't measure distance.
        // Treat as unlocked (the gate is best-effort UX); flag null distance.
        if (view.geo.lat === null || view.geo.lon === null) {
          setDistanceM(null);
          setGeoState("granted");
          return;
        }
        const d = haversineMeters(
          { lat: pos.coords.latitude, lon: pos.coords.longitude },
          { lat: view.geo.lat, lon: view.geo.lon },
        );
        setDistanceM(d);
        setGeoState(isWithinVenue(d, view.geo.radiusM) ? "granted" : "far");
      },
      () => {
        // Any failure — permission denied, position unavailable, or timeout —
        // means we couldn't verify proximity, so the ticket stays gated.
        setGeoState("denied");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  const secondsLeft = secondsUntilRotation(nowMs);
  const token = buildPlaceholderToken(view.ticketId, rotationWindow(nowMs));
  const periodSeconds = ROTATION_PERIOD_MS / 1000;

  return (
    <main style={{ background: C.bg, minHeight: "calc(100vh - 57px)", color: C.paper }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px 64px" }}>
        <Link
          href="/dashboard"
          className="no-underline"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#C8C4B7",
            marginBottom: 24,
            borderBottom: "none",
          }}
        >
          <ArrowLeft size={14} aria-hidden /> Back to shows
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: C.gold,
            }}
          >
            Show ticket · {view.artist}
          </span>
          <h1
            className="font-display"
            style={{
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: C.paper,
              marginTop: 8,
            }}
          >
            {view.venue}
          </h1>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
            {view.dateLong}
            {view.city ? ` · ${view.city}` : ""}
          </div>
        </div>

        {/* QR panel — gated on geo */}
        <div
          style={{
            background: C.paper,
            color: C.ink,
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 24px 64px rgba(0,0,0,.4)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {geoState === "prompt" && <GeoPrompt venue={view.venue} onAllow={requestGeo} />}

          {geoState === "requesting" && (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <Loader2
                size={28}
                aria-hidden
                style={{ color: C.green, margin: "0 auto 14px", display: "block" }}
                className="animate-spin"
              />
              <div style={{ fontSize: 13, color: C.panelInk }}>Checking location…</div>
            </div>
          )}

          {geoState === "denied" && (
            <GeoBlocked
              title="Location required"
              body="AUCKETS tickets are geo-gated to prevent remote handoff to scalpers. Re-enable location for AUCKETS in your browser settings, then try again."
              cta="Try again"
              onRetry={requestGeo}
            />
          )}

          {geoState === "far" && (
            <GeoBlocked
              title={
                distanceM !== null
                  ? `You're ${distanceM.toLocaleString()}m from the venue`
                  : "You're not at the venue yet"
              }
              body={`Your ticket won't show until you're near the doors. Head over — we'll unlock it within ~${view.geo.radiusM}m of ${view.venue}.`}
              cta="Check again"
              onRetry={requestGeo}
            />
          )}

          {geoState === "granted" && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <Badge tone="placed" dot>
                  {distanceM !== null ? `Live ticket · ${distanceM}m from venue` : "Live ticket"}
                </Badge>
                <span className="font-mono" style={{ fontSize: 11, color: C.panelInk }}>
                  Rotates in {secondsLeft}s
                </span>
              </div>

              {/* Real QR over the (placeholder) rotating token */}
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: 8,
                  padding: 16,
                  width: "100%",
                  maxWidth: 280,
                  margin: "0 auto",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <QRCodeSVG
                  value={token}
                  size={232}
                  level="M"
                  bgColor="#FFFFFF"
                  fgColor={C.ink}
                  aria-label="Your rotating entry QR code"
                />
              </div>

              {/* Countdown bar */}
              <div
                style={{
                  height: 4,
                  background: "#E8E6DE",
                  borderRadius: 2,
                  overflow: "hidden",
                  marginTop: 16,
                }}
              >
                <div
                  style={{
                    width: `${(secondsLeft / periodSeconds) * 100}%`,
                    height: "100%",
                    background: C.green,
                    transition: "width 1s linear",
                  }}
                />
              </div>

              <div style={{ borderTop: "1px dashed rgba(14,15,12,.22)", margin: "22px -8px 18px" }} />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                <SeatStat label="Section" value={view.seat.section} />
                <SeatStat label="Row" value={view.seat.row} />
                <SeatStat label="Seats" value={view.seat.seats} />
                <SeatStat label="Paid" value={view.seat.paid} />
              </div>

              <div
                className="font-mono"
                style={{
                  marginTop: 18,
                  padding: "10px 12px",
                  background: C.ink,
                  borderRadius: 6,
                  fontSize: 10,
                  color: C.muted,
                  letterSpacing: "0.02em",
                  wordBreak: "break-all",
                }}
              >
                token: <span style={{ color: C.gold }}>{token}</span>
                {" · "}exp: <span style={{ color: "#6A8F6F" }}>{secondsLeft}s</span>
              </div>
            </>
          )}
        </div>

        {/* Why this rotates */}
        <div
          style={{
            marginTop: 22,
            padding: 16,
            background: C.card,
            borderRadius: 8,
            fontSize: 12,
            color: C.muted,
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: C.paper, display: "block", marginBottom: 6 }}>
            <Info size={12} aria-hidden style={{ marginRight: 6, verticalAlign: "-1px" }} />
            Why this rotates
          </strong>
          A screenshot of an AUCKETS ticket is worthless after 60 seconds. The QR is bound to your
          account and your phone&apos;s location; sending it to someone else won&apos;t work.
        </div>

        {/* Resale + gift — present per the design, disabled until ResaleFlow ships */}
        <div
          style={{
            marginTop: 18,
            padding: 16,
            background: C.card,
            borderRadius: 8,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: C.muted, flex: 1, alignSelf: "center", minWidth: 140 }}>
            Can&apos;t make it?
          </span>
          <Button variant="inverse" size="sm" disabled title="Resale is coming soon">
            <RefreshCw size={14} aria-hidden /> List for resale
          </Button>
          <Button variant="inverse" size="sm" disabled title="Gifting is coming soon">
            <Gift size={14} aria-hidden /> Gift it
          </Button>
        </div>
      </div>
    </main>
  );
}

function GeoPrompt({ venue, onAllow }: { venue: string; onAllow: () => void }) {
  return (
    <div style={{ padding: "24px 8px", textAlign: "center" }}>
      <div
        style={{
          width: 56,
          height: 56,
          background: "#0E0F0C",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 18px",
          color: "#C99A4B",
        }}
      >
        <MapPin size={26} aria-hidden />
      </div>
      <h3 style={{ fontSize: 20, marginBottom: 8 }}>Unlock your ticket at the venue</h3>
      <p style={{ fontSize: 14, color: "#46443B", lineHeight: 1.55, maxWidth: 320, margin: "0 auto 20px" }}>
        AUCKETS tickets are geo-gated. They appear when you&apos;re near {venue} and rotate every 60s
        to prevent remote handoff.
      </p>
      <Button variant="brand" size="lg" onClick={onAllow}>
        Allow location
      </Button>
      <div style={{ fontSize: 11, color: "#6B6759", marginTop: 12 }}>
        AUCKETS never stores your precise location.
      </div>
    </div>
  );
}

function GeoBlocked({
  title,
  body,
  cta,
  onRetry,
}: {
  title: string;
  body: string;
  cta: string;
  onRetry: () => void;
}) {
  return (
    <div style={{ padding: "24px 8px", textAlign: "center" }}>
      <div
        style={{
          width: 56,
          height: 56,
          background: "#F2D9D3",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 18px",
          color: "#A93C2A",
        }}
      >
        <MapPinOff size={26} aria-hidden />
      </div>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 14, color: "#46443B", lineHeight: 1.55, maxWidth: 320, margin: "0 auto 18px" }}>
        {body}
      </p>
      <Button variant="primary" onClick={onRetry}>
        {cta}
      </Button>
      <div style={{ fontSize: 11, color: "#6B6759", marginTop: 12 }}>
        Trouble? Find a venue staffer with an AUCKETS tablet — they can look you up by name and ID.
      </div>
    </div>
  );
}

function SeatStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          color: "#6B6759",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span className="font-mono" style={{ fontSize: 16, color: "#0E0F0C", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}
