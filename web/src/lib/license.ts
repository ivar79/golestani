/**
 * Phase 3 — license verification badge deep link.
 *
 * Pure helpers (no browser globals) so node:test can cover them directly —
 * same testing philosophy as businessSafety.ts.
 *
 * Note: this does NOT route through safeHttpUrl — the tracking URL is built
 * entirely from a fixed, known-good HTTPS base, and the caller-supplied code
 * is validated + percent-encoded as a single path segment here.
 */

const LICENSE_TRACK_BASE = "https://qr.mojavez.ir/track";

/**
 * Build the license tracking URL for the approved badge tooltip/CTA:
 *   https://qr.mojavez.ir/track/{license_tracking_code}
 *
 * Returns null when the code is missing/unsafe — callers must treat null as
 * "do not render the badge link".
 */
export function buildLicenseTrackUrl(code?: string | null): string | null {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return null;
  // Tracking codes are plain identifiers: reject control characters and
  // backslashes outright, then percent-encode whatever remains so the code
  // can never alter the host/path structure of the fixed base URL.
  if (/[\u0000-\u001f\u007f\\]/.test(trimmed)) return null;
  try {
    const url = new URL(`${LICENSE_TRACK_BASE}/${encodeURIComponent(trimmed)}`);
    return url.protocol === "https:" && url.hostname === "qr.mojavez.ir" ? url.href : null;
  } catch {
    return null;
  }
}
