export type Advertisement = {
  id: number;
  business_id: number | null;
  slot: string;
  title: string;
  target_url: string | null;
  image_path: string | null;
  status: "pending" | "approved" | "rejected" | "suspended";
  starts_at: string | null;
  ends_at: string | null;
  admin_note: string | null;
};

/** Legacy taskbar slot configured per deployment. Dedicated placements pass their slot explicitly. */
export const AD_SLOT = process.env.NEXT_PUBLIC_AD_SLOT || "taskbar";

type CacheEntry = { data: Advertisement[]; at: number };
const adsCache = new Map<string, CacheEntry>();
const adsInflight = new Map<string, Promise<Advertisement[]>>();
// PHASE 5 moderation freshness: the client cache used to hold a slot for five
// minutes, so an ad that was just REJECTED, unpublished or expired could keep
// rendering long after the server stopped serving it. One minute keeps the
// request-saving benefit while bounding how stale a rendered slot can be.
const ADS_TTL_MS = 60 * 1000;

/** Midnight of the given instant — mirrors the server's day-granular date filters. */
function dayStart(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/**
 * SERVER MIRROR for one ad row, used as defence-in-depth in the UI.
 *
 * The Laravel endpoint already applies these rules (approved ad + approved
 * business + schedule window), but a response can arrive from an edge/client
 * cache that was filled before a moderation change. Re-checking the payload
 * here means a STALE payload can never render an ineligible ad.
 *
 * Day-granular comparisons deliberately match `whereDate()` on the server: an
 * ad whose ends_at is today is still valid until the end of that day.
 */
export function isAdvertisementVisible(
  ad: Advertisement,
  slot: string,
  now: Date = new Date(),
): boolean {
  if (ad.status !== "approved") return false;
  if (ad.slot !== slot) return false;

  const today = dayStart(now);
  if (ad.starts_at) {
    const startsAt = dayStart(new Date(ad.starts_at));
    if (!Number.isFinite(startsAt) || startsAt > today) return false;
  }
  if (ad.ends_at) {
    const endsAt = dayStart(new Date(ad.ends_at));
    if (!Number.isFinite(endsAt) || endsAt < today) return false;
  }

  return true;
}

/** The eligible slice of a slot payload, capped the same way the server caps it. */
export function visibleAdsFor(
  payload: Advertisement[],
  slot: string,
  now: Date = new Date(),
): Advertisement[] {
  const businesses = new Set<number | null>();
  const visible: Advertisement[] = [];

  for (const ad of payload) {
    if (!isAdvertisementVisible(ad, slot, now)) continue;
    // One position per business (server contract); a stale payload that still
    // carries several ads of one business must not fill the placement.
    if (businesses.has(ad.business_id)) continue;
    businesses.add(ad.business_id);
    visible.push(ad);
    if (visible.length === 4) break;
  }

  return visible;
}

/** Public, moderated ads for one placement. Failed refreshes retain that slot's stale data. */
export async function getPublicAds(slot: string = AD_SLOT): Promise<Advertisement[]> {
  const cached = adsCache.get(slot);
  if (cached && Date.now() - cached.at < ADS_TTL_MS) return cached.data;

  const pending = adsInflight.get(slot);
  if (pending) return pending;

  const request = fetch(`/api/ads/${encodeURIComponent(slot)}`)
    .then((response) => (response.ok ? response.json() : []))
    .then((payload: unknown) => {
      const data = Array.isArray(payload) ? payload as Advertisement[] : [];
      adsCache.set(slot, { data, at: Date.now() });
      return data;
    })
    .catch(() => adsCache.get(slot)?.data ?? [])
    .finally(() => {
      adsInflight.delete(slot);
    });

  adsInflight.set(slot, request);
  return request;
}
