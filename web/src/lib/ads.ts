import api from "@/lib/api";

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

/** Fetch approved, currently-live ads for a slot (from the CMS ad table). */
export const getPublicAds = (slot: string = AD_SLOT) =>
  api.get<Advertisement[]>(`/public/advertisements/${slot}`).then((r) => r.data);
