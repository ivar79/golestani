import { neshanApiKey, neshanKeyPresent } from "@/lib/mapEngine";

/**
 * Neshan address/POI search (geocoding) — optional Phase 3+ enhancement.
 *
 * Uses the Neshan search API with the same key the map SDK already uses
 * (contract §7.4: third-party credentials are provided by the client).
 *
 * Offline-resilient by contract: every failure path (no key, no network,
 * timeout, non-OK status) resolves to `null` so callers can fall back to the
 * manual city/pick flow without any crash or error surface.
 */

export type NeshanPlace = {
  title: string;
  neighbourhood?: string;
  city?: string;
  province?: string;
  lat: number;
  lng: number;
};

const SEARCH_ENDPOINT = "https://api.neshan.org/v1/search";
const TIMEOUT_MS = 4000;

/** true only when the address search UI should be offered at all. */
export function neshanSearchAvailable(): boolean {
  return neshanKeyPresent;
}

/**
 * Search an address / POI string via Neshan. Resolves:
 *  - list of places on success
 *  - [] when the key is missing / nothing found
 *  - null on network failure or timeout (caller falls back silently)
 */
export async function searchNeshanAddress(term: string): Promise<NeshanPlace[] | null> {
  const q = term.trim();
  if (!neshanKeyPresent || q.length < 2) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${SEARCH_ENDPOINT}?term=${encodeURIComponent(q)}&lang=fa`, {
      headers: { "Api-Key": neshanApiKey },
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    const json = (await resp.json()) as {
      items?: Array<{
        title?: string;
        neighbourhood?: string;
        city?: string;
        province?: string;
        location?: { x?: number; y?: number };
      }>;
    };

    const items = Array.isArray(json.items) ? json.items : [];
    const places: NeshanPlace[] = [];
    for (const it of items) {
      const title = (it.title ?? "").trim();
      const lat = Number(it.location?.y);
      const lng = Number(it.location?.x);
      if (
        title.length === 0 ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        continue;
      }
      places.push({
        title,
        neighbourhood: it.neighbourhood,
        city: it.city,
        province: it.province,
        lat,
        lng,
      });
    }
    return places.slice(0, 5);
  } catch {
    // AbortError (timeout) or network failure — silent, offline-safe fallback.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Build the single-line label shown under a picked place. */
export function placeLabel(p: NeshanPlace): string {
  return [p.title, p.neighbourhood, p.city].filter(Boolean).join("، ");
}
