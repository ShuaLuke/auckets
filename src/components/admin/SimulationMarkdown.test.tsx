// The report renderer must handle every construct report.ts emits. Rendered
// to static markup — the app has no DOM testing library and doesn't need one
// for a pure renderer.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationMarkdown } from "./SimulationMarkdown";

const md = [
  "# Fill report — demo",
  "",
  "Venue **Cope's place** (`copes-place`) · policies greedy",
  "",
  "## FILL REPORT — policy `greedy`",
  "",
  "> Shipped behaviour: strict rank order.",
  "",
  "| Metric | p50 | p5 | p95 |",
  "|---|---:|---:|---:|",
  "| Seats filled | 47 | 46 | 48 |",
  "| &nbsp;&nbsp;1-seat holes | 0 | 0 | 1 |",
  "",
  "- seed 1 · contiguity: fine",
  "",
  "---",
  "",
  "`sweep.csv` has every metric, with p50 <sub>p5–p95</sub>.",
].join("\n");

describe("SimulationMarkdown", () => {
  it("renders headings, tables, quotes, lists, rules and inline marks", () => {
    const html = renderToStaticMarkup(<SimulationMarkdown md={md} />);
    expect(html).toContain("Fill report — demo");
    expect(html).toContain("<strong>Cope&#x27;s place</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("copes-place");
    expect(html).toContain("<blockquote");
    expect(html).toContain("Shipped behaviour: strict rank order.");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect((html.match(/<tr>/g) ?? []).length).toBe(3); // header + 2 rows
    expect(html).toContain(">48<");
    expect(html).toContain("1-seat holes");
    expect(html).not.toContain("&nbsp;&nbsp;1-seat");
    expect(html).toContain("<li>seed 1 · contiguity: fine</li>");
    expect(html).toContain("<hr");
    expect(html).toContain("has every metric, with p50 (p5–p95).");
    expect(html).not.toContain("<sub>");
  });
});
