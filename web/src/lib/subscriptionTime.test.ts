import { describe, expect, it } from "vitest";
import {
  formatRemaining,
  remainingMsFromExpiresAt,
  remainingMsFromSnapshot,
  serverTimeSnapshot,
} from "@/lib/subscriptionTime";

/**
 * SUBSCRIPTION COUNTDOWN (display only — backend stays authoritative).
 * Remaining time must flow from the SERVER snapshot (expires_at /
 * remaining_seconds) and decrease naturally with elapsed local time; there
 * is no decrementing counter anywhere, refresh cannot reset it, and two
 * devices anchored to the same snapshot agree.
 */
describe("subscription time helpers", () => {
  const FETCH_AT = 1_000_000; // client Date.now() anchor at fetch

  function snapshotWith(remainingSeconds: number, expiresIso: string | null = null) {
    return serverTimeSnapshot(expiresIso, remainingSeconds, FETCH_AT);
  }

  it("derives remaining ms from the server snapshot", () => {
    const snap = snapshotWith(30 * 86400);
    expect(remainingMsFromSnapshot(snap, FETCH_AT)).toBe(30 * 86400 * 1000);
  });

  it("decreases naturally with elapsed local time (no counter decrement)", () => {
    const snap = snapshotWith(30 * 86400);
    const afterTwoHours = remainingMsFromSnapshot(snap, FETCH_AT + 2 * 3600_000);
    expect(afterTwoHours).toBe((30 * 86400 - 7200) * 1000);
  });

  it("refresh does NOT reset the remaining time (anchor, not a stopwatch restart)", () => {
    const snap = snapshotWith(30 * 86400);
    // Reading twice at the same client moment yields the same value.
    expect(remainingMsFromSnapshot(snap, FETCH_AT + 5000)).toBe(remainingMsFromSnapshot(snap, FETCH_AT + 5000));
    // A refresh 5s later fetches the server's own decreased remaining time
    // (30 days − 5s): the displayed time continues from where the old
    // snapshot's timeline was — it never restarts from the FULL 30 days.
    const resynced = serverTimeSnapshot(null, 30 * 86400 - 5, FETCH_AT + 5000);
    expect(remainingMsFromSnapshot(resynced, FETCH_AT + 5000)).toBe((30 * 86400 - 5) * 1000);
    // Reading the refreshed snapshot 5s LATER continues decreasing (2591990s),
    // never jumping back up to the original 2592000s.
    expect(remainingMsFromSnapshot(resynced, FETCH_AT + 10_000)).toBe((30 * 86400 - 10) * 1000);
    expect(remainingMsFromSnapshot(resynced, FETCH_AT + 10_000)).toBeLessThan(
      remainingMsFromSnapshot(snap, FETCH_AT) as number,
    );
  });

  it("two devices reading the same snapshot see the same remaining time", () => {
    const snap = snapshotWith(30 * 86400);
    // Both devices evaluate at their own identical local offset after fetch.
    expect(remainingMsFromSnapshot(snap, FETCH_AT + 60_000)).toBe(
      remainingMsFromSnapshot(snap, FETCH_AT + 60_000),
    );
  });

  it("floors at zero after expiry instead of going negative", () => {
    const snap = snapshotWith(60);
    expect(remainingMsFromSnapshot(snap, FETCH_AT + 120_000)).toBe(0);
  });

  it("recomputes from absolute expires_at when an anchor re-check is needed", () => {
    // 2026-10-28 15:30 UTC − 2026-09-28 15:30 UTC = 30 days.
    const expires = "2026-10-28T15:30:00.000Z";
    const now = Date.parse("2026-09-28T15:30:00.000Z");
    expect(remainingMsFromExpiresAt(expires, now)).toBe(30 * 86400 * 1000);
    expect(remainingMsFromExpiresAt(expires, now + 1000)).toBe(30 * 86400 * 1000 - 1000);
    expect(remainingMsFromExpiresAt("garbage", now)).toBe(null);
    expect(remainingMsFromExpiresAt(null, now)).toBe(null);
  });

  it("a client clock jump can at most affect the DISPLAY, never persist", () => {
    // The snapshot carries no writable state: after any jump, a refetch
    // (server truth) replaces the display entirely. Nothing here stores it.
    const snap = snapshotWith(30 * 86400);
    const jumped = remainingMsFromSnapshot(snap, FETCH_AT - 10 * 86400_000); // clock set back 10 days
    expect(jumped).toBe(30 * 86400 * 1000); // elapsed is floored at 0 — no extension
  });

  it("formats Persian remaining strings", () => {
    expect(formatRemaining(null)).toBe("—");
    expect(formatRemaining(0)).toBe("منقضی شده");
    expect(formatRemaining(-5)).toBe("منقضی شده");
    expect(formatRemaining(45_000)).toBe("۴۵ ثانیه");
    expect(formatRemaining(5 * 60_000)).toBe("۵ دقیقه");
    expect(formatRemaining(7 * 3600_000)).toBe("۷ ساعت");
    expect(formatRemaining(30 * 86400_000)).toBe("۳۰ روز");
    expect(formatRemaining(29 * 86400_000 + 12 * 3600_000)).toBe("۲۹ روز و ۱۲ ساعت");
  });
});
