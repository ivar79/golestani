/**
 * gps.ts — Browser geolocation acquisition, decoupled from the hardware.
 *
 * The browser's Geolocation API IS the abstraction: this module never touches
 * GPS hardware directly, only the `navigator.geolocation` contract. That makes
 * the whole acquisition path testable by injecting a fake API — see
 * `web/tests/gps.test.cjs` — which is how GPS behaviour is verified on a
 * machine with no GPS receiver (DevTools Sensors / mocks, not hardware).
 *
 * Best-fix strategy: a short `watchPosition` session collects fixes and keeps
 * the most accurate one. A device's first fix is frequently a coarse
 * network/Wi-Fi one (hundreds of metres) while a precise GPS fix arrives a
 * moment later; accepting the first fix blindly would pin the user to a bad
 * spot. We therefore:
 *   - keep the most accurate fix seen (lower metres = better),
 *   - resolve as soon as a fix is "good enough" (<= goodAccuracyM), so a
 *     precise device never waits out the whole budget,
 *   - otherwise resolve with the best fix collected when the budget expires,
 *   - always stop the watch (clearWatch) on settle / abort / error.
 *
 * Errors are classified into a small set so callers can present the right UX
 * (permission denied vs. service unavailable vs. timeout).
 */

export type GpsPoint = {
  latitude: number;
  longitude: number;
  /** Accuracy in metres, null when the browser did not report it. */
  accuracy: number | null;
};

export type GpsErrorCode =
  /** navigator.geolocation is missing entirely. */
  | "unavailable_api"
  /** The user (or browser policy) denied the permission. */
  | "permission_denied"
  /** The device's location service is unavailable. */
  | "unavailable"
  /** No usable fix arrived within the time budget. */
  | "timeout"
  /** The caller aborted the request (unmount / superseded request). */
  | "aborted";

export class GpsError extends Error {
  readonly code: GpsErrorCode;
  constructor(code: GpsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GpsError";
    this.code = code;
  }
}

/** Minimal slice of the browser Geolocation API we depend on (mockable). */
export type GeolocationLike = {
  watchPosition(
    success: (pos: GeolocationPositionLike) => void,
    error: (err: GeolocationErrorLike) => void,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
};

export type GeolocationPositionLike = {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
};

export type GeolocationErrorLike = { code: number; message?: string };

// PositionError codes — https://developer.mozilla.org/en-US/docs/Web/API/PositionError
export const ERR_PERMISSION_DENIED = 1;
export const ERR_POSITION_UNAVAILABLE = 2;
export const ERR_TIMEOUT = 3;

export type AcquireFixOptions = {
  /** Total budget (ms) for collecting the best fix. Default 10_000. */
  timeoutMs?: number;
  /** A fix with accuracy <= this (m) resolves immediately. Default 50. */
  goodAccuracyM?: number;
  /** watchPosition option; defaults to true (request the best available fix). */
  enableHighAccuracy?: boolean;
  /** watchPosition option; defaults to 0 (never accept a cached/stale fix). */
  maximumAge?: number;
  /** Optional abort signal (unmount / superseded request). */
  signal?: { aborted: boolean; addEventListener: (type: string, fn: () => void) => void } | undefined;
};

export const DEFAULT_GPS_TIMEOUT_MS = 10_000;
export const DEFAULT_GOOD_ACCURACY_M = 50;

function isValidCoords(lat: number, lng: number): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Collect the best available geolocation fix from a `watchPosition` session.
 *
 * Resolves with the most accurate fix seen; rejects with a classified
 * `GpsError` on permission denial, service unavailability, timeout, or abort.
 * The watch is always stopped (clearWatch) when the promise settles.
 */
export function acquireBestFix(
  geo: GeolocationLike,
  options: AcquireFixOptions = {},
): Promise<GpsPoint> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GPS_TIMEOUT_MS;
  const goodAccuracyM = options.goodAccuracyM ?? DEFAULT_GOOD_ACCURACY_M;
  const enableHighAccuracy = options.enableHighAccuracy ?? true;
  const maximumAge = options.maximumAge ?? 0;
  const signal = options.signal;

  return new Promise<GpsPoint>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GpsError("aborted"));
      return;
    }

    let watchId: number | null = null;
    let settled = false;
    let best: GpsPoint | null = null;

    const stop = (): void => {
      if (watchId !== null) {
        try {
          geo.clearWatch(watchId);
        } catch {
          /* the id is already invalid — nothing to clean up */
        }
        watchId = null;
      }
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      if (best) resolve(best);
      else reject(new GpsError("timeout", "هیچ موقعیت معتبری در زمان مجاز دریافت نشد."));
    };

    // We own the timeout ourselves: a watchPosition TIMEOUT error is
    // recoverable (a better fix can still arrive), so only our budget decides
    // when to stop — not the per-fix timeout the browser reports.
    const timer = setTimeout(finish, timeoutMs);

    signal?.addEventListener("abort", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      reject(new GpsError("aborted"));
    });

    try {
      watchId = geo.watchPosition(
        (pos) => {
          if (settled) return;
          const { latitude, longitude, accuracy } = pos.coords;
          // Ignore a fix with unusable coordinates rather than failing the
          // whole session; a later fix may be valid.
          if (!isValidCoords(latitude, longitude)) return;
          const acc =
            typeof accuracy === "number" && Number.isFinite(accuracy)
              ? accuracy
              : null;
          const candidate: GpsPoint = { latitude, longitude, accuracy: acc };
          // Keep the most accurate fix seen so far (fewer metres = better).
          if (
            best === null ||
            (acc !== null && (best.accuracy === null || acc < best.accuracy))
          ) {
            best = candidate;
          }
          // Resolve as soon as the fix is good enough — no reason to spend the
          // entire budget when the device is already precise.
          if (acc !== null && acc <= goodAccuracyM) {
            finish();
          }
        },
        (err) => {
          if (settled) return;
          if (err.code === ERR_PERMISSION_DENIED) {
            settled = true;
            clearTimeout(timer);
            stop();
            reject(new GpsError("permission_denied", "دسترسی به موقعیت رد شد."));
          } else if (err.code === ERR_POSITION_UNAVAILABLE) {
            settled = true;
            clearTimeout(timer);
            stop();
            reject(new GpsError("unavailable", "سرویس موقعیت‌یاب دستگاه در دسترس نیست."));
          }
          // ERR_TIMEOUT is recoverable for a watch — wait for our own budget.
        },
        { enableHighAccuracy, timeout: timeoutMs, maximumAge },
      );
    } catch {
      clearTimeout(timer);
      stop();
      reject(new GpsError("unavailable_api", "مرورگر از تعیین موقعیت پشتیبانی نمی‌کند."));
    }
  });
}
