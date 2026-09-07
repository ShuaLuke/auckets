// Number formatting for reports. Dollars appear only in renderers —
// everything upstream is integer cents.

export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function pct(rate: number, digits = 1): string {
  return `${(100 * rate).toFixed(digits)}%`;
}

export const n = (v: number): string => Math.round(v).toLocaleString("en-US");
