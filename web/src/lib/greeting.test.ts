import { describe, expect, it } from "vitest";

import {
  DEFAULT_GREETING_SCHEDULE,
  greetingTextForSlot,
  isValidTimezone,
  minutesInTimezone,
  parseGreetingSchedule,
  parseTimeToMinutes,
  resolveGreetingSlot,
  resolveGreetingText,
  serializeGreetingSchedule,
  validateGreetingSchedule,
  type GreetingSchedule,
} from "@/lib/greeting";

/** Build a Date whose wall-clock time in `tz` is exactly HH:MM. */
function at(tz: string, h: number, m: number): Date {
  // Probe backwards in small steps until Intl reports the wanted wall time.
  // Deterministic and DST-safe without external libraries.
  const target = h * 60 + m;
  let ts = Date.now();
  for (let i = 0; i < 3000; i++) {
    const d = new Date(ts);
    const got = minutesInTimezone(d, tz);
    if (got === target) return d;
    ts -= 60_000; // step back one minute
  }
  throw new Error(`could not construct ${h}:${m} in ${tz}`);
}

const SCHEDULE = DEFAULT_GREETING_SCHEDULE;

describe("parseTimeToMinutes", () => {
  it("parses valid HH:MM", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("05:00")).toBe(300);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("rejects invalid formats", () => {
    expect(parseTimeToMinutes("5:00")).toBeNull();
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("12:60")).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes("12:00:00")).toBeNull();
  });
});

describe("boundary contract: start-INCLUSIVE, end-EXCLUSIVE", () => {
  it("05:00 belongs to morning (start inclusive)", () => {
    const d = at("Asia/Tehran", 5, 0);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("morning");
  });

  it("exactly 10:59 is still morning", () => {
    const d = at("Asia/Tehran", 10, 59);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("morning");
  });

  it("exactly 11:00 selects the SECOND slot (end exclusive)", () => {
    const d = at("Asia/Tehran", 11, 0);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("forenoon");
  });

  it("exactly 16:00 selects the evening slot", () => {
    const d = at("Asia/Tehran", 16, 0);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("evening");
  });

  it("exactly 21:00 selects the night slot", () => {
    const d = at("Asia/Tehran", 21, 0);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("night");
  });

  it("04:59 (before morning start) belongs to the wrapping night slot", () => {
    const d = at("Asia/Tehran", 4, 59);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("night");
  });

  it("exactly 00:00 (midnight) belongs to the night slot", () => {
    const d = at("Asia/Tehran", 0, 0);
    expect(resolveGreetingSlot(minutesInTimezone(d, "Asia/Tehran"), SCHEDULE).id).toBe("night");
  });
});

describe("minutesInTimezone / timezone handling", () => {
  it("resolves Asia/Tehran independent of the local machine clock", () => {
    // 2026-01-01T00:00:00Z → 03:30 in Tehran (+03:30, no DST).
    const utcMidnight = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(minutesInTimezone(utcMidnight, "Asia/Tehran")).toBe(3 * 60 + 30);
  });

  it("same instant resolves differently across timezones", () => {
    const t = Date.UTC(2026, 5, 15, 12, 0, 0);
    const tehran = minutesInTimezone(new Date(t), "Asia/Tehran");
    const utc = minutesInTimezone(new Date(t), "UTC");
    expect(tehran).not.toBe(utc);
  });

  it("isValidTimezone accepts valid IANA ids and rejects garbage", () => {
    expect(isValidTimezone("Asia/Tehran")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("resolveGreetingText uses slot labels and custom messages", () => {
  it("returns the default Persian label", () => {
    const d = at("Asia/Tehran", 8, 0);
    expect(resolveGreetingText(d, SCHEDULE)).toBe("صبح بخیر");
  });

  it("prefers a custom message over the label (future admin texts)", () => {
    const custom: GreetingSchedule = {
      timezone: "Asia/Tehran",
      slots: SCHEDULE.slots.map((s) =>
        s.id === "morning" ? { ...s, message: "سلام بر تو ای صبح!" } : s,
      ),
    };
    const d = at("Asia/Tehran", 8, 0);
    expect(resolveGreetingText(d, custom)).toBe("سلام بر تو ای صبح!");
  });

  it("greetingTextForSlot falls back to label when message is blank", () => {
    expect(greetingTextForSlot({ id: "x", start: "00:00", end: "00:00", label: "شب بخیر", message: "  " })).toBe(
      "شب بخیر",
    );
  });
});

describe("validateGreetingSchedule", () => {
  it("accepts the default schedule", () => {
    expect(validateGreetingSchedule(SCHEDULE)).toBeNull();
  });

  it("rejects overlap", () => {
    const bad: GreetingSchedule = {
      timezone: "Asia/Tehran",
      slots: [
        { id: "a", start: "05:00", end: "12:00", label: "الف", message: null },
        { id: "b", start: "11:00", end: "17:00", label: "ب", message: null },
        { id: "c", start: "17:00", end: "05:00", label: "پ", message: null },
      ],
    };
    expect(validateGreetingSchedule(bad)).toMatch(/هم‌پوشانی/);
  });

  it("rejects gaps", () => {
    // 05:00→10:00 + 11:00→16:00 + 16:00→05:00 leaves the 10:00–11:00 hour
    // uncovered — a genuine gap (total coverage = 23h).
    const bad: GreetingSchedule = {
      timezone: "Asia/Tehran",
      slots: [
        { id: "a", start: "05:00", end: "10:00", label: "الف", message: null },
        { id: "b", start: "11:00", end: "16:00", label: "ب", message: null },
        { id: "c", start: "16:00", end: "05:00", label: "پ", message: null },
      ],
    };
    const problem = validateGreetingSchedule(bad);
    expect(typeof problem).toBe("string");
    expect(problem).toMatch(/فاصله|پوشش/);
  });

  it("rejects incomplete 24h coverage", () => {
    const bad: GreetingSchedule = {
      timezone: "Asia/Tehran",
      slots: [
        { id: "a", start: "05:00", end: "11:00", label: "الف", message: null },
        { id: "b", start: "11:00", end: "16:00", label: "ب", message: null },
      ],
    };
    expect(validateGreetingSchedule(bad)).toMatch(/۲۴ ساعت|نمی‌شود/);
  });

  it("rejects invalid time formats", () => {
    const bad: GreetingSchedule = {
      timezone: "Asia/Tehran",
      slots: [
        { id: "a", start: "5:00", end: "11:00", label: "الف", message: null },
        { id: "b", start: "11:00", end: "05:00", label: "ب", message: null },
      ],
    };
    expect(validateGreetingSchedule(bad)).toMatch(/نامعتبر/);
  });

  it("rejects an empty slot list", () => {
    expect(validateGreetingSchedule({ timezone: "Asia/Tehran", slots: [] })).toMatch(/خالی/);
  });

  it("rejects an invalid IANA timezone such as Asia/Tehram", () => {
    // Classic typo — must be rejected BEFORE it can ever be stored.
    const bad: GreetingSchedule = { ...SCHEDULE, timezone: "Asia/Tehram" };
    expect(validateGreetingSchedule(bad)).toMatch(/IANA/);
    expect(validateGreetingSchedule(bad)).toMatch("Asia/Tehram");
  });

  it("rejects garbage timezone strings", () => {
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "Not/AZone" })).toMatch(/IANA/);
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "tehran" })).toMatch(/IANA/);
  });

  it("accepts valid IANA timezones", () => {
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "Asia/Tehran" })).toBeNull();
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "UTC" })).toBeNull();
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "Europe/London" })).toBeNull();
  });

  it("rejects an empty timezone", () => {
    expect(validateGreetingSchedule({ ...SCHEDULE, timezone: "" })).toMatch(/خالی/);
  });
});

describe("parseGreetingSchedule / serializeGreetingSchedule", () => {
  it("absent setting → default schedule with NO error (legitimate fallback)", () => {
    expect(parseGreetingSchedule(null)).toEqual({ schedule: SCHEDULE, error: null });
    expect(parseGreetingSchedule(undefined)).toEqual({ schedule: SCHEDULE, error: null });
    expect(parseGreetingSchedule("")).toEqual({ schedule: SCHEDULE, error: null });
    expect(parseGreetingSchedule("   ")).toEqual({ schedule: SCHEDULE, error: null });
  });

  it("corrupt JSON → default schedule WITH a configuration error", () => {
    const parsed = parseGreetingSchedule("{not json");
    expect(parsed.schedule).toEqual(SCHEDULE);
    expect(parsed.error).toBeTruthy();
    expect(parsed.error).toMatch(/JSON/);
  });

  it("legacy row without timezone (present slots) → repaired, NO error", () => {
    const raw = JSON.stringify({ slots: SCHEDULE.slots });
    const parsed = parseGreetingSchedule(raw);
    expect(parsed.schedule.timezone).toBe("Asia/Tehran");
    expect(parsed.schedule.slots).toEqual(SCHEDULE.slots);
    expect(parsed.error).toBeNull();
  });

  it("legacy row without slots (present timezone) → repaired, NO error", () => {
    const raw = JSON.stringify({ timezone: "UTC" });
    const parsed = parseGreetingSchedule(raw);
    expect(parsed.schedule.timezone).toBe("UTC");
    expect(parsed.schedule.slots).toEqual(SCHEDULE.slots);
    expect(parsed.error).toBeNull();
  });

  it("present-but-invalid timezone → default schedule WITH an error naming it", () => {
    const raw = JSON.stringify({ timezone: "Asia/Tehram", slots: SCHEDULE.slots });
    const parsed = parseGreetingSchedule(raw);
    expect(parsed.schedule).toEqual(SCHEDULE);
    expect(parsed.error).toBeTruthy();
    expect(parsed.error).toContain("Asia/Tehram");
  });

  it("trims a valid stored timezone", () => {
    const raw = JSON.stringify({ timezone: "  UTC  ", slots: SCHEDULE.slots });
    expect(parseGreetingSchedule(raw).schedule.timezone).toBe("UTC");
  });

  it("round-trips through serialize → parse with no error", () => {
    const json = serializeGreetingSchedule(SCHEDULE);
    expect(parseGreetingSchedule(json)).toEqual({ schedule: SCHEDULE, error: null });
  });

  it("keeps a custom valid timezone", () => {
    const raw = JSON.stringify({ timezone: "UTC", slots: SCHEDULE.slots });
    expect(parseGreetingSchedule(raw).schedule.timezone).toBe("UTC");
  });
});

describe("admin timezone ≠ system timezone", () => {
  // 2026-01-01T01:30:00Z — one instant, three admin timezones, three
  // different slots: Tehran wall time 05:00 (start-inclusive boundary of the
  // morning slot), UTC 01:30 (night, wrapping slot), New York 20:30 of the
  // PREVIOUS day (evening). The resolved greeting must depend ONLY on
  // schedule.timezone, never on the runner's local (system) timezone.
  const frozen = new Date(Date.UTC(2026, 0, 1, 1, 30, 0));

  it("greeting follows the ADMIN timezone, not the runner's local one", () => {
    const tehran = resolveGreetingText(frozen, { ...SCHEDULE, timezone: "Asia/Tehran" });
    const utc = resolveGreetingText(frozen, { ...SCHEDULE, timezone: "UTC" });
    const newYork = resolveGreetingText(frozen, { ...SCHEDULE, timezone: "America/New_York" });

    expect(minutesInTimezone(frozen, "Asia/Tehran")).toBe(5 * 60);
    expect(minutesInTimezone(frozen, "UTC")).toBe(90);
    expect(minutesInTimezone(frozen, "America/New_York")).toBe(20 * 60 + 30); // 20:30 prev day

    expect(tehran).toBe("صبح بخیر");
    expect(utc).toBe("شب بخیر");
    expect(newYork).toBe("عصر بخیر");
    expect(new Set([tehran, utc, newYork]).size).toBe(3); // same instant → 3 different greetings
  });

  it("parse+resolve keep the stored admin timezone end-to-end", () => {
    const raw = serializeGreetingSchedule({ ...SCHEDULE, timezone: "America/New_York" });
    const { schedule } = parseGreetingSchedule(raw);
    expect(schedule.timezone).toBe("America/New_York");
    expect(resolveGreetingText(frozen, schedule)).toBe("عصر بخیر");
  });
});
