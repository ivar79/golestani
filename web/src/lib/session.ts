/**
 * Session storage primitives shared by the browser client and the edge
 * middleware (proxy.ts). No axios and no browser-only calls at module scope,
 * so this file is safe to import from any bundle.
 *
 * TOKEN OWNERSHIP (regression 2026-10-08):
 *   The bearer token is owned PER TAB (`sessionStorage`). It used to live in a
 *   single `localStorage` slot that every tab read AND wrote, so logging into
 *   another account in a second tab silently rewrote the credential of the
 *   first tab: its next request ran as the other account while its UI still
 *   showed the previous user ("admin and user panels disagree"). `sessionStorage`
 *   is per-tab AND survives a reload of that tab, which is exactly the
 *   requirement: refresh keeps the same account, another tab's login does not.
 *
 *   `localStorage` keeps the same key only as a SEED for brand-new tabs (so
 *   opening a new tab still lands on the last signed-in account). An existing
 *   tab reads its own token first and never re-reads the seed, and no code may
 *   read the seed directly for a request — always go through `readStoredToken`.
 *
 * The `golestani_token` cookie is a UI routing hint ONLY — never an
 * authorization credential. API authorization is always enforced by Laravel
 * (Sanctum bearer + role middleware).
 */
export const TOKEN_KEY = "golestani_token";
export const AUTH_COOKIE = "golestani_token";

/** Per-tab storage, or null on the server / when the browser blocks it. */
function tabStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Shared seed store (last signed-in session, for new tabs only). */
function seedStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(store: Storage | null, key: string): string | null {
  if (store === null) return null;
  try {
    const value = store.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function write(store: Storage | null, key: string, value: string): void {
  if (store === null) return;
  try {
    store.setItem(key, value);
  } catch {
    /* full or blocked storage — the in-memory React state still works */
  }
}

function remove(store: Storage | null, key: string): void {
  if (store === null) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to clean */
  }
}

/**
 * The token THIS TAB authenticates with.
 *
 * Own token first (per-tab, survives reload). Only a tab that has no session of
 * its own inherits the shared seed, and the inherited value is copied into the
 * tab store so later requests never re-read another tab's slot.
 */
export function readStoredToken(): string | null {
  const tab = tabStore();
  const own = read(tab, TOKEN_KEY);
  if (own !== null) return own;

  const inherited = read(seedStore(), TOKEN_KEY);
  if (inherited !== null) write(tab, TOKEN_KEY, inherited);
  return inherited;
}

/** Persist a freshly issued token for THIS tab (and seed new tabs with it). */
export function storeSessionToken(token: string): void {
  write(tabStore(), TOKEN_KEY, token);
  write(seedStore(), TOKEN_KEY, token);
}

/** Set or clear the UI-only route-hint cookie read by proxy.ts. */
export function setAuthCookie(present: boolean): void {
  if (typeof document === "undefined") return;
  const secure = document.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE}=${present ? "present" : ""}; path=/; max-age=${present ? 604800 : 0}; SameSite=Lax${secure}`;
}

/** Remove every client-side trace of the session (tab token + seed + cookie). */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  remove(tabStore(), TOKEN_KEY);
  // Also drop the shared seed: a logout must not leave a credential behind for
  // the next new tab to inherit.
  remove(seedStore(), TOKEN_KEY);
  setAuthCookie(false);
}
