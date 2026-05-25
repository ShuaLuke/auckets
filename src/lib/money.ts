// Money helpers. Per ADR-0007 / docs/CONVENTIONS.md, money is always
// integer cents — no floats, no strings, no decimal libraries. Convert to
// display strings at the UI boundary using these helpers; convert back
// from user input the same way.

/**
 * Format integer cents as a USD display string.
 *
 * formatCents(0)       -> "$0.00"
 * formatCents(4250)    -> "$42.50"
 * formatCents(-100)    -> "-$1.00"
 * formatCents(1_000_000) -> "$10,000.00"
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents expects integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsStr = remainder.toString().padStart(2, "0");
  return `${sign}$${dollarsStr}.${centsStr}`;
}

/**
 * Parse a USD display string into integer cents.
 *
 * parseDollars("$42.50")   -> 4250
 * parseDollars("42.50")    -> 4250
 * parseDollars("42")       -> 4200
 * parseDollars("$1,234.56")-> 123456
 *
 * Returns null on anything that doesn't parse cleanly so callers can
 * surface a validation error rather than a silent NaN.
 */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const sign = whole?.startsWith("-") ? -1 : 1;
  const wholeAbs = (whole ?? "").replace("-", "");
  const wholeNum = Number.parseInt(wholeAbs, 10);
  const fractionPadded = fraction.padEnd(2, "0").slice(0, 2);
  const fractionNum = Number.parseInt(fractionPadded || "0", 10);
  return sign * (wholeNum * 100 + fractionNum);
}
