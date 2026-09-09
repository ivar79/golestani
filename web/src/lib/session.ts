/**
 * Session storage primitives shared by the browser client and the edge
 * middleware (proxy.ts). No axios and no browser-only calls at module scope,
 * so this file is safe to import from any bundle.
 *
 * The bearer token lives in localStorage (existing project architecture, see
 * docs/PHASE_2_HANDOVER_FA.md). The `golestani_token` cookie is a UI routing
 * hint ONLY — never an authorization credential. API authorization is always
 * enforced by Laravel (Sanctum bearer + role middleware).
 */
export const TOKEN_KEY = "golestani_token";
export const AUTH_COOKIE = "golestani_token";

/** Read the persisted token, or null on the server / when logged out. */
export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Set or clear the UI-only route-hint cookie read by proxy.ts. */
export function setAuthCookie(present: boolean): void {
  if (typeof document === "undefined") return;
  const secure = document.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE}=${present ? "present" : ""}; path=/; max-age=${present ? 604800 : 0}; SameSite=Lax${secure}`;
}

/** Remove every client-side trace of the session (storage + hint cookie). */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  setAuthCookie(false);
}
