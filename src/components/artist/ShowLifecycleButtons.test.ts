/** @vitest-environment node */
// The status → visible-actions mapping for the ShowAdmin lifecycle controls.
// This must stay in lockstep with the server transitions' from-status guards
// (shows.ts): a button only renders when the matching transition could fire.

import { describe, expect, it } from "vitest";

import { actionsFor } from "./ShowLifecycleButtons";

describe("actionsFor", () => {
  it("an open show can be paused or ended early", () => {
    expect(actionsFor("open")).toEqual(["pause", "close"]);
  });

  it("a paused show can be resumed or ended early", () => {
    expect(actionsFor("paused")).toEqual(["resume", "close"]);
  });

  it("renders no lifecycle controls outside the running states", () => {
    for (const status of [
      "draft",
      "closed",
      "allocating",
      "allocated",
      "complete",
    ] as const) {
      expect(actionsFor(status)).toEqual([]);
    }
  });
});
