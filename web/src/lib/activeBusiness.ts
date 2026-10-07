/**
 * Remembers which business the user was working on, so a page refresh (or a
 * hop between /dashboard, /card-maker and /designer) lands on the SAME
 * business instead of silently falling back to the newest one.
 *
 * UX hint only — never an authorization input: the API re-checks ownership on
 * every request. All access is try/catch-guarded (private mode / SSR safe).
 */
const KEY = "golestani_active_business";

export function readActiveBusinessId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writeActiveBusinessId(id: number | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (id && id > 0) window.localStorage.setItem(KEY, String(id));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — selection just won't persist */
  }
}

/** Pick the remembered business if the user still owns it, else the first. */
export function pickActiveBusiness<T extends { id: number }>(items: T[], preferredId?: number | null): T | null {
  if (items.length === 0) return null;
  const wanted = preferredId ?? readActiveBusinessId();
  return items.find((item) => item.id === wanted) ?? items[0];
}
