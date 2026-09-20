// The seat map against a real engine run: every seat drawn, shaded by price,
// and the hover card names the price paid. No DOM testing library in this
// app — static markup for structure, a bare React root for the hover.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { runScenario } from "@/lib/sim/run";
import { buildSeatMapView, type SeatMapView } from "@/lib/sim/seatmap";
import { offer, row, venue } from "@/lib/sim/test-helpers";
import type { Scenario } from "@/lib/sim/types";
import { applyShowOverlay } from "@/lib/sim/venue";

import { SimulationSeatMap } from "./SimulationSeatMap";

const v = venue([
  row({ id: "a", rank: 1, cap: 4, tier: "premium" }),
  row({ id: "b", rank: 2, cap: 4, tier: "front_mid", area: "front_balcony" }),
  row({ id: "c", rank: 3, cap: 3, tier: "rear", area: "upper_balcony" }),
]);
const scenario: Scenario = { name: "map", venue: "test-venue", show: { holds: [{ source: "artist", tier: "premium", seats: 1 }] }, pool: { file: "inline" }, policies: ["greedy"] };
const pool = [
  offer("o1", 3, 12000, { type: "specific", tier: "premium" }, 0),
  offer("o2", 2, 9000, { type: "this_or_worse", tier: "premium" }, 1),
  offer("o3", 2, 7000, { type: "any" }, 2),
];

function view(): SeatMapView {
  const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
  return buildSeatMapView(out.runs[0]!, applyShowOverlay(v, scenario.show).venue)!;
}

describe("SimulationSeatMap", () => {
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  it("draws every seat, the seat ranks, and a price legend", () => {
    const html = renderToStaticMarkup(<SimulationSeatMap view={view()} />);
    expect(html.match(/data-seat=/g)).toHaveLength(11);
    expect(html.match(/data-o=/g)).toHaveLength(7); // occupied seats carry their offer
    expect(html).toContain("7</strong> of 10 seats filled");
    expect(html).toContain("1 held");
    expect(html).toContain("Price paid per ticket");
    expect(html).toContain("$120");
    expect(html).toContain("$70");
    expect(html).toContain("Held");
    // Opens as a seating chart: stage, then each level by name, row letters in the gutters.
    expect(html).toContain("Stage");
    expect(html).toContain("front balcony");
    expect(html).toContain("upper balcony");
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows the price paid, the group, and the offer's rank on hover", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<SimulationSeatMap view={view()} />));

    const seatOf = (offerIdx: number): Element => container!.querySelector(`[data-o="${offerIdx}"]`)!;
    act(() => {
      seatOf(1).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const tip = container.querySelector('[role="tooltip"]')?.textContent ?? "";
    expect(tip).toContain("$90.00");
    expect(tip).toContain("Group of 2");
    expect(tip).toContain("$180.00 total");
    expect(tip).toContain("Offer #2 of 3");
    expect(tip).toContain("waterfalled down");
    expect(tip).toContain("Seat rank #2");

    const empty = container.querySelector('[data-seat="2:0"]')!;
    act(() => {
      empty.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Empty seat");

    // The by-rank layout is one click away and draws the same seats.
    const byRank = [...container.querySelectorAll("button")].find((b) => b.textContent === "By seat rank")!;
    act(() => {
      byRank.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(container.querySelectorAll("[data-seat]")).toHaveLength(11);
    expect(container.textContent).toContain("front mid"); // tier heading, underscores tidied
    expect(container.textContent).toContain("Rows run best seat-rank first");

    act(() => root.unmount());
  });
});
