// The methodology disclosures: static markup only — they are prose behind
// <details>, and the words are what matters.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BaseMethodology, PolicyMethodology } from "./SimulationMethodology";

describe("SimulationMethodology", () => {
  it("lists the base method as numbered steps", () => {
    const html = renderToStaticMarkup(<BaseMethodology />);
    expect(html).toContain("What every policy starts from");
    expect(html.match(/<li>/g)).toHaveLength(7);
    expect(html).toContain("Rank the offers: price per ticket first");
  });

  it("explains a combined policy part by part, with what it costs and whether it is rank-first", () => {
    const html = renderToStaticMarkup(<PolicyMethodology name="clean-fit+singles-reserve" open />);
    expect(html).toContain("<details open");
    expect(html).toContain("Clean-fit");
    expect(html).toContain("Singles reserve");
    expect(html.match(/What it costs:/g)).toHaveLength(2);
    expect(html).toContain("Fill-first");
    expect(renderToStaticMarkup(<PolicyMethodology name="greedy" />)).toContain("Rank-first");
  });

  it("renders nothing for a policy the engine doesn't have", () => {
    expect(renderToStaticMarkup(<PolicyMethodology name="magic" />)).toBe("");
  });
});
