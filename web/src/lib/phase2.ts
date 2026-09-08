import api from "@/lib/api";
import type { Business, BusinessStatus } from "@/lib/businesses";

export type BusinessImage = { id: number; path: string; alt: string | null };
export type Phase2Business = Business & { public_url?: string; images?: BusinessImage[] };
export type BusinessInput = {
  name: string; category: string | null; description: string | null;
  phone: string | null; email: string | null; address: string | null;
  city: string | null; neighborhood: string | null;
  latitude: number | null; longitude: number | null;
  services: string[]; social_links: Record<string, string>;
};
export type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
export type AuditEvent = { id: number; actor_id: number | null; event: string; metadata: string | Record<string, unknown>; created_at: string };
export const statusLabel: Record<BusinessStatus, string> = {
  draft: "پیش‌نویس", pending: "در انتظار بررسی", approved: "تأییدشده", rejected: "ردشده", suspended: "تعلیق‌شده",
};
export const badgeLabel: Record<string, string> = { verified: "احراز شده", featured: "ویژه", trusted: "مورد اعتماد" };
export const getOwnedBusinesses = () => api.get<Phase2Business[]>("/businesses").then(r => r.data);
export const getOwnedBusiness = (id: number) => api.get<Phase2Business>(`/businesses/${id}`).then(r => r.data);
export const saveProfile = (id: number | null, data: BusinessInput) =>
  (id ? api.put<Phase2Business>(`/businesses/${id}`, data) : api.post<Phase2Business>("/businesses", data)).then(r => r.data);
export const uploadProfileMedia = (id: number, data: FormData) => api.post<Phase2Business>(`/businesses/${id}/upload`, data).then(r => r.data);
export const getImages = (id: number) => api.get<BusinessImage[]>(`/businesses/${id}/images`).then(r => r.data);
export const addImage = (id: number, file: File) => {
  const data = new FormData(); data.append("image", file); data.append("alt", "تصویر کسب‌وکار");
  return api.post<BusinessImage>(`/businesses/${id}/images`, data).then(r => r.data);
};
export const removeImage = (id: number, imageId: number) => api.delete(`/businesses/${id}/images/${imageId}`);
export const getAdminBusinesses = (status: string, q: string, page: number, signal?: AbortSignal) =>
  api.get<Page<Phase2Business>>("/admin/businesses", { params: { status: status || undefined, q: q || undefined, page }, signal }).then(r => r.data);
export const moderateBusiness = (id: number, status: "approved" | "rejected" | "suspended", moderation_note: string, badges: string[]) =>
  api.patch<Phase2Business>(`/admin/businesses/${id}/moderate`, { status, moderation_note: moderation_note || null, badges }).then(r => r.data);
export const getBusinessAudit = (id: number, page = 1) => api.get<Page<AuditEvent>>(`/admin/businesses/${id}/audit`, { params: { page } }).then(r => r.data);


import { resolveMediaUrl } from "@/lib/businessSafety";
export { safeHttpUrl, normalizeSocial } from "@/lib/businessSafety";
export const mediaUrl = (path?: string | null) => resolveMediaUrl(api.defaults.baseURL || "", path);
