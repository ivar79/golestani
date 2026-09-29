/**
 * Smart Greeting engine — pure helpers, no React, safe to unit-test.
 *
 * A greeting schedule is stored in the `site_settings` table under the key
 * `dashboard.greeting.schedule` as JSON:
 *
 * {
 *   "timezone": "Asia/Tehran",
 *   "slots": [
 *     { "id": "morning",    "start": "05:00", "end": "11:00", "label": "صبح بخیر",    "message": null },
 *     { "id": "forenoon",   "start": "11:00", "end": "16:00", "label": "ظهر بخیر", "message": null },
 *     { "id": "evening",    "start": "16:00", "end": "21:00", "label": "عصر بخیر",    "message": null },
 *     { "id": "night",      "start": "21:00", "end": "05:00", "label": "شب بخیر",     "message": null }
 *   ]
 * }
 *
 * Contract (tested):
 *  - Boundaries are start-INCLUSIVE, end-EXCLUSIVE: 05:00 ≤ t < 11:00 selects
 *    the morning slot; exactly 11:00 selects the next slot.
 *  - The last slot may wrap past midnight (end < start).
 *  - Valid schedules must cover all 24 hours with no overlap and no gap.
 *  - `message` is reserved for future admin-editable greeting texts; the
 *    engine already prefers it over `label` when present, but the current
 *    product ships with `message: null` so labels are used.
 */

export const GREETING_SCHEDULE_KEY = "dashboard.greeting.schedule";

export type GreetingSlot = {
  /** Stable identifier (e.g. "morning") used for keys and admin editing. */
  id: string;
  /** "HH:MM" (24h). Inclusive start. */
  start: string;
  /** "HH:MM" (24h). Exclusive end; may be ≤ start to wrap past midnight. */
  end: string;
  /** Human-readable Persian greeting shown when no custom message is set. */
  label: string;
  /** Reserved for future admin-editable texts; null → use `label`. */
  message: string | null;
};

export type GreetingSchedule = {
  /** IANA timezone the schedule is evaluated in. Default: Asia/Tehran. */
  timezone: string;
  slots: GreetingSlot[];
};

/** Product defaults — Persian greeting labels with full 24h coverage. */
export const DEFAULT_GREETING_SCHEDULE: GreetingSchedule = {
  timezone: "Asia/Tehran",
  slots: [
    { id: "morning", start: "05:00", end: "11:00", label: "صبح بخیر", message: null },
    { id: "forenoon", start: "11:00", end: "16:00", label: "ظهر بخیر", message: null },
    { id: "evening", start: "16:00", end: "21:00", label: "عصر بخیر", message: null },
    { id: "night", start: "21:00", end: "05:00", label: "شب بخیر", message: null },
  ],
};

/** "HH:MM" → minutes since midnight. Returns null for invalid formats. */
export function parseTimeToMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const h = Number(value.slice(0, 2));
  const m = Number(value.slice(3, 5));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Validate one slot shape. Returns a Persian error message or null.
 * Labels must be non-empty (they ARE the product greeting text for now).
 */
export function validateSlot(slot: GreetingSlot): string | null {
  if (!slot.id || !/^[a-z0-9_-]+$/.test(slot.id)) return "شناسه بازه نامعتبر است.";
  if (parseTimeToMinutes(slot.start) === null) return `ساعت شروع بازه ${slot.id} نامعتبر است (HH:MM).`;
  if (parseTimeToMinutes(slot.end) === null) return `ساعت پایان بازه ${slot.id} نامعتبر است (HH:MM).`;
  if (!slot.label.trim()) return `متن greeting بازه ${slot.id} خالی است.`;
  return null;
}

/**
 * Validate a full schedule:
 *  - every slot is well-formed,
 *  - no overlaps, no gaps, complete 24h coverage,
 *  - timezone is a real, resolvable IANA identifier (checked via Intl).
 * Returns a Persian error message or null when valid.
 */
export function validateGreetingSchedule(schedule: GreetingSchedule): string | null {
  if (!schedule || !Array.isArray(schedule.slots) || schedule.slots.length === 0) {
    return "برنامه greeting خالی است.";
  }
  if (!schedule.timezone || typeof schedule.timezone !== "string" || !schedule.timezone.trim()) {
    return "تایم‌زون نمی‌تواند خالی باشد (مثال درست: Asia/Tehran).";
  }
  if (!isValidTimezone(schedule.timezone.trim())) {
    return `تایم‌زون «${schedule.timezone.trim()}» یک شناسه IANA معتبر نیست (مثال درست: Asia/Tehran).`;
  }

  // Normalize each slot to [startMin, endMin) where endMin may exceed 1440
  // for midnight-wrapping slots (e.g. 21:00→05:00 becomes 1260→1740).
  const ranges: { id: string; from: number; to: number }[] = [];
  for (const slot of schedule.slots) {
    const shapeError = validateSlot(slot);
    if (shapeError) return shapeError;
    const from = parseTimeToMinutes(slot.start) as number;
    let to = parseTimeToMinutes(slot.end) as number;
    if (to <= from) to += 1440; // wraps past midnight
    if (to - from < 1) return `بازه ${slot.id} طول صفر دارد.`;
    ranges.push({ id: slot.id, from, to });
  }

  // Sort by start; require exact chaining (next.from === prev.to) so there
  // is neither overlap (next.from < prev.to) nor gap (next.from > prev.to).
  ranges.sort((a, b) => a.from - b.from);
  const first = ranges[0];
  const last = ranges[ranges.length - 1];

  // Full 24h coverage ⇒ the chain must wrap exactly once: the last slot's
  // (possibly shifted) end lands on first.from + 1440.
  const total = ranges.reduce((acc, r) => acc + (r.to - r.from), 0);
  if (total !== 1440) {
    return "بازه‌ها باید دقیقاً ۲۴ ساعت را پوشش دهند (بدون هم‌پوشانی و فاصله).";
  }

  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from < ranges[i - 1].to) {
      return `بازه‌های ${ranges[i - 1].id} و ${ranges[i].id} هم‌پوشانی دارند.`;
    }
    if (ranges[i].from > ranges[i - 1].to) {
      return `بین بازه‌های ${ranges[i - 1].id} و ${ranges[i].id} فاصله وجود دارد.`;
    }
  }

  // The wrap check: last end (+1440 if needed) must equal first start + 1440.
  const lastEnd = last.to > 1440 ? last.to : last.to + 1440;
  if (lastEnd !== first.from + 1440) {
    return "زنجیره بازه‌ها حول نیمه‌شب کامل نمی‌شود.";
  }

  return null;
}

/**
 * Minutes since midnight in the given IANA timezone for a JS Date.
 * Uses Intl parts so no timezone math is hard-coded anywhere.
 */
export function minutesInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

/** True when the IANA timezone identifier is supported by this runtime. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the greeting slot for `minutesSinceMidnight` under the schedule.
 * Start-inclusive / end-exclusive. Falls back to the last slot that starts
 * at-or-before the time when the schedule is technically unaligned (defensive
 * only — validated schedules always select exactly one slot).
 */
export function resolveGreetingSlot(
  minutesSinceMidnight: number,
  schedule: GreetingSchedule = DEFAULT_GREETING_SCHEDULE,
): GreetingSlot {
  const slots = schedule.slots;
  const t = ((minutesSinceMidnight % 1440) + 1440) % 1440;

  let best: GreetingSlot | null = null;
  let bestStart = -1;
  for (const slot of slots) {
    const from = parseTimeToMinutes(slot.start) ?? 0;
    let to = parseTimeToMinutes(slot.end) ?? 0;
    if (to <= from) to += 1440;

    // Normalized window that may wrap: [from, to) possibly crossing 1440.
    if (to <= 1440) {
      // Simple window inside the day.
      if (t >= from && t < to) return slot;
      // If time is before this window, remember it as a fallback candidate.
      if (t < from && from > bestStart) {
        best = slot;
        bestStart = from;
      }
    } else {
      // Wrapping window: t >= from (evening side) OR t < to - 1440 (past midnight side).
      if (t >= from || t < to - 1440) return slot;
    }
  }

  if (best) return best;
  return slots[slots.length - 1];
}

/** The greeting text for a slot: custom message wins over the default label. */
export function greetingTextForSlot(slot: GreetingSlot): string {
  const message = slot.message?.trim();
  return message || slot.label;
}

/**
 * One-shot convenience: resolve the greeting text for `date` under `schedule`.
 */
export function resolveGreetingText(date: Date, schedule: GreetingSchedule): string {
  return greetingTextForSlot(resolveGreetingSlot(minutesInTimezone(date, schedule.timezone), schedule));
}

/**
 * Result of parsing the raw SiteSetting value.
 *
 * `schedule` is ALWAYS usable (missing/legacy data is repaired against the
 * defaults) so callers never crash on a bad value. `error` distinguishes the
 * two repair reasons:
 *  - null → legitimate fallback: the setting is simply absent/empty (nothing
 *    stored yet) or legacy data missing optional fields (e.g. no timezone).
 *  - non-null → the stored configuration itself is INVALID (corrupt JSON, an
 *    invalid IANA timezone, or malformed slots). Dashboards should warn/log
 *    and run on the repaired default; the admin panel must surface the error
 *    so the configuration can be fixed, not silently swallowed.
 */
export type ParsedGreetingSchedule = {
  schedule: GreetingSchedule;
  error: string | null;
};

/**
 * Parse the raw SiteSetting value into a schedule.
 * Accepts partial values (e.g. only slots or only timezone) and repairs them
 * against the defaults. Never throws — corrupt values yield the default
 * schedule plus a descriptive error (see ParsedGreetingSchedule).
 */
export function parseGreetingSchedule(raw: string | null | undefined): ParsedGreetingSchedule {
  if (!raw || !raw.trim()) return { schedule: DEFAULT_GREETING_SCHEDULE, error: null };

  let parsed: Partial<GreetingSchedule>;
  try {
    parsed = JSON.parse(raw) as Partial<GreetingSchedule>;
  } catch {
    return {
      schedule: DEFAULT_GREETING_SCHEDULE,
      error: "مقدار ذخیره‌شدهٔ greeting، JSON معتبر نیست.",
    };
  }

  const hasSlots = Array.isArray(parsed.slots) && parsed.slots.length > 0;
  // Absent timezone/slots = legacy row written by an older version — repair
  // silently. A PRESENT-but-invalid timezone is a configuration error.
  const hasTimezone = parsed.timezone !== undefined && parsed.timezone !== null;

  if (hasTimezone && (typeof parsed.timezone !== "string" || !isValidTimezone(parsed.timezone.trim()))) {
    return {
      schedule: DEFAULT_GREETING_SCHEDULE,
      error: `تایم‌زون ذخیره‌شده «${String(parsed.timezone)}» یک شناسه IANA معتبر نیست.`,
    };
  }

  const slots = hasSlots ? (parsed.slots as GreetingSlot[]) : DEFAULT_GREETING_SCHEDULE.slots;
  const timezone =
    typeof parsed.timezone === "string" && isValidTimezone(parsed.timezone.trim())
      ? parsed.timezone.trim()
      : DEFAULT_GREETING_SCHEDULE.timezone;
  return { schedule: { timezone, slots }, error: null };
}

/** Serialize a schedule for storage in site_settings.value. */
export function serializeGreetingSchedule(schedule: GreetingSchedule): string {
  return JSON.stringify(schedule);
}
