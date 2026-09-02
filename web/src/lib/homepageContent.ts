/**
 * Homepage CMS content — pure data helpers, safe to import from BOTH
 * Server Components (SSR fetch) and Client Components. No React imports.
 *
 * All homepage text is read from CMS `site_settings` keys (prefix `homepage.`).
 * Nothing is hard-coded here; empty values render as empty strings.
 */
export type HomepageContent = Record<string, string>;

let clientCache: HomepageContent | null = null;
let clientInflight: Promise<HomepageContent> | null = null;

/** Client-side fetch (browser). Cached in module scope for the session. */
export async function fetchHomepageContentClient(): Promise<HomepageContent> {
  if (clientCache) return clientCache;
  if (!clientInflight) {
    const { getHomepageContent } = await import("@/lib/businesses");
    clientInflight = getHomepageContent()
      .then((data) => {
        clientCache = data;
        return data;
      })
      .catch(() => {
        clientInflight = null;
        return {} as HomepageContent;
      });
  }
  return clientInflight;
}

/**
 * Server-side fetch with the Next.js fetch cache (revalidate 60s).
 * Called from async Server Components so the homepage HTML is complete
 * (full text in SSR output — no client-side flash, SEO-visible content).
 */
export async function fetchHomepageContentServer(): Promise<HomepageContent> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
  try {
    const res = await fetch(`${base}/public/homepage`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as HomepageContent;
    // Watchdog: an empty CMS payload means the backend database is unseeded
    // (or the API is broken). The page would render blank — make that visible
    // server-side instead of failing silently.
    if (Object.keys(data).length === 0) {
      console.error("[homepage] CMS payload is EMPTY — site_settings likely unseeded. Run: php artisan migrate --seed");
    }
    return data;
  } catch (err) {
    console.error("[homepage] CMS fetch failed:", err);
    return {};
  }
}

/** Convenience: read a CMS key with the `homepage.` prefix applied. */
export function cms(content: HomepageContent, slot: string): string {
  return content[`homepage.${slot}`] ?? "";
}

/** Parse a JSON-array CMS value (e.g. showcase card lists) with a safe fallback. */
export function cmsList<T = string>(content: HomepageContent, slot: string, fallback: T[] = []): T[] {
  const raw = cms(content, slot);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
