// @vitest-environment jsdom
/**
 * Session ownership regression suite (2026-10-08).
 *
 * The bug: the bearer token lived in ONE shared `localStorage` slot that every
 * tab read AND wrote, so logging into another account in tab B silently rewrote
 * the credential tab A sent on its next request — tab A kept showing account A
 * while its requests ran as account B ("admin and user panels disagree").
 *
 * The contract pinned here:
 *   - a tab's own token lives in `sessionStorage` (per tab, survives reload);
 *   - `localStorage` is only a SEED for brand-new tabs;
 *   - a tab never adopts another tab's login;
 *   - the axios interceptor sends the CURRENT TAB's token;
 *   - logout clears tab token + seed + cookie.
 *
 * Two tabs are modelled by swapping `window.sessionStorage` for an independent
 * Storage instance while `window.localStorage` stays shared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import api from "./api";
import { TOKEN_KEY, clearSession, readStoredToken, storeSessionToken } from "./session";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  } as Storage;
}

const originalLocal = window.localStorage;
const originalSession = window.sessionStorage;
/** The shared cross-tab seed store. */
let sharedSeed: Storage;
/** Per-tab stores; `installTab` selects which one is "current". */
let tabA: Storage;
let tabB: Storage;

function installTab(store: Storage): void {
  Object.defineProperty(window, "sessionStorage", { value: store, configurable: true, writable: true });
}

beforeEach(() => {
  sharedSeed = makeStorage();
  tabA = makeStorage();
  tabB = makeStorage();
  Object.defineProperty(window, "localStorage", { value: sharedSeed, configurable: true, writable: true });
  installTab(tabA);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: originalLocal, configurable: true, writable: true });
  installTab(originalSession);
});

describe("per-tab token ownership", () => {
  it("A. keeps the same account across a reload of the same tab", () => {
    installTab(tabA);
    storeSessionToken("token-account-a");

    // A reload re-reads the SAME tab's sessionStorage (not the seed).
    expect(readStoredToken()).toBe("token-account-a");
    // The seed also carries it so a brand-new tab lands on the same account.
    expect(sharedSeed.getItem(TOKEN_KEY)).toBe("token-account-a");
  });

  it("B. NEVER adopts another tab's login", () => {
    // Tab A is authenticated as account A.
    installTab(tabA);
    storeSessionToken("token-account-a");

    // Tab B signs in as account B: its own tab store AND the shared seed change.
    installTab(tabB);
    storeSessionToken("token-account-b");
    expect(sharedSeed.getItem(TOKEN_KEY)).toBe("token-account-b");

    // Back in tab A: its identity must be untouched by tab B's login.
    installTab(tabA);
    expect(readStoredToken()).toBe("token-account-a");
  });

  it("inherits the shared seed only in a tab that has no session of its own", () => {
    sharedSeed.setItem(TOKEN_KEY, "seed-token");
    installTab(tabA);

    // First read adopts the seed…
    expect(readStoredToken()).toBe("seed-token");
    // …and copies it into the tab store so later reads never hit the seed again.
    expect(tabA.getItem(TOKEN_KEY)).toBe("seed-token");

    // A later change to the seed (another tab logging in) is NOT picked up.
    sharedSeed.setItem(TOKEN_KEY, "other-account");
    expect(readStoredToken()).toBe("seed-token");
  });

  it("returns null with no tab token and no seed", () => {
    installTab(tabA);
    expect(readStoredToken()).toBeNull();
  });
});

describe("C. logout clears the tab token, the seed and the route-hint cookie", () => {
  it("removes every client-side trace of the session", () => {
    installTab(tabA);
    storeSessionToken("token-account-a");

    clearSession();

    expect(tabA.getItem(TOKEN_KEY)).toBeNull();
    expect(sharedSeed.getItem(TOKEN_KEY)).toBeNull();
    expect(document.cookie).not.toContain(`${TOKEN_KEY}=present`);
  });
});

describe("I/J. the axios client authenticates as THIS tab, per request", () => {
  /** Capture the Authorization header the interceptor attaches. */
  async function authHeaderFor(url: string): Promise<string | undefined> {
    let seen: string | undefined;
    await api.get(url, {
      adapter: async (config) => {
        seen = config.headers?.Authorization as string | undefined;
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
      },
    });
    return seen;
  }

  it("sends tab A's token even after tab B logged in elsewhere", async () => {
    installTab(tabA);
    storeSessionToken("token-account-a");

    // Another tab signs in — shared storage changes underneath.
    sharedSeed.setItem(TOKEN_KEY, "token-account-b");

    installTab(tabA);
    expect(await authHeaderFor("/auth/me")).toBe("Bearer token-account-a");
  });

  it("sends the same tab token on several concurrent requests", async () => {
    installTab(tabA);
    storeSessionToken("token-account-a");

    // Several requests in flight at once must all carry this tab's token and
    // none may fall back to the shared seed.
    const headers = await Promise.all([
      authHeaderFor("/auth/me"),
      authHeaderFor("/businesses"),
      authHeaderFor("/auth/location"),
    ]);

    expect(headers).toEqual([
      "Bearer token-account-a",
      "Bearer token-account-a",
      "Bearer token-account-a",
    ]);
  });
});
