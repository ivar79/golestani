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
const ADS_TTL_MS = 5 * 60 * 1000;

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
