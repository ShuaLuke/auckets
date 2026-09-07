/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { parsePolicy, singleSeatRowCount } from "./policy";
import { row, venue } from "./test-helpers";

const v = venue([row({ id: "a", rank: 1, cap: 8, tier: "premium" }), row({ id: "s1", rank: 2, cap: 1, tier: "rear" }), row({ id: "s2", rank: 3, cap: 1, tier: "rear" })]);

describe("parsePolicy", () => {
  it("maps names to engine config and flags what each trades away", () => {
    expect(parsePolicy("greedy", v)).toMatchObject({ config: {}, rankFirst: true });
    expect(parsePolicy("clean-fit", v)).toMatchObject({ config: { fitPolicy: "clean_fit" }, rankFirst: true });
    expect(parsePolicy("parity-tiebreak", v)).toMatchObject({ config: { parityTiebreak: true }, rankFirst: true });
    expect(parsePolicy("singles-reserve", v)).toMatchObject({ config: { singlesReserve: 2 }, rankFirst: false });
    expect(parsePolicy("singles-reserve:5", v).config.singlesReserve).toBe(5);
    const combo = parsePolicy("clean-fit+singles-reserve:1", v);
    expect(combo.config).toEqual({ fitPolicy: "clean_fit", singlesReserve: 1 });
    expect(combo.caveat).toMatch(/Clean-fit defers/);
    expect(combo.caveat).toMatch(/NOT rank-first/);
    expect(() => parsePolicy("lookahead", v)).toThrow(/unknown policy/);
    expect(singleSeatRowCount(v)).toBe(2);
  });
});
