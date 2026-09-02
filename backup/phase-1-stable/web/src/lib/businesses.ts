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

/** Public QR code (SVG) pointing at the canonical /b/{slug} page. */
export const getQrUrl = (slug: string) =>
  `${api.getUri()}/public/businesses/${slug}/qr`;
