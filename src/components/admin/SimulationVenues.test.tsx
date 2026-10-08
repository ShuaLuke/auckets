// The venue tools under the Simulation picker: build a venue from tiers,
// import a file, export JSON/CSV, set floors, and remember venues in this
// browser without failing when storage is unavailable.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimVenue } from "@/lib/sim/types";
import { parseVenueFile } from "@/lib/sim/venue";
import { venueFromBuilder, venueToCsv } from "@/lib/sim/venue-io";

import { loadStoredVenues, SimulationVenues, storeVenues, uniqueName } from "./SimulationVenues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

function mount(props: Partial<React.ComponentProps<typeof SimulationVenues>> = {}) {
  const onAdd = vi.fn();
  const onUpdate = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SimulationVenues selected={null} takenNames={new Set(["the-fillmore"])} onAdd={onAdd} onUpdate={onUpdate} onDelete={vi.fn()} fetchLibraryVenue={vi.fn()} {...props} />));
  return { onAdd, onUpdate, el: host };
}

const click = (el: Element | null | undefined): void => act(() => (el as HTMLElement).click());
const button = (el: HTMLElement, text: string): HTMLElement | undefined => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SimulationVenues", () => {
  it("builds a venue from the default tiers under a name nobody has", () => {
    const { onAdd, el } = mount();
    click(button(el, "New venue"));
    type(el.querySelector<HTMLInputElement>("#sim-new-name")!, "The Fillmore");
    click(button(el, "Create venue"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const v = onAdd.mock.calls[0]![0] as SimVenue;
    expect(v.name).toBe("the-fillmore-2");
    expect(v.rows.reduce((s, r) => s + r.capacity, 0)).toBe(5 * 20 + 15 * 24);
    expect(v.tierFloorsCents).toEqual({ premium: 15000, standard: 8500 });
  });

  it("imports a CSV it exported", async () => {
    const { onAdd, el } = mount();
    const src = venueFromBuilder({ displayName: "Club", tiers: [{ name: "front", unitType: "tables", count: 2, seatsPerUnit: 4, floorCents: 5000 }] });
    const file = new File([venueToCsv(src)], "club.csv", { type: "text/csv" });
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(el.textContent).toContain("Imported Club from a seat manifest (CSV): 2 rows, 8 seats.");
    expect((onAdd.mock.calls[0]![0] as SimVenue).tierFloorsCents).toEqual({ front: 5000 });
  });

  it("asks for floors a venue is missing and saves them", () => {
    const venue = { ...venueFromBuilder({ displayName: "Bare", tiers: [{ name: "main", unitType: "rows", count: 2, seatsPerUnit: 10 }] }) };
    const { onUpdate, el } = mount({ selected: { kind: "custom", venue } });
    expect(el.textContent).toContain("No floor price for main");
    click(button(el, "Floor prices"));
    type(el.querySelector<HTMLInputElement>("#sim-floor-main")!, "65");
    click(button(el, "Save floors"));
    expect((onUpdate.mock.calls[0]![0] as SimVenue).tierFloorsCents).toEqual({ main: 6500 });
  });
});

describe("browser storage", () => {
  it("round-trips venues and drops ones that no longer validate", () => {
    const v = venueFromBuilder({ displayName: "Kept", tiers: [{ name: "a", unitType: "rows", count: 1, seatsPerUnit: 2 }] });
    expect(storeVenues([v])).toBe(true);
    window.localStorage.setItem("auckets.sim.venues.v1", JSON.stringify([v, { name: "broken" }]));
    expect(loadStoredVenues((raw) => parseVenueFile(raw)).map((x) => x.name)).toEqual(["kept"]);
  });

  it("works without storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadStoredVenues((raw) => parseVenueFile(raw))).toEqual([]);
    spy.mockRestore();
  });

  it("uniqueName adds a number", () => {
    expect(uniqueName("a", new Set())).toBe("a");
    expect(uniqueName("a", new Set(["a", "a-2"]))).toBe("a-3");
  });
});
