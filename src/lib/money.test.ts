import { describe, expect, it } from "vitest";

import { formatCents, parseDollars } from "./money";

describe("formatCents", () => {
  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats simple amounts", () => {
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(4250)).toBe("$42.50");
    expect(formatCents(99)).toBe("$0.99");
  });

  it("inserts thousands separators", () => {
    expect(formatCents(100_000)).toBe("$1,000.00");
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });

  it("handles negatives", () => {
    expect(formatCents(-100)).toBe("-$1.00");
    expect(formatCents(-50)).toBe("-$0.50");
  });

  it("rejects non-integer input", () => {
    expect(() => formatCents(1.5)).toThrow(/integer cents/);
  });
});

describe("parseDollars", () => {
  it("parses plain numbers", () => {
    expect(parseDollars("42")).toBe(4200);
    expect(parseDollars("42.5")).toBe(4250);
    expect(parseDollars("42.50")).toBe(4250);
  });

  it("strips dollar signs and commas", () => {
    expect(parseDollars("$42.50")).toBe(4250);
    expect(parseDollars("$1,234.56")).toBe(123456);
    expect(parseDollars("  $5 ")).toBe(500);
  });

  it("handles zero and negatives", () => {
    expect(parseDollars("0")).toBe(0);
    expect(parseDollars("-1.50")).toBe(-150);
  });

  it("returns null on garbage", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.234")).toBeNull(); // too many decimals
    expect(parseDollars("1.2.3")).toBeNull();
  });

  it("round-trips with formatCents for representable values", () => {
    for (const cents of [0, 1, 99, 100, 4250, 123456, -50]) {
      const formatted = formatCents(cents);
      expect(parseDollars(formatted)).toBe(cents);
    }
  });
});
