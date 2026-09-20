// The room at section level: one block per section shaded by average price,
// and a section opens seat by seat — from the view already in hand, or by
// asking for that level when the room was too big to send.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runScenario } from "@/lib/sim/run";
import { buildSeatMapView, filterSeatMapView, summariseSections, type SeatMapView } from "@/lib/sim/seatmap";
import { offer, row, venue } from "@/lib/sim/test-helpers";
import type { Scenario } from "@/lib/sim/types";

import { SimulationRoomMap } from "./SimulationRoomMap";

const v = venue([
  row({ id: "a", rank: 1, cap: 4, tier: "premium", section: "Field Box 104" }),
  row({ id: "b", rank: 2, cap: 4, tier: "premium", section: "Field Box 105" }),
  row({ id: "c", rank: 3, cap: 3, tier: "rear", area: "view_deck", section: "View Deck 410" }),
]);
const scenario: Scenario = { name: "room", venue: "test-venue", pool: { file: "inline" }, policies: ["greedy"] };
const pool = [offer("o1", 4, 12000, { type: "any" }, 0), offer("o2", 2, 9000, { type: "any" }, 1), offer("o3", 2, 7000, { type: "any" }, 2)];

function full(): SeatMapView {
  const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
  return buildSeatMapView(out.runs[0]!, v)!;
}

describe("SimulationRoomMap", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mount = (ui: JSX.Element): void => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(ui));
  };
  const tile = (name: string): HTMLButtonElement => container.querySelector<HTMLButtonElement>(`button[aria-label^="${name}:"]`)!;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens on sections when the seat map wasn't sent, grouped by level and shared name", () => {
    mount(<SimulationRoomMap sections={summariseSections(full())} />);
    const text = container.textContent ?? "";
    expect(text).toContain("One block per section");
    expect(text).toContain("Average price paid per ticket");
    expect(text).toContain("Field Box"); // the shared lead-in, once
    expect(tile("Field Box 104").textContent).toBe("104");
    expect(tile("View Deck 410").textContent).toBe("View Deck 410"); // a one-off keeps its name
    expect(container.querySelectorAll("[data-sec]")).toHaveLength(3);
    expect(container.textContent).not.toContain("Every seat"); // nothing to switch to

    act(() => {
      tile("Field Box 105").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const tip = container.querySelector('[role="tooltip"]')?.textContent ?? "";
    expect(tip).toContain("Field Box 105");
    expect(tip).toContain("$80.00"); // (2 × $90 + 2 × $70) / 4
    expect(tip).toContain("From $70.00 to $90.00");
    expect(tip).toContain("4 of 4 seats filled");
    expect(tip).toContain("2 groups");
  });

  it("fetches a level's seats the first time one of its sections is opened, then reuses them", async () => {
    const view = full();
    const loadArea = vi.fn(async (area: string) => filterSeatMapView(view, (r) => r.area === area));
    mount(<SimulationRoomMap sections={summariseSections(view)} loadArea={loadArea} />);

    await act(async () => {
      tile("Field Box 104").click();
    });
    expect(loadArea).toHaveBeenCalledExactlyOnceWith("orchestra");
    expect(container.textContent).toContain("Field Box 104");
    expect(container.querySelectorAll("[data-seat]")).toHaveLength(4); // just this section's seats

    act(() => {
      [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("All sections"))!.click();
    });
    await act(async () => {
      tile("Field Box 105").click();
    });
    expect(loadArea).toHaveBeenCalledTimes(1); // same level — no second fetch
    expect(container.querySelectorAll("[data-seat]")).toHaveLength(4);
  });

  it("says so when the seats can't be loaded", async () => {
    mount(<SimulationRoomMap sections={summariseSections(full())} loadArea={async () => Promise.reject(new Error("over the work limit"))} />);
    await act(async () => {
      tile("View Deck 410").click();
    });
    expect(container.textContent).toContain("over the work limit");
  });

  it("opens a small room on every seat, with sections one click away and no fetch needed", () => {
    const view = full();
    const loadArea = vi.fn();
    mount(<SimulationRoomMap sections={summariseSections(view)} view={view} loadArea={loadArea} />);
    expect(container.querySelectorAll("[data-seat]")).toHaveLength(11);
    act(() => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Sections")!.click();
    });
    act(() => {
      tile("View Deck 410").click();
    });
    expect(loadArea).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-seat]")).toHaveLength(3);
  });
});
