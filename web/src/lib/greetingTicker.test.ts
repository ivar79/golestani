import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDomGreetingTickerHost,
  GREETING_TICK_DEDUP_MS,
  GREETING_TICK_INTERVAL_MS,
  startGreetingTicker,
  type GreetingTickerHost,
} from "@/lib/greetingTicker";

/**
 * Fake host + fake timers: exercises the exact visible/hidden/wake/cleanup
 * contract in the node-only vitest environment (no jsdom dependency).
 * Timer tracking lives in the host itself — the same seam the ticker uses —
 * so the count is exact regardless of environment.
 */
function makeFakeHost(visible = true) {
  const listeners = { visibility: [] as Array<() => void>, focus: [] as Array<() => void> };
  let isVisible = visible;
  const live = new Set<NodeJS.Timeout>();
  let maxLive = 0;
  const host: GreetingTickerHost = {
    now: () => Date.now(),
    setTimeout: (handler, timeoutMs) => {
      // Delete from `live` when the timer FIRES (not just when cleared) so
      // the chain's fire→schedule-next cycle doesn't inflate the count.
      const handle = globalThis.setTimeout(() => {
        live.delete(handle);
        handler();
      }, timeoutMs);
      live.add(handle);
      maxLive = Math.max(maxLive, live.size);
      return handle as unknown as number;
    },
    clearTimeout: (handle) => {
      live.delete(handle as unknown as NodeJS.Timeout);
      return globalThis.clearTimeout(handle as unknown as NodeJS.Timeout);
    },
    isDocumentVisible: () => isVisible,
    onVisibilityChange: (h) => listeners.visibility.push(h),
    offVisibilityChange: (h) => {
      listeners.visibility = listeners.visibility.filter((x) => x !== h);
    },
    onFocus: (h) => listeners.focus.push(h),
    offFocus: (h) => {
      listeners.focus = listeners.focus.filter((x) => x !== h);
    },
  };
  return {
    host,
    setVisible(next: boolean) {
      isVisible = next;
      for (const h of [...listeners.visibility]) h();
    },
    fireFocus() {
      for (const h of [...listeners.focus]) h();
    },
    listenerCount: () => listeners.visibility.length + listeners.focus.length,
    get maxLive() {
      return maxLive;
    },
    liveCount: () => live.size,
  };
}

let ticks: number;
let fake: ReturnType<typeof makeFakeHost>;

beforeEach(() => {
  vi.useFakeTimers();
  ticks = 0;
  fake = makeFakeHost(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(onTick: () => void = () => (ticks += 1), host: GreetingTickerHost = fake.host) {
  return startGreetingTicker({ onTick, host });
}

describe("greeting ticker", () => {
  it("ticks once right after start (mount resolution)", () => {
    start();
    expect(ticks).toBe(0); // deferred — not inside the caller's effect body
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(1);
  });

  it("minute-aligned chain ticks while visible", () => {
    start();
    vi.advanceTimersByTime(0); // initial tick
    const before = ticks;
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 2);
    expect(ticks).toBeGreaterThan(before);
    expect(ticks - before).toBe(2); // one per aligned minute, no drift
  });

  it("never ticks while hidden — timer is fully cleared", () => {
    fake.setVisible(false); // hidden BEFORE start
    start();
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(0); // no initial tick in hidden state? — see wake test
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 3);
    expect(ticks).toBe(0);
  });

  it("hidden → visible fires an immediate tick and rebuilds the chain", () => {
    fake.setVisible(false);
    const ticker = start();
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(0);

    fake.setVisible(true); // wake: visibilitychange event
    expect(ticks).toBe(1); // immediate — no waiting for the next interval
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 2);
    expect(ticks).toBe(3); // chain rebuilt: +1 per aligned minute
    ticker.stop();
  });

  it("visible → hidden stops the chain (no background ticks)", () => {
    const ticker = start();
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(1);

    fake.setVisible(false); // wake handler clears the timer
    const before = ticks;
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 3);
    expect(ticks).toBe(before); // nothing fired while hidden
    ticker.stop();
  });

  it("visibilitychange followed immediately by focus yields ONE tick (no double tick)", () => {
    const ticker = start();
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(1);

    fake.setVisible(false);
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 5); // hidden for a while
    fake.setVisible(true); // wake tick #1
    fake.fireFocus(); // focus arrives ms later — must be deduped
    expect(ticks).toBe(2); // exactly one wake tick
    ticker.stop();
  });

  it("focus alone ticks as the light fallback (wake from sleep while visible)", () => {
    const ticker = start();
    vi.advanceTimersByTime(0);
    const before = ticks;
    vi.advanceTimersByTime(GREETING_TICK_DEDUP_MS + 1);
    fake.fireFocus();
    expect(ticks).toBe(before + 1);
    ticker.stop();
  });

  it("at most one pending timer exists at any moment (no parallel intervals)", () => {
    const ticker = start();
    vi.advanceTimersByTime(0);
    fake.setVisible(false);
    fake.setVisible(true);
    fake.fireFocus();
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 3);
    fake.setVisible(false);
    fake.setVisible(true);
    expect(fake.maxLive).toBe(1); // ≤ 1 pending timer across the whole lifecycle
    ticker.stop();
  });

  it("stop() fully cleans up: no ticks and no listeners afterwards", () => {
    const ticker = start();
    vi.advanceTimersByTime(0);
    expect(ticks).toBe(1);
    ticker.stop();

    expect(fake.liveCount()).toBe(0); // no timer left pending
    expect(fake.listenerCount()).toBe(0); // both listeners removed

    const before = ticks;
    fake.setVisible(true); // events after stop must be inert
    fake.fireFocus();
    vi.advanceTimersByTime(GREETING_TICK_INTERVAL_MS * 3);
    expect(ticks).toBe(before); // timer cleared, listeners gone
  });

  it("DOM host wires window/document with real listener lifecycles", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const win = {
      Date,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: (type: string) => added.push(type),
      removeEventListener: (type: string) => removed.push(type),
    } as unknown as Window;
    const doc = {
      visibilityState: "visible",
      addEventListener: (type: string) => added.push(type),
      removeEventListener: (type: string) => removed.push(type),
    } as unknown as Document;

    const ticker = startGreetingTicker({ onTick: () => {}, host: createDomGreetingTickerHost(win, doc) });
    ticker.stop();

    expect(added.sort()).toEqual(["focus", "visibilitychange"]);
    expect(removed.sort()).toEqual(["focus", "visibilitychange"]);
  });
});
