import api from "@/lib/api";

export type AdminOverview = {
  counts: Record<string, number>;
  queues: {
    businesses: Record<string, unknown>[];
    subscriptions: Record<string, unknown>[];
    showcases: Record<string, unknown>[];
    advertisements: Record<string, unknown>[];
    portfolios: Record<string, unknown>[];
  };
};

export type Setting = { key: string; value: string | null };

export type PageContent = {
  slug: string;
  title: string | null;
  content: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

export type Article = {
  id?: number;
  slug: string;
  title: string;
  content: string;
  status: "draft" | "published";
  seo_title?: string | null;
  seo_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  cover_path?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MediaFile = {
  id: number;
  path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at?: string;
};

export async function getAdminOverview() {
  return (await api.get<AdminOverview>("/admin/overview")).data;
}

export async function getAdminSettings() {
  return (await api.get<Setting[]>("/admin/settings")).data;
}

export async function saveAdminSetting(key: string, value: string) {
  return (await api.put(`/admin/settings/${encodeURIComponent(key)}`, { value })).data;
}

export async function getAdminPages() {
  return (await api.get<PageContent[]>("/admin/pages")).data;
}

export async function saveAdminPage(slug: string, data: Partial<PageContent>) {
  return (await api.put(`/admin/pages/${encodeURIComponent(slug)}`, data)).data;
}

export async function getAdminArticles() {
  return (await api.get<{ data: Article[] }>("/admin/articles")).data;
}

/** FormData variant: pass cover file as Blob with filename for multipart upload. */
export async function saveAdminArticle(
  data: Omit<Article, "id">,
  coverFile?: File,
  existingId?: number,
) {
  const form = new FormData();
  form.set("title", data.title);
  form.set("content", data.content);
  form.set("status", data.status);
  if (data.slug) form.set("slug", data.slug);
  if (data.seo_title) form.set("seo_title", data.seo_title);
  if (data.seo_description) form.set("seo_description", data.seo_description);
  if (data.og_title) form.set("og_title", data.og_title);
  if (data.og_description) form.set("og_description", data.og_description);
  if (coverFile) form.set("cover_image", coverFile);
  const url = existingId ? `/admin/articles/${existingId}` : "/admin/articles";
  return (await api.post(url, form)).data as Article;
}

export async function deleteAdminArticle(id: number) {
  return (await api.delete(`/admin/articles/${id}`)).data;
}

export async function uploadAdminMedia(file: File) {
  const form = new FormData();
  form.set("file", file);
  return (await api.post<MediaFile>("/admin/media", form)).data;
}

export async function listAdminMedia() {
  return (await api.get<MediaFile[]>("/admin/media")).data;
}

export async function moderateAdminBusiness(id: number, status: string) {
  return (await api.patch(`/admin/businesses/${id}/moderate`, { status })).data;
}
export async function moderateAdminSubscription(id: number, status: string) {
  return (await api.patch(`/admin/subscriptions/${id}/moderate`, { status })).data;
}
export async function moderateAdminShowcase(id: number, is_published: boolean) {
  return (await api.patch(`/admin/showcases/${id}/moderate`, { is_published })).data;
}
export async function moderateAdminAdvertisement(id: number, status: string) {
  return (await api.patch(`/admin/advertisements/${id}/moderate`, { status })).data;
}
export async function moderateAdminPortfolio(id: number, status: string) {
  return (await api.patch(`/admin/portfolios/${id}/moderate`, { status })).data;
}
