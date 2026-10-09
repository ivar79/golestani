/**
 * fetch() with a hard deadline and cooperative cancellation.
 *
 * Why this exists (measured 2026-10-09): the studio's raw `fetch` calls had NO
 * timeout, so a saturated API left them hanging for 36–42s while the rest of
 * the page used axios' 15s ceiling. A panel that hangs that long shows nothing
 * actionable, and unmounting the panel did not cancel the request.
 *
 * Contract:
 *   - the deadline fires → TimeoutError (an actionable, user-facing failure);
 *   - the caller's signal fires (unmount / dependency change) → AbortError is
 *     re-thrown untouched, so callers can stay SILENT instead of showing an
 *     error for a request the user never saw finish;
 *   - the timeout is always cleared, so no timer outlives the request.
 */

/** Default deadline for panel/read fetches: matches the axios client ceiling. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;

/** The server did not answer inside the deadline (NOT a user cancel). */
export class TimeoutError extends Error {
  constructor(message = "درخواست در زمان مجاز پاسخ نداد.") {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Is this the timeout we raised (vs. an AbortError from the caller's signal)? */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof Error && error.name === "TimeoutError";
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal;
  let timedOut = false;

  // Forward an external abort (unmount) into this controller, and remember
  // whether the caller's signal was already aborted before we started.
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // A deadline abort is a real failure the UI should explain; a caller abort
    // is not. Node/undici and browsers both surface AbortError here.
    if (timedOut && !(external?.aborted ?? false)) {
      throw new TimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}
