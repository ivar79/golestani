/**
 * Authenticated access to PRIVATE template artwork (personal templates and
 * review-stage designer submissions).
 * WHY: private artwork now lives on a private disk and is served ONLY by the
 * ownership-checked API endpoint (`GET /assets/private/{path}`). The public
 * `/api/media` proxy refuses that namespace, so the editor must fetch these
 * images with the session credential and hand the renderer a same-origin URL.
 *
 * SECURITY RULES (audit finding `private-template-asset-public-disk`):
 *   - the bearer token travels in the Authorization header ONLY — never in a
 *     URL, query string, `img src`, CSS, log line or blob URL;
 *   - blob URLs are document-local and hold no credential;
 *   - the cache is keyed per path and remembers the token it was fetched with,
 *     so a session change (login/logout/switch) can never reuse another
 *     principal's bytes;
 *   - entries are reference-counted and revoked as soon as the last consumer
 *     releases them, and `clearPrivateAssetCache()` nukes everything on logout.
 */

import { readStoredToken } from "@/lib/session";

const PRIVATE_PATH_PREFIX = "storage/templates/users/";
const MAX_PATH_LENGTH = 400;
const ALLOWED_PATH = /^storage\/[A-Za-z0-9._\-\/]+$/;

/** Is this document `src` a private-namespace reference? */
export function isPrivateAssetSrc(src?: string | null): boolean {
  const relative = relativePrivatePath(src);
  return relative !== null;
}

/**
 * Registry path (without the `storage/` prefix) for the authorized endpoint,
 * or null when the src is not a canonical private reference.
 */
export function privateAssetPath(src?: string | null): string | null {
  const relative = relativePrivatePath(src);
  if (relative === null) return null;
  return relative.slice("storage/".length);
}

/** Canonical-form check shared by both helpers (mirrors the server rules). */
function relativePrivatePath(src?: string | null): string | null {
  if (typeof src !== "string") return null;
  const value = src.trim();
  if (value === "" || value.length > MAX_PATH_LENGTH) return null;

  const relative = value.startsWith("/") ? value.slice(1) : value;
  if (!relative.startsWith(PRIVATE_PATH_PREFIX)) return null;
  // Same strictness as `mediaSrc`: no traversal, no look-alike separators,
  // no duplicate slashes (which a downstream server could collapse into a
  // different namespace).
  if (relative.includes("..") || relative.includes("//") || /[\\?#%]/.test(relative)) return null;
  if (!ALLOWED_PATH.test(relative)) return null;

  return relative;
}

type CacheEntry = { url: string; token: string; refs: number };

/** In-memory, per-document cache. Never persisted, never serialized. */
const cache = new Map<string, CacheEntry>();

function sessionToken(): string | null {
  // The CURRENT TAB's credential (never another tab's slot) — see session.ts.
  return readStoredToken();
}

/**
 * Fetch a private asset with the session credential and return a same-origin
 * blob URL (safe for `html-to-image` rasterization). Returns null when the
 * caller is not signed in, is not the owner, or the request fails — callers
 * render a placeholder.
 */
export async function fetchPrivateAssetUrl(
  src: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const path = privateAssetPath(src);
  const token = sessionToken();
  if (path === null || token === null) return null;

  const cached = cache.get(path);
  if (cached !== undefined) {
    if (cached.token === token) {
      cached.refs += 1;
      return cached.url;
    }
    // Different session (login switch): never serve another user's bytes.
    revokeEntry(path);
  }

  const base = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/+$/, "");

  try {
    const response = await fetch(`${base}/assets/private/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    cache.set(path, { url, token, refs: 1 });

    return url;
  } catch {
    // Aborted or offline: the caller shows a placeholder, nothing leaks.
    return null;
  }
}

/** Release one consumer of a private asset; revokes the blob URL at zero. */
export function releasePrivateAssetUrl(src?: string | null): void {
  const path = privateAssetPath(src);
  if (path === null) return;

  const entry = cache.get(path);
  if (entry === undefined) return;

  entry.refs -= 1;
  if (entry.refs <= 0) revokeEntry(path);
}

/** Drop every cached private asset (call on logout / token change). */
export function clearPrivateAssetCache(): void {
  for (const path of Array.from(cache.keys())) {
    revokeEntry(path);
  }
}

function revokeEntry(path: string): void {
  const entry = cache.get(path);
  if (entry === undefined) return;

  cache.delete(path);
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    // Already revoked (or a partial URL implementation) — nothing to do.
  }
}
