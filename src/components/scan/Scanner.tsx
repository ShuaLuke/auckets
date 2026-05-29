// Door scanner UI (ADR-0015). Two capture paths, per the product decision:
//   - Live camera via the browser BarcodeDetector API + getUserMedia (Chrome /
//     Android; the door-realistic path), and
//   - a manual token paste/type fallback for devices without BarcodeDetector
//     or in poor lighting.
// Both POST to /api/scan and render the same outcome banner.
//
// NOTE: this component can't be exercised in CI or the local dev server
// (camera permissions + a real device). The scan DECISION logic it drives is
// covered server-side (processTicketScan integration tests); this is the
// presentation + capture shell.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";

// Minimal shape of the (not-yet-in-lib.dom) BarcodeDetector API.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector ?? null
  );
}

type ScanResult = "ok" | "invalid" | "replay" | "expired_token";

type Outcome = { result: ScanResult; reason?: string };

// Per-result presentation. Green = admit; amber = recoverable (refresh /
// already used); red = reject.
const RESULT_DISPLAY: Record<
  ScanResult,
  { bg: string; fg: string; title: string; sub: string }
> = {
  ok: { bg: "#E3EEDD", fg: "#1F4A2E", title: "Admitted", sub: "Let them in." },
  replay: {
    bg: "#F6E6CC",
    fg: "#8F6A2A",
    title: "Already scanned",
    sub: "This ticket was already used.",
  },
  expired_token: {
    bg: "#F6E6CC",
    fg: "#8F6A2A",
    title: "Expired code",
    sub: "Ask the fan to refresh their QR and try again.",
  },
  invalid: {
    bg: "#F3D9D2",
    fg: "#A93C2A",
    title: "Invalid ticket",
    sub: "This QR isn't a valid ticket for entry.",
  },
};

export function Scanner() {
  const [manualToken, setManualToken] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Debounce: don't re-submit the same token within a few seconds (the camera
  // sees the same QR many times per second).
  const lastSubmitRef = useRef<{ token: string; at: number } | null>(null);

  const cameraSupported = getBarcodeDetectorCtor() !== null;

  const submit = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    const last = lastSubmitRef.current;
    if (last && last.token === trimmed && Date.now() - last.at < 3000) return;
    lastSubmitRef.current = { token: trimmed, at: Date.now() };

    setBusy(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      if (!res.ok) {
        setOutcome({ result: "invalid", reason: `http_${res.status}` });
        return;
      }
      const data = (await res.json()) as Outcome;
      setOutcome(data);
    } catch {
      setOutcome({ result: "invalid", reason: "network" });
    } finally {
      setBusy(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setCameraError("This device can't scan — paste the token instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);

      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const raw = codes[0]?.rawValue;
          if (raw) await submit(raw);
        } catch {
          // Per-frame detect can throw transiently; ignore and keep looping.
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError("Couldn't open the camera — check permissions.");
    }
  }, [submit]);

  // Tear down the stream + loop on unmount.
  useEffect(() => stopCamera, [stopCamera]);

  const display = outcome ? RESULT_DISPLAY[outcome.result] : null;

  return (
    <div className="flex flex-col gap-4">
      {display && (
        <div
          role="status"
          className="rounded-xl p-5"
          style={{ background: display.bg }}
        >
          <div
            className="font-sans"
            style={{ fontSize: 20, fontWeight: 700, color: display.fg }}
          >
            {display.title}
          </div>
          <div
            className="font-sans"
            style={{ fontSize: 13, color: display.fg, marginTop: 2 }}
          >
            {display.sub}
          </div>
        </div>
      )}

      {/* Camera */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ border: "1px solid var(--border)", background: "#000" }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "cover",
            display: cameraOn ? "block" : "none",
          }}
        />
        {!cameraOn && (
          <div
            className="flex items-center justify-center"
            style={{ aspectRatio: "1 / 1", background: "var(--card-sunken, #EDEAE0)" }}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={startCamera}
              disabled={!cameraSupported}
            >
              {cameraSupported ? "Start camera" : "Camera unavailable"}
            </Button>
          </div>
        )}
      </div>
      {cameraOn && (
        <Button variant="ghost" size="sm" onClick={stopCamera}>
          Stop camera
        </Button>
      )}
      {cameraError && (
        <div className="font-sans" style={{ fontSize: 12, color: "#A93C2A" }}>
          {cameraError}
        </div>
      )}

      {/* Manual fallback */}
      <div
        className="rounded-xl p-4"
        style={{ border: "1px solid var(--border)" }}
      >
        <label
          className="font-sans"
          style={{ fontSize: 12, color: "var(--fg-muted)" }}
        >
          Or paste the token
        </label>
        <textarea
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          rows={2}
          placeholder="auckets.v1.…"
          className="mt-2 w-full rounded-md p-2 font-mono"
          style={{ border: "1px solid var(--border)", fontSize: 12 }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => submit(manualToken)}
            disabled={busy || manualToken.trim().length === 0}
          >
            {busy ? "Checking…" : "Check token"}
          </Button>
        </div>
      </div>
    </div>
  );
}
