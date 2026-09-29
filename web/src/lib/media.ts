/**
 * Card media URL resolution — same-origin by design.
 *
 * WHY THIS EXISTS (and why it is not `resolveMediaUrl`):
 *   Card documents persist image sources as system storage paths
 *   (`/storage/…`) and the server whitelist refuses anything else. Those files
 *   live on the API origin, which is a DIFFERENT origin from the web app in
 *   production (Vercel web + separate API host).
 *
 *   That breaks rasterization: `html-to-image` reads image pixels to inline
 *   them, and reading pixels of a cross-origin image requires CORS. Static
 *   files under `/storage` never reach Laravel's CORS middleware (they are
 *   served by the web server, not the framework), so no CORS config can fix it.
 *
 *   Therefore card media is resolved through our own Next route
 *   (`/api/media/…`), which streams the API file same-origin. One path, used by
 *   the editor stage, the export surface and the public card renderer, so what
 *   you see is what gets rasterized.
 *
 * `resolveMediaUrl` in `businessSafety` stays for surfaces that only DISPLAY
 * remote media (search results, legacy profile pages) and never rasterize it.
 */

/** Hard ceiling on a single proxied path (mirrors the server's 400-char src cap). */
const MAX_PATH_LENGTH = 400;

/**
 * Resolve a document media reference to a same-origin, rasterizable URL.
 * Returns null for anything that is not a system storage path, so callers can
 * render a placeholder instead of a broken image.
 */
export function mediaSrc(path?: string | null): string | null {
  if (typeof path !== "string") return null;
  const value = path.trim();
  if (value === "" || value.length > MAX_PATH_LENGTH) return null;

  const relative = value.startsWith("/") ? value.slice(1) : value;
  if (!relative.startsWith("storage/")) return null;
  // Reject traversal and query/fragment/backslash tricks — the server already
  // refuses them, this keeps the proxy surface equally strict.
  if (relative.includes("..") || /[\\?#%]/.test(relative)) return null;
  if (!/^storage\/[A-Za-z0-9._\-/]+$/.test(relative)) return null;

  return `/api/media/${relative}`;
}

/**
 * Server-side counterpart: turn the proxied relative path back into the
 * absolute upstream URL. Used only by the `/api/media` route handler.
 */
export function upstreamMediaUrl(apiBaseUrl: string, relativePath: string): string | null {
  if (!apiBaseUrl) return null;
  const origin = apiBaseUrl.replace(/\/$/, "").replace(/\/api(\/v\d+)?$/, "");
  if (!/^https?:\/\//i.test(origin)) return null;
  if (!/^storage\/[A-Za-z0-9._\-/]+$/.test(relativePath) || relativePath.includes("..")) return null;
  return `${origin}/${relativePath}`;
}
