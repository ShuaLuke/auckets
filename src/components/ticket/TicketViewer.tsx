// Fan-facing ticket viewer — Change 05.1. The arrival moment, rendered as a
// real ticket stub: a tall card on --paper with a perforation line and a
// tear-off sub-stub holding the rotating geo-gated QR (ADR-0015). This is a
// presentation elevation only — the rotating-token mechanism and the geo gate
// are unchanged.
//
// What's REAL here:
//   - The geo-gate uses navigator.geolocation + a haversine distance to the
//     venue centroid (src/components/ticket/geo.ts). Within venue.geoRadiusM
//     the ticket unlocks; otherwise it stays calmly obscured.
//   - The QR renders a real scannable code (qrcode.react) over the
//     server-signed rotating token, on the true 60s window with a countdown.
//
// What's a deliberate STUB (separate backend slices, flagged in the PR):
//   - The real token comes from GET /api/tickets/[id]/token; we never mint it
//     client-side (tickets.totp_secret must not reach the client). Before
//     geo-unlock we show an abstract obscured pattern, never a real code.
//   - The authoritative geo check happens server-side at scan time. This
//     client gate only discourages casual remote hand-off.
//   - Apple Wallet, resale, and gift are present per the design but disabled
//     until their backends ship (ResaleFlow / .pkpass unbuilt).
//
// Design rules honored: tokens only (no hardcoded hex), mono for seats/money,
// calm reveal via .auk-reveal (≤320ms, disabled under prefers-reduced-motion),
// reassuring — not surveillance-y — privacy copy.

"use client";

import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Gift,
  Info,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { TicketView } from "@/lib/presenters/ticket";

import { haversineMeters, isWithinVenue } from "./geo";
import { rotationWindow, secondsUntilRotation, ROTATION_PERIOD_MS } from "./token";

type GeoState = "prompt" | "requesting" | "granted" | "denied" | "far";

// The small Auckets mark (references/assets/logo-mark-greenwood.svg), inlined
// so it can be tokenized and needs no asset pipeline. Sits at a stub corner.
function AucketsMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Auckets"
    >
      <defs>
        <pattern
          id="auk-perf-mark"
          x="0"
          y="0"
          width="8"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="7" r="2" fill="var(--paper)" />
        </pattern>
      </defs>
      <rect x="6" y="6" width="108" height="108" rx="20" fill="var(--brand)" />
      <rect x="84" y="14" width="8" height="92" fill="url(#auk-perf-mark)" />
      <text
        x="14"
        y="92"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="92"
        letterSpacing="-0.04em"
        fill="var(--paper)"
      >
        A
      </text>
    </svg>
  );
}

export function TicketViewer({ view }: { view: TicketView }) {
  const [geoState, setGeoState] = useState<GeoState>("prompt");
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // The signed token comes from the server (GET /api/tickets/[id]/token); we
  // never mint it client-side. null = not yet fetched for the current window.
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);

  // Drive the rotation countdown. 1s tick is enough for the "rotates in Ns"
  // label and the bar; the QR value only changes at the 60s boundary.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch the server-signed token once unlocked, then refetch whenever the
  // 60s window rolls over (currentWindow changes only at the boundary).
  const currentWindow = rotationWindow(nowMs);
  useEffect(() => {
    if (geoState !== "granted") return;
    let cancelled = false;
    setTokenError(false);
    fetch(`/api/tickets/${view.ticketId}/token`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { token: string }) => {
        if (!cancelled) setToken(body.token);
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setTokenError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [geoState, currentWindow, view.ticketId]);

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
        // means we couldn't verify proximity, so the ticket stays obscured.
        setGeoState("denied");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  const secondsLeft = secondsUntilRotation(nowMs);
  const periodSeconds = ROTATION_PERIOD_MS / 1000;
  const unlocked = geoState === "granted";

  return (
    <main
      style={{
        background: "var(--ink-900)",
        minHeight: "calc(100vh - 57px)",
        color: "var(--paper)",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px 64px" }}>
        <Link
          href="/dashboard"
          className="no-underline"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--ink-200)",
            marginBottom: 24,
            borderBottom: "none",
          }}
        >
          <ArrowLeft size={14} aria-hidden /> Back to shows
        </Link>

        {/* The ticket stub — a tall card on paper, perforated into a main stub
            (artist/venue/date/seats) and a tear-off sub-stub (the QR). */}
        <article
          style={{
            position: "relative",
            background: "var(--paper)",
            color: "var(--ink-900)",
            borderRadius: 14,
            border: "1px solid var(--border)",
            boxShadow: "0 24px 64px rgba(0,0,0,.4)",
          }}
        >
          {/* Auckets mark, small at the top-right corner. */}
          <span style={{ position: "absolute", top: 20, right: 20 }} aria-hidden>
            <AucketsMark size={30} />
          </span>

          {/* Main stub */}
          <div style={{ padding: "28px 24px 22px" }}>
            <span
              className="font-mono"
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: "var(--marquee-700)",
              }}
            >
              Show ticket
            </span>
            <h1
              className="font-display"
              style={{
                fontWeight: 700,
                fontSize: 30,
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                color: "var(--ink-900)",
                margin: "8px 0 0",
              }}
            >
              {view.artist}
            </h1>
            <div style={{ fontSize: 15, color: "var(--fg-muted)", marginTop: 4 }}>
              {view.venue}
            </div>
            <div style={{ fontSize: 13, color: "var(--fg-subtle)", marginTop: 2 }}>
              {view.dateLong}
              {view.city ? ` · ${view.city}` : ""}
            </div>

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 16,
              }}
            >
              <SeatStat label="Section" value={view.seat.section} />
              <SeatStat label="Row" value={view.seat.row} />
              <SeatStat label="Seats" value={view.seat.seats} />
              <SeatStat label="Paid" value={view.seat.paid} />
            </div>
          </div>

          {/* Perforation: notch · dotted line · notch */}
          <div
            style={{
              position: "relative",
              height: 0,
              borderTop: "2px dotted var(--border-strong)",
              margin: "0 18px",
            }}
          >
            <Notch side="left" />
            <Notch side="right" />
          </div>

          {/* Tear-off sub-stub — the rotating QR, obscured until at the door. */}
          <div style={{ padding: "24px 24px 28px" }}>
            {unlocked ? (
              <UnlockedQr
                token={token}
                tokenError={tokenError}
                distanceM={distanceM}
                secondsLeft={secondsLeft}
                periodSeconds={periodSeconds}
              />
            ) : (
              <ObscuredQr
                state={geoState}
                venue={view.venue}
                distanceM={distanceM}
                radiusM={view.geo.radiusM}
                onAct={requestGeo}
              />
            )}
          </div>
        </article>

        {/* Add to Apple Wallet — primary action per the design; disabled until
            .pkpass issuance ships. */}
        <button
          type="button"
          disabled
          title="Apple Wallet is coming soon"
          className="font-sans"
          style={{
            marginTop: 18,
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "13px 18px",
            borderRadius: 999,
            border: "none",
            background: "var(--ink-700)",
            color: "color-mix(in srgb, var(--paper) 60%, transparent)",
            fontSize: 14,
            fontWeight: 500,
            cursor: "not-allowed",
          }}
        >
          <Wallet size={16} aria-hidden /> Add to Apple Wallet
          <span style={{ fontSize: 11, opacity: 0.7 }}>· soon</span>
        </button>

        {/* Why this rotates + the privacy posture (reassuring, not surveillant). */}
        <div
          style={{
            marginTop: 22,
            padding: 16,
            background: "var(--ink-700)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--ink-200)",
            lineHeight: 1.6,
          }}
        >
          <strong
            style={{ color: "var(--paper)", display: "block", marginBottom: 6 }}
          >
            <Info
              size={12}
              aria-hidden
              style={{ marginRight: 6, verticalAlign: "-1px" }}
            />
            Why this rotates
          </strong>
          A screenshot of an AUCKETS ticket is worthless after 60 seconds — the
          QR is bound to your account, so it can&apos;t be screenshotted away.
          We check you&apos;re at the venue when you open it. We don&apos;t track
          you otherwise.
        </div>

        {/* Resale + gift — present per the design, disabled until ResaleFlow ships */}
        <div
          style={{
            marginTop: 18,
            padding: 16,
            background: "var(--ink-700)",
            borderRadius: 8,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: "var(--ink-200)",
              flex: 1,
              alignSelf: "center",
              minWidth: 140,
            }}
          >
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

// A half-circle "cut" at the perforation line, colored as the page so it reads
// as a tear notch on the stub edge.
function Notch({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: -10,
        [side]: -28,
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "var(--ink-900)",
      }}
    />
  );
}

// The QR before geo-unlock: an abstract, blurred placeholder (never a real
// code) with a calm "unlocks at the door" message and the location affordance.
function ObscuredQr({
  state,
  venue,
  distanceM,
  radiusM,
  onAct,
}: {
  state: GeoState;
  venue: string;
  distanceM: number | null;
  radiusM: number;
  onAct: () => void;
}) {
  const requesting = state === "requesting";
  const message =
    state === "denied"
      ? "Turn location on for AUCKETS, then tap to unlock. Your ticket appears once you're at the doors."
      : state === "far"
        ? distanceM !== null
          ? `You're about ${distanceM.toLocaleString()}m away. Your ticket unlocks within ~${radiusM}m of ${venue}.`
          : `Head over — your ticket unlocks within ~${radiusM}m of ${venue}.`
        : `Your ticket appears when you're at ${venue} and rotates every 60s, so it can't be handed off.`;
  const cta =
    state === "denied" ? "Try again" : state === "far" ? "Check again" : "Unlock at the door";

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 264,
          aspectRatio: "1 / 1",
          margin: "0 auto",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {/* Abstract obscured pattern — deliberately not a scannable code. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            filter: "blur(7px)",
            opacity: 0.5,
            backgroundColor: "var(--page)",
            backgroundImage:
              "repeating-linear-gradient(90deg, var(--ink-900) 0 8px, transparent 8px 16px), repeating-linear-gradient(0deg, var(--ink-900) 0 8px, transparent 8px 16px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "color-mix(in srgb, var(--paper) 55%, transparent)",
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--ink-900)",
              color: "var(--marquee-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {requesting ? (
              <Loader2 size={20} aria-hidden className="animate-spin" />
            ) : (
              <Lock size={20} aria-hidden />
            )}
          </span>
          <span
            className="font-sans"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {requesting ? "Checking you're at the door…" : `Unlocks at the door — ${venue}`}
          </span>
        </div>
      </div>

      <p
        className="font-sans"
        style={{
          fontSize: 13,
          color: "var(--fg-muted)",
          lineHeight: 1.55,
          maxWidth: 320,
          margin: "16px auto 16px",
        }}
      >
        {message}
      </p>

      <Button variant="brand" onClick={onAct} disabled={requesting}>
        <MapPin size={15} aria-hidden /> {cta}
      </Button>
    </div>
  );
}

// The QR once unlocked: the live rotating code, revealed calmly (≤320ms via
// .auk-reveal, disabled under prefers-reduced-motion).
function UnlockedQr({
  token,
  tokenError,
  distanceM,
  secondsLeft,
  periodSeconds,
}: {
  token: string | null;
  tokenError: boolean;
  distanceM: number | null;
  secondsLeft: number;
  periodSeconds: number;
}) {
  return (
    <div className="auk-reveal">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Badge tone="placed" dot>
          {distanceM !== null ? `Live · ${distanceM.toLocaleString()}m from venue` : "Live ticket"}
        </Badge>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          Rotates in {secondsLeft}s
        </span>
      </div>

      <div
        style={{
          background: "var(--page)",
          borderRadius: 10,
          padding: 16,
          width: "100%",
          maxWidth: 264,
          aspectRatio: "1 / 1",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--border)",
        }}
      >
        {token ? (
          // Concrete black-on-white, not tokens: qrcode.react writes these to
          // SVG fill attributes (where CSS var() can't resolve), and scanners
          // need true high contrast. Deliberate functional exception.
          <QRCodeSVG
            value={token}
            size={216}
            level="M"
            bgColor="#ffffff"
            fgColor="#0e0f0c"
            aria-label="Your rotating entry QR code"
          />
        ) : tokenError ? (
          <div style={{ textAlign: "center", color: "var(--brick-500)", fontSize: 13 }}>
            Couldn&apos;t load your ticket code.
            <br />
            It&apos;ll retry at the next refresh.
          </div>
        ) : (
          <Loader2 size={28} aria-hidden style={{ color: "var(--brand)" }} className="animate-spin" />
        )}
      </div>

      {/* Rotation freshness bar (security indicator, not a binding countdown). */}
      <div
        style={{
          height: 4,
          background: "var(--ink-100)",
          borderRadius: 2,
          overflow: "hidden",
          marginTop: 16,
        }}
      >
        <div
          style={{
            width: `${(secondsLeft / periodSeconds) * 100}%`,
            height: "100%",
            background: "var(--brand)",
            transition: "width 1s linear",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: "var(--fg-subtle)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Show this at the door — it refreshes every {periodSeconds}s on its own.
      </div>
    </div>
  );
}

function SeatStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        className="font-sans"
        style={{
          fontSize: 10,
          color: "var(--fg-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        className="font-mono"
        style={{ fontSize: 16, color: "var(--ink-900)", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
    </div>
  );
}
