// useAnimatedNumber — a ~250ms requestAnimationFrame count-up for money
// readouts (the instrument, UI-4). Integer cents in, integer cents out every
// frame, so the caller can pass each frame's value straight to formatCents()
// (which throws on non-integers) and dollar displays roll instead of snapping.
//
// Behavior:
// - First render shows the target immediately — no count-up on mount.
// - When the target changes, tween from the currently-displayed value (not
//   the previous target), so rapid dial moves retarget smoothly mid-flight.
// - Under prefers-reduced-motion the value snaps instantly. SSR-safe: the
//   matchMedia probe only runs in the effect.

import { useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 250;

// Cubic ease-out — fast start, gentle settle. Matches the spirit of the
// design system's --ease-out without needing to parse a CSS cubic-bezier.
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Pure tween step: the integer value to display at `progress` (0..1) of the
 * way from `from` to `to`. Exact at both endpoints.
 */
export function tweenValue(from: number, to: number, progress: number): number {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return Math.round(from + (to - from) * easeOut(progress));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useAnimatedNumber(
  target: number,
  durationMs: number = DEFAULT_DURATION_MS,
): number {
  const [display, setDisplay] = useState(target);
  // What's currently on screen — the tween's starting point when the target
  // moves again mid-flight.
  const displayRef = useRef(target);

  useEffect(() => {
    if (displayRef.current === target) return;

    if (prefersReducedMotion() || durationMs <= 0) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const value = tweenValue(from, target, progress);
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}
