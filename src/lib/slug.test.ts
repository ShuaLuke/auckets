/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { slugify } from "./slug";

const SLUG_RE = /^[a-z0-9-]+$/;

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Citizen Cope")).toBe("citizen-cope");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(slugify("The  Roots — Live!")).toBe("the-roots-live");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("  ¡Hola! ")).toBe("hola");
  });

  it("keeps digits", () => {
    expect(slugify("Blink 182")).toBe("blink-182");
  });

  it("returns an empty string when nothing alphanumeric survives", () => {
    expect(slugify("—!!—")).toBe("");
  });

  it("always produces output matching the route's slug regex (when non-empty)", () => {
    for (const name of ["Sigur Rós", "AC/DC", "Tyler, the Creator"]) {
      const slug = slugify(name);
      expect(slug.length).toBeGreaterThan(0);
      expect(SLUG_RE.test(slug)).toBe(true);
    }
  });
});
