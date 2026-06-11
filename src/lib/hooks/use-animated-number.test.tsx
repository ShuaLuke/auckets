// Tests for useAnimatedNumber — the rAF count-up behind the composer's
// rolling dollar displays (UI-4). rAF and performance.now are mocked so the
// tween is driven frame-by-frame, deterministically. No testing-library in
// this repo: a tiny createRoot + act harness renders a probe component.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tweenValue, useAnimatedNumber } from "./use-animated-number";

// --- pure tween math -------------------------------------------------------

describe("tweenValue", () => {
  it("is exact at both endpoints", () => {
    expect(tweenValue(1000, 5000, 0)).toBe(1000);
    expect(tweenValue(1000, 5000, 1)).toBe(5000);
  });

  it("clamps out-of-range progress", () => {
    expect(tweenValue(1000, 5000, -0.5)).toBe(1000);
    expect(tweenValue(1000, 5000, 1.5)).toBe(5000);
  });

  it("returns integers mid-flight (safe for formatCents)", () => {
    for (const p of [0.1, 0.25, 0.33, 0.5, 0.77, 0.99]) {
      expect(Number.isInteger(tweenValue(1001, 4999, p))).toBe(true);
    }
  });

  it("eases out: covers more ground in the first half than the second", () => {
    const mid = tweenValue(0, 1000, 0.5);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(1000);
  });

  it("moves monotonically toward the target, downward too", () => {
    let prev = 5000;
    for (const p of [0.2, 0.4, 0.6, 0.8, 1]) {
      const v = tweenValue(5000, 1000, p);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(1000);
  });
});

// --- the hook, with mocked rAF ----------------------------------------------

// React 18.3 act() needs this flag outside a test-renderer environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let latest = -1;
function Probe({ value, durationMs }: { value: number; durationMs?: number }) {
  latest = useAnimatedNumber(value, durationMs ?? 250);
  return null;
}

describe("useAnimatedNumber", () => {
  let container: HTMLDivElement;
  let root: Root;
  let now: number;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let reducedMotion: boolean;

  function render(value: number, durationMs?: number) {
    act(() => {
      root.render(
        durationMs === undefined ? (
          <Probe value={value} />
        ) : (
          <Probe value={value} durationMs={durationMs} />
        ),
      );
    });
  }

  /** Advance the mocked clock and run every queued rAF callback once. */
  function tick(ms: number) {
    now += ms;
    const due = [...frames.values()];
    frames.clear();
    act(() => {
      for (const cb of due) cb(now);
    });
  }

  beforeEach(() => {
    now = 0;
    nextFrameId = 1;
    frames = new Map();
    reducedMotion = false;

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    // jsdom has no matchMedia; the hook treats its absence as "no preference",
    // so stub it explicitly to exercise both branches.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reducedMotion,
      media: query,
    }));
    vi.spyOn(performance, "now").mockImplementation(() => now);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the initial value immediately, with no animation queued", () => {
    render(4250);
    expect(latest).toBe(4250);
    expect(frames.size).toBe(0);
  });

  it("tweens to a new target and lands exactly on it", () => {
    render(1000);
    render(5000);
    expect(frames.size).toBe(1); // animation scheduled

    tick(125); // halfway
    expect(latest).toBeGreaterThan(1000);
    expect(latest).toBeLessThan(5000);
    expect(Number.isInteger(latest)).toBe(true);

    tick(125); // done
    expect(latest).toBe(5000);
    expect(frames.size).toBe(0); // loop stopped
  });

  it("retargets mid-flight from the displayed value, not the old target", () => {
    render(0);
    render(10000);
    tick(125);
    const midway = latest;
    expect(midway).toBeGreaterThan(0);

    // Dial moves again before the first tween lands.
    render(midway + 100);
    tick(250);
    expect(latest).toBe(midway + 100);
  });

  it("snaps instantly under prefers-reduced-motion", () => {
    render(1000);
    reducedMotion = true;
    render(9999);
    expect(latest).toBe(9999);
    expect(frames.size).toBe(0);
  });

  it("cancels the in-flight frame on unmount", () => {
    render(1000);
    render(5000);
    expect(frames.size).toBe(1);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    // re-create so afterEach's unmount is a no-op double unmount
    root = createRoot(container);
  });
});
