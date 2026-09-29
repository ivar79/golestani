/**
 * Greeting ticker — event-driven + periodic wall-clock refresh, no React.
 *
 * Replaces the old bare `setInterval(60s)` in DashboardOverview, which kept
 * firing while the tab was hidden (so a laptop waking from sleep showed a
 * stale greeting until the next fire) and could drift far from slot
 * boundaries (05:00/11:00/16:00/21:00).
 *
 * Contract (tested):
 *  - One immediate tick right after start (deferred via setTimeout(0) so
 *    callers may call setState from the callback without tripping the
 *    react-hooks set-state-in-effect rule).
 *  - The periodic chain is MINUTE-ALIGNED (fires just after each :00) so the
 *    greeting goes stale for well under a second after a slot boundary —
 *    the ticker itself stays schedule-agnostic (no 05/11/16/21 knowledge).
 *  - The chain only runs while the document is visible: hidden ⇒ timer fully
 *    cleared; visible again ⇒ immediate tick (never wait for the next
 *    interval after sleep/background) and the chain is rebuilt.
 *  - visibilitychange and focus are deduped: a focus event arriving right
 *    after visibilitychange never produces a second redundant tick.
 *  - At most ONE pending timer exists at any moment.
 *  - stop() removes both listeners and clears every timer.
 *
 * The DOM access lives behind GreetingTickerHost so behavior is testable in
 * the node-only vitest environment with a fake host (no jsdom dependency).
 */

export const GREETING_TICK_INTERVAL_MS = 60_000;
/** Event ticks closer together than this count as one wake. */
export const GREETING_TICK_DEDUP_MS = 1_000;
/** Land just AFTER the minute boundary so `new Date()` reads the new minute. */
const MINUTE_ALIGN_BUFFER_MS = 150;

export type GreetingTickerHost = {
  now(): number;
  setTimeout(handler: () => void, timeoutMs: number): number;
  clearTimeout(handle: number): void;
  isDocumentVisible(): boolean;
  onVisibilityChange(handler: () => void): void;
  offVisibilityChange(handler: () => void): void;
  onFocus(handler: () => void): void;
  offFocus(handler: () => void): void;
};

export type GreetingTicker = {
  stop(): void;
};

export function startGreetingTicker(options: {
  onTick: () => void;
  host: GreetingTickerHost;
  /** Fire on minute boundaries (default) instead of a raw drifting 60s. */
  minuteAlign?: boolean;
}): GreetingTicker {
  const { onTick, host, minuteAlign = true } = options;

  let stopped = false;
  let timer: number | null = null;
  let lastTickAt = -Infinity;

  function doTick() {
    lastTickAt = host.now();
    onTick();
  }

  function clearTimer() {
    if (timer !== null) {
      host.clearTimeout(timer);
      timer = null;
    }
  }

  /** (Re)arm the periodic chain — visible-only, always ≤ 1 pending timer. */
  function scheduleTimer() {
    clearTimer();
    if (stopped || !host.isDocumentVisible()) return;
    const delay = minuteAlign
      ? GREETING_TICK_INTERVAL_MS - (host.now() % GREETING_TICK_INTERVAL_MS) + MINUTE_ALIGN_BUFFER_MS
      : GREETING_TICK_INTERVAL_MS;
    timer = host.setTimeout(() => {
      timer = null;
      doTick();
      scheduleTimer();
    }, delay);
  }

  /**
   * Wake path shared by visibilitychange and focus. While hidden it only
   * makes sure no timer survives; while visible it ticks (deduped) and
   * rebuilds the chain.
   */
  function wake() {
    if (stopped) return;
    if (!host.isDocumentVisible()) {
      clearTimer();
      return;
    }
    if (host.now() - lastTickAt < GREETING_TICK_DEDUP_MS) {
      scheduleTimer(); // already ticked — just make sure the chain is armed
      return;
    }
    doTick();
    scheduleTimer();
  }

  // Deferred initial tick keeps setState out of the caller's effect body and
  // still resolves the greeting within the first paint frame. Visibility-aware:
  // a tab opened in the background stays on the placeholder until it is
  // actually seen — the wake handler resolves it on visible.
  const initial = host.setTimeout(() => {
    if (!host.isDocumentVisible()) return;
    doTick();
    scheduleTimer();
  }, 0);

  host.onVisibilityChange(wake);
  host.onFocus(wake);

  return {
    stop() {
      stopped = true;
      clearTimer();
      host.clearTimeout(initial);
      host.offVisibilityChange(wake);
      host.offFocus(wake);
    },
  };
}

/** Real-browser host binding (window + document listeners). */
export function createDomGreetingTickerHost(win: Window, doc: Document): GreetingTickerHost {
  return {
    now: () => Date.now(),
    setTimeout: (handler, timeoutMs) => win.setTimeout(handler, timeoutMs),
    clearTimeout: (handle) => win.clearTimeout(handle),
    isDocumentVisible: () => doc.visibilityState === "visible",
    onVisibilityChange: (handler) => doc.addEventListener("visibilitychange", handler),
    offVisibilityChange: (handler) => doc.removeEventListener("visibilitychange", handler),
    onFocus: (handler) => win.addEventListener("focus", handler),
    offFocus: (handler) => win.removeEventListener("focus", handler),
  };
}
