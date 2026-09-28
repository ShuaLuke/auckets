/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { BASE_METHOD, methodologyFor, POLICY_PARTS } from "./methodology";
import { parsePolicy } from "./policy";
import { row, venue } from "./test-helpers";

const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium" })]);

describe("methodology", () => {
  it("has a part for every policy the engine parses, and nothing the engine doesn't", () => {
    for (const key of Object.keys(POLICY_PARTS)) expect(() => parsePolicy(key, v)).not.toThrow();
    expect(() => methodologyFor("nope")).toThrow(/no methodology for policy part "nope"/);
  });

  it("composes combined policies in order and carries rank-first honestly", () => {
    const m = methodologyFor("clean-fit+singles-reserve");
    expect(m.parts.map((p) => p.key)).toEqual(["clean-fit", "singles-reserve"]);
    expect(m.rankFirst).toBe(false);
    expect(methodologyFor("greedy").rankFirst).toBe(true);
    expect(methodologyFor("parity-tiebreak").rankFirst).toBe(true);
    // Parameterised parts resolve to their base part.
    expect(methodologyFor("lookahead:3").parts[0]!.key).toBe("lookahead");
    expect(methodologyFor("singles-reserve:5").parts[0]!.key).toBe("singles-reserve");
  });

  it("agrees with policy.ts about which parts are rank-first", () => {
    for (const key of Object.keys(POLICY_PARTS)) expect(methodologyFor(key).rankFirst, key).toBe(parsePolicy(key, v).rankFirst);
  });

  it("reads as full sentences", () => {
    const sentences = [...BASE_METHOD.steps, ...Object.values(POLICY_PARTS).flatMap((p) => [p.summary, ...p.steps, p.tradeoff])];
    for (const s of sentences) expect(s, s).toMatch(/[.)]$/);
  });
});
