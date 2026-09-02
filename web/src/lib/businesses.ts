import api from "@/lib/api";

export type BusinessStatus = "draft" | "pending" | "approved" | "rejected" | "suspended";

export type Business = {
  id: number;
  name: string;
  slug: string;
  category?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  services?: string[];
  social_links?: string[] | Record<string, string>;
  status: BusinessStatus;
  moderation_note?: string;
  created_at?: string;
  updated_at?: string;
  distance?: number | null;
  distance_meters?: number;
  verification_badge?: boolean;
  /** Raw badge array from the search API (e.g. ["verified", "showcase"]). */
  badges?: string[];
  navigation_url?: string;
  rating?: number | null;
};

export type BusinessDraft = Partial<Omit<Business, "id" | "slug" | "status">>;

export const listBusinesses = () =>
  api.get<Business[]>("/businesses").then((r) => r.data);

export const createBusiness = (data: BusinessDraft) =>
  api.post<Business>("/businesses", data).then((r) => r.data);

export const updateBusiness = (id: number, data: BusinessDraft) =>
  api.put<Business>(`/businesses/${id}`, data).then((r) => r.data);

export const deleteBusiness = (id: number) =>
  api.delete<{ message: string }>(`/businesses/${id}`).then((r) => r.data);

export const getPublicBusiness = (slug: string) =>
  api.get<Business>(`/public/businesses/${slug}`).then((r) => r.data);

export type BusinessSearchResponse = { data: Business[]; pagination: { page: number; limit: number; total: number; last_page: number; next_page: string | null } };

export type BusinessSearchParams = {
  q?: string;
  city?: string;
  neighborhood?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  limit?: number;
  page?: number;
  verified?: boolean;
  rating?: number;
  open?: boolean;
  subscription_level?: string;
  showcase?: boolean;
};

/**
 * The search API nests coordinates as `coordinates: {latitude, longitude}`;
 * everything else in the frontend expects flat `latitude`/`longitude`.
 * Normalize here so consumers never deal with both shapes.
 */
function normalizeBusiness<T extends Partial<Business>>(b: T): T & Pick<Business, "latitude" | "longitude" | "distance"> {
  const coords = (b as { coordinates?: { latitude?: number; longitude?: number } }).coordinates;
  // PostGIS ST_Distance comes back as a string (numeric column) — coerce once here.
  const rawDistance = (b as { distance?: number | string | null }).distance;
  const distance =
    rawDistance == null || rawDistance === "" ? null : Number(rawDistance);
  return {
    ...b,
    latitude: b.latitude ?? coords?.latitude,
    longitude: b.longitude ?? coords?.longitude,
    distance: Number.isFinite(distance) ? (distance as number) : null,
  } as T & Pick<Business, "latitude" | "longitude" | "distance">;
}

export const searchBusinesses = (
  params: BusinessSearchParams,
  config?: { signal?: AbortSignal },
) =>
  api
    .get<BusinessSearchResponse>("/search/businesses", { params, ...config })
    .then((r) => {
      const payload = r.data.data ?? (r.data as unknown as Business[]);
      const normalized = (Array.isArray(payload) ? payload : []).map(normalizeBusiness);
      return { ...r.data, data: normalized } as BusinessSearchResponse;
    });

export type SearchFacets = {
  cities: string[];
  categories: string[];
  neighborhoods: string[];
};

/** Distinct filter values from approved businesses (cached server-side 5 min). */
export const getSearchFacets = () =>
  api.get<SearchFacets>("/search/facets").then((r) => r.data);

/** Public QR code (SVG) pointing at the canonical /b/{slug} page. */
export const getQrUrl = (slug: string) =>
  `${api.getUri()}/public/businesses/${slug}/qr`;

export const getHomepageContent = () => api.get<Record<string, string>>("/public/homepage").then((r) => r.data);
