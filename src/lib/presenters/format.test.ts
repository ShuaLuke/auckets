import { describe, expect, it } from "vitest";

import {
  DEFAULT_TZ,
  formatBindingCountdown,
  formatClock,
  formatCountdown,
  formatDateLong,
  formatDateShort,
  formatWeekday,
  isToday,
} from "./format";

// All "live" prototype shapes assume America/New_York. The tests pin that
// explicitly so a future per-venue TZ change can't silently regress them.

describe("formatDateLong", () => {
  it("renders the prototype's 'Sat · May 25 · 8pm' shape (whole-hour)", () => {
    // 2026-05-23 is a Saturday in America/New_York; 8:00 PM EDT.
    const date = new Date("2026-05-23T20:00:00-04:00");
    expect(formatDateLong(date, DEFAULT_TZ)).toBe("Sat · May 23 · 8pm");
  });

  it("renders the prototype's 'Wed · Jul 2 · 7:30pm' shape (half-hour shows ':30')", () => {
    // 2026-07-01 is a Wednesday in America/New_York; 7:30 PM EDT.
    const date = new Date("2026-07-01T19:30:00-04:00");
    expect(formatDateLong(date, DEFAULT_TZ)).toBe("Wed · Jul 1 · 7:30pm");
  });

  it("handles a 9pm whole-hour without trailing ':00'", () => {
    // 2026-06-13 is a Saturday in America/New_York; 9:00 PM EDT.
    const date = new Date("2026-06-13T21:00:00-04:00");
    expect(formatDateLong(date, DEFAULT_TZ)).toBe("Sat · Jun 13 · 9pm");
  });

  it("converts UTC to the supplied tz, not the system tz", () => {
    // 2026-05-24T00:00:00Z is May 23 8pm in America/New_York and May 24 1am
    // in Europe/London. The same Date should render differently across TZs.
    const date = new Date("2026-05-24T00:00:00Z");
    expect(formatDateLong(date, "America/New_York")).toBe(
      "Sat · May 23 · 8pm",
    );
    expect(formatDateLong(date, "Europe/London")).toBe("Sun · May 24 · 1am");
  });
});

describe("formatDateShort", () => {
  it("renders the prototype's 'May 25' shape", () => {
    const date = new Date("2026-05-23T20:00:00-04:00");
    expect(formatDateShort(date, DEFAULT_TZ)).toBe("May 23");
  });

  it("renders the prototype's 'Jul 2' shape (single-digit day)", () => {
    const date = new Date("2026-07-01T19:30:00-04:00");
    expect(formatDateShort(date, DEFAULT_TZ)).toBe("Jul 1");
  });

  it("respects the supplied tz at day boundary", () => {
    // 2026-05-24T03:00:00Z is May 23 11pm in NY, May 24 4am in London.
    const date = new Date("2026-05-24T03:00:00Z");
    expect(formatDateShort(date, "America/New_York")).toBe("May 23");
    expect(formatDateShort(date, "Europe/London")).toBe("May 24");
  });
});

describe("formatCountdown", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("returns 'now' when the target is already past", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(formatCountdown(past, now)).toBe("now");
  });

  it("returns 'now' for exactly-now", () => {
    expect(formatCountdown(now, now)).toBe("now");
  });

  it("returns minutes when <1h away", () => {
    const target = new Date(now.getTime() + 5 * 60_000);
    expect(formatCountdown(target, now)).toBe("5m");
  });

  it("returns 'Xh Ym' when hours and minutes both apply (matches '4h 12m')", () => {
    const target = new Date(now.getTime() + (4 * 60 + 12) * 60_000);
    expect(formatCountdown(target, now)).toBe("4h 12m");
  });

  it("returns bare 'Xh' when minutes are zero (matches '23h')", () => {
    const target = new Date(now.getTime() + 23 * 3_600_000);
    expect(formatCountdown(target, now)).toBe("23h");
  });

  it("returns 'Xh Ym' for 23h 14m (matches Show.jsx binding example)", () => {
    const target = new Date(now.getTime() + (23 * 3600 + 14 * 60) * 1000);
    expect(formatCountdown(target, now)).toBe("23h 14m");
  });

  it("returns days when >=24h away (matches '12d', '23d')", () => {
    expect(
      formatCountdown(new Date(now.getTime() + 12 * 86_400_000), now),
    ).toBe("12d");
    expect(
      formatCountdown(new Date(now.getTime() + 23 * 86_400_000), now),
    ).toBe("23d");
  });

  it("floors days rather than rounding up so '11d 23h' stays '11d'", () => {
    const target = new Date(now.getTime() + (11 * 86_400 + 23 * 3600) * 1000);
    expect(formatCountdown(target, now)).toBe("11d");
  });

  it("floors the minute when hours round down (e.g. 23h 59m stays '23h 59m', not '24h')", () => {
    const target = new Date(now.getTime() + (23 * 3600 + 59 * 60) * 1000);
    expect(formatCountdown(target, now)).toBe("23h 59m");
  });
});

describe("formatBindingCountdown", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("appends 'until binding' to the bare countdown (matches ArtistDashboard '23h until binding')", () => {
    const target = new Date(now.getTime() + 23 * 3_600_000);
    expect(formatBindingCountdown(target, now)).toBe("23h until binding");
  });

  it("works for day-scale countdowns (matches '12d until binding')", () => {
    const target = new Date(now.getTime() + 12 * 86_400_000);
    expect(formatBindingCountdown(target, now)).toBe("12d until binding");
  });

  it("collapses to 'binding now' when target is past — the GAE should already be running", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(formatBindingCountdown(past, now)).toBe("binding now");
  });
});

describe("formatClock", () => {
  it("keeps minutes even on the whole hour (NowHero 'Doors 8:00pm')", () => {
    expect(formatClock(new Date("2026-06-13T20:00:00-04:00"), DEFAULT_TZ)).toBe(
      "8:00pm",
    );
  });
  it("renders half-hours", () => {
    expect(formatClock(new Date("2026-07-02T19:30:00-04:00"), DEFAULT_TZ)).toBe(
      "7:30pm",
    );
  });
});

describe("formatWeekday", () => {
  it("renders the short weekday in the venue tz", () => {
    expect(formatWeekday(new Date("2026-06-13T21:00:00-04:00"), DEFAULT_TZ)).toBe(
      "Sat",
    );
  });
});

describe("isToday", () => {
  const tz = DEFAULT_TZ;
  it("true when doors and now share the calendar day in tz", () => {
    const now = new Date("2026-06-13T18:00:00-04:00");
    const doors = new Date("2026-06-13T21:00:00-04:00");
    expect(isToday(doors, now, tz)).toBe(true);
  });
  it("false across a day boundary even within 24h", () => {
    const now = new Date("2026-06-13T23:00:00-04:00");
    const doors = new Date("2026-06-14T20:00:00-04:00"); // ~21h later, next day
    expect(isToday(doors, now, tz)).toBe(false);
  });
  it("respects the tz, not the host/UTC day", () => {
    // 2026-06-14T02:00Z is still Jun 13, 10pm in New York.
    const now = new Date("2026-06-13T21:00:00-04:00");
    const doors = new Date("2026-06-14T02:00:00Z");
    expect(isToday(doors, now, tz)).toBe(true);
  });
});
