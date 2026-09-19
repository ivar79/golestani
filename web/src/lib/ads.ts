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

/**
 * Ad slot id, env-driven. No hardcoded value: deployments set
 * NEXT_PUBLIC_AD_SLOT. A sensible default is used only as a dev fallback.
 */
export const AD_SLOT = process.env.NEXT_PUBLIC_AD_SLOT || "taskbar";

/**
 * Fetch approved, currently-live ads for a slot.
 *
 * Routed through the cached Next.js handler (/api/ads/[slot]) so responses
 * come from the edge cache instead of hitting the Render API on every page
 * navigation (P0 cold-start fix).
 *
 * A module-level TTL cache additionally dedupes client-side navigations:
 * the taskbar remounts on route changes and previously re-fetched each time.
 */
let adsCache: { data: Advertisement[]; at: number; slot: string } | null = null;
const ADS_TTL_MS = 5 * 60 * 1000;
let adsInflight: Promise<Advertisement[]> | null = null;

export async function getPublicAds(slot: string = AD_SLOT): Promise<Advertisement[]> {
  if (adsCache && adsCache.slot === slot && Date.now() - adsCache.at < ADS_TTL_MS) {
    return adsCache.data;
  }
  // A second mount while the first fetch is in flight joins it.
  if (adsInflight) return adsInflight;
  adsInflight = fetch(`/api/ads/${encodeURIComponent(slot)}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((data: Advertisement[]) => {
      adsCache = { data, at: Date.now(), slot };
      return data;
    })
    .catch(() => {
      // Keep any stale data rather than flashing nothing on a blip.
      return adsCache && adsCache.slot === slot ? adsCache.data : [];
    })
    .finally(() => {
      adsInflight = null;
    });
  return adsInflight;
}
