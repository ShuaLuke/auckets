// Pure formatting helpers used by presenters. Kept separate so they can be
// unit-tested without a Date subject — the caller passes `now` in.
//
// Timezone policy: every helper that touches calendar/clock formatting takes
// `tz` (IANA name like "America/New_York"). The MVP fixes this to
// America/New_York at the route boundary (Cope's place is Brooklyn, Lincoln
// Theatre is DC — close enough that one TZ keeps copy honest until we add
// per-venue or per-fan TZ in a later slice). The helper itself stays
// TZ-agnostic so the future change is a one-line route edit, not a presenter
// rewrite.

export const DEFAULT_TZ = "America/New_York";

function partsOf(date: Date, tz: string, options: Intl.DateTimeFormatOptions) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    ...options,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return map;
}

/**
 * "Sat · May 25 · 8pm" / "Wed · Jul 2 · 7:30pm" — matches the prototype
 * dateLong shape in design/ui_kits/auckets/screens/Dashboard.jsx +
 * ArtistDashboard.jsx + Show.jsx.
 *
 * The minutes segment is dropped when it's :00 so the common case ("8pm")
 * isn't noisy with ":00".
 */
export function formatDateLong(date: Date, tz: string): string {
  const p = partsOf(date, tz, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const weekday = p.weekday ?? "";
  const month = p.month ?? "";
  const day = p.day ?? "";
  const hour = p.hour ?? "";
  const minute = p.minute ?? "";
  const period = (p.dayPeriod ?? "").toLowerCase();
  const time = minute === "00" ? `${hour}${period}` : `${hour}:${minute}${period}`;
  return `${weekday} · ${month} ${day} · ${time}`;
}

/**
 * "May 25" — the date-stub label on Dashboard / ArtistDashboard rows.
 */
export function formatDateShort(date: Date, tz: string): string {
  const p = partsOf(date, tz, {
    month: "short",
    day: "numeric",
  });
  return `${p.month ?? ""} ${p.day ?? ""}`;
}

/**
 * Bare countdown — "23h 14m" / "12d" / "5m" / "now". Used directly for
 * Show.jsx's binding countdown (wrapped by "Binding allocation runs in …"
 * text in the JSX) and as the building block for formatBindingCountdown.
 *
 * Rounding: use floor on the surviving unit so "23h 59m" doesn't round up
 * to "24h" and surprise a user expecting <1 day.
 */
export function formatCountdown(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "now";

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(diffMs / 3_600_000);
  if (totalHours < 24) {
    const remainderMinutes = totalMinutes - totalHours * 60;
    return remainderMinutes === 0
      ? `${totalHours}h`
      : `${totalHours}h ${remainderMinutes}m`;
  }

  const totalDays = Math.floor(diffMs / 86_400_000);
  return `${totalDays}d`;
}

/**
 * "23h until binding" / "12d until binding" — the closes-row label on the
 * Dashboard + ArtistDashboard when the offer window is open and binding is
 * the next milestone.
 */
export function formatBindingCountdown(target: Date, now: Date): string {
  const bare = formatCountdown(target, now);
  if (bare === "now") return "binding now";
  return `${bare} until binding`;
}
