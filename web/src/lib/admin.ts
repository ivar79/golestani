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
  url?: string;
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
export async function moderateAdminSubscription(id: number, status: string, admin_note?: string) {
  return (await api.patch(`/admin/subscriptions/${id}/moderate`, { status, admin_note })).data;
}
export async function moderateAdminShowcase(id: number, is_published: boolean) {
  return (await api.patch(`/admin/showcases/${id}/moderate`, { is_published })).data;
}
export async function moderateAdminAdvertisement(id: number, status: string, admin_note?: string) {
  return (await api.patch(`/admin/advertisements/${id}/moderate`, { status, admin_note })).data;
}
export async function moderateAdminPortfolio(id: number, status: string, moderation_note?: string) {
  return (await api.patch(`/admin/portfolios/${id}/moderate`, { status, moderation_note })).data;
}

export type AdminUser = {
  id: number;
  name: string | null;
  /** Unique public handle (null until the account claims one). */
  username?: string | null;
  phone: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
  roles: Array<{ name: string; display_name: string }>;
  /** CANONICAL designer program status (users.designer_status). */
  designer_status?: string;
  /** Legacy program profile — compare with designer_status for divergence. */
  designer?: { id: number; user_id: number; status: string } | null;
};

/** One role group the panel can focus (server-side filter). */
export type AdminUserRoleFilter = "admin" | "designer" | "business_owner" | "user";

export async function getAdminUsers(page = 1, search = "", role: AdminUserRoleFilter | "" = "") {
  const params = new URLSearchParams({ page: String(page) });
  if (search.trim()) params.set("search", search.trim());
  if (role) params.set("role", role);
  return (await api.get<{ data: AdminUser[]; current_page: number; last_page: number; total: number }>(`/admin/users?${params.toString()}`)).data;
}

export async function updateAdminUser(id: number, data: { name?: string; is_active?: boolean; roles?: string[] }) {
  return (await api.patch<AdminUser>(`/admin/users/${id}`, data)).data;
}

/**
 * The CANONICAL designer-approval workflow: status + designer role + legacy
 * `designers` row sync + audit, atomically. Reject/suspend need a reason.
 */
export async function updateAdminUserDesignerStatus(id: number, designerStatus: string, reason?: string) {
  return (await api.patch<AdminUser>(`/admin/users/${id}/designer-status`, { designer_status: designerStatus, reason })).data;
}

export type AdminTaxonomy = {
  id: number;
  type: "city" | "neighborhood" | "category" | "service" | "badge";
  parent_id: number | null;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

export async function getAdminTaxonomies(type?: AdminTaxonomy["type"]) {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return (await api.get<{ data: AdminTaxonomy[] }>(`/admin/taxonomies${query}`)).data;
}

export async function saveAdminTaxonomy(data: Partial<AdminTaxonomy> & { type: AdminTaxonomy["type"]; name: string }) {
  return (await api.post<AdminTaxonomy>("/admin/taxonomies", data)).data;
}

export async function updateAdminTaxonomy(id: number, data: Partial<AdminTaxonomy>) {
  return (await api.put<AdminTaxonomy>(`/admin/taxonomies/${id}`, data)).data;
}

export async function deleteAdminTaxonomy(id: number) {
  return (await api.delete(`/admin/taxonomies/${id}`)).data;
}

export type AdminHealth = {
  status: "ok" | "degraded";
  checked_at: string;
  database: { ok: boolean; driver: string };
  postgis: { ok: boolean; version: string | null };
  redis: { ok: boolean };
  storage: { ok: boolean };
};

export async function getAdminHealth() {
  return (await api.get<AdminHealth>("/admin/health")).data;
}

export type AdminPlan = {
  id: number;
  name: string;
  slug?: string;
  description?: string | null;
  price: number;
  /** Designer referral share of every purchase of this plan (0 = none). */
  commission_percent?: number | null;
  currency?: string;
  duration_days: number;
  features: Record<string, unknown> | null;
  sort_order?: number;
  is_featured?: boolean;
  is_public?: boolean;
  is_active: boolean;
};

/** GET /api/admin/entitlements/catalog — server-driven plan editor fields. */
export type EntitlementCatalogEntry = {
  key: string;
  type: "bool" | "int" | "list";
  label: string;
  group: string;
  free_value: unknown;
};

export type EntitlementCatalogResponse = {
  catalog: EntitlementCatalogEntry[];
  free_tier: { name: string; label: string; description: string; capabilities: Record<string, unknown> };
  policies: Record<string, unknown>;
};

export async function getAdminPlans() {
  return (await api.get<AdminPlan[]>("/admin/plans")).data;
}

export async function getEntitlementCatalog() {
  return (await api.get<EntitlementCatalogResponse>("/admin/entitlements/catalog")).data;
}

export async function saveAdminPlan(data: Omit<AdminPlan, "id">) {
  return (await api.post<AdminPlan>("/admin/plans", data)).data;
}

export async function updateAdminPlan(id: number, data: Partial<AdminPlan>) {
  return (await api.put<AdminPlan>(`/admin/plans/${id}`, data)).data;
}

export type AdminSubscription = {
  id: number;
  status: "pending_receipt" | "active" | "rejected" | "expired" | "scheduled";
  plan_name?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  duration_days?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  receipt_reference?: string | null;
  has_receipt?: boolean;
  admin_note?: string | null;
  created_at?: string;
  plan?: { id: number; name: string } | null;
  business?: { id: number; name: string; slug: string } | null;
};

export async function getAdminSubscriptions(status?: AdminSubscription["status"], page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return (await api.get<{ data: AdminSubscription[]; current_page: number; last_page: number; total: number }>(`/admin/subscriptions?${params}`)).data;
}

export async function downloadAdminSubscriptionReceipt(id: number): Promise<void> {
  const response = await api.get(`/subscriptions/${id}/receipt`, { responseType: "blob" });
  const disposition: string = response.headers?.["content-disposition"] ?? "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
  let filename = "receipt";
  if (utf8Match?.[1]) filename = decodeURIComponent(utf8Match[1]);
  else if (asciiMatch?.[1]) filename = asciiMatch[1];
  const blob: Blob = response.data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[/\\?%*:|"<>]/g, "-");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * One row of the designer attribution report: how many businesses a designer
 * brought in. `designer` is null when the referring account was removed — the
 * count still stands, so the row is rendered with a placeholder instead of
 * being dropped.
 */
export type AdminDesignerAttribution = {
  designer_id: number;
  businesses_count: number;
  designer?: { id: number; display_name: string | null; referral_code: string | null } | null;
};

export async function getAdminRevenueReport() {
  return (await api.get<{
    subscriptions: { total: number; pending: number; active: number; revenue: number };
    designer_attribution: AdminDesignerAttribution[];
  }>("/admin/reports/revenue")).data;
}

export type AdminDesigner = { id: number; display_name: string; referral_code: string; status: string; bio: string | null; businesses_count: number; user?: { phone: string; email: string | null; designer_status?: string } };

export async function getAdminDesigners() {
  return (await api.get<{ data: AdminDesigner[] }>("/admin/designers")).data;
}

export async function moderateAdminDesigner(id: number, status: string, moderation_note?: string) {
  return (await api.patch<AdminDesigner>(`/admin/designers/${id}/moderate`, { status, moderation_note })).data;
}

/** The studio rollout board (read-only) — gate switch, statuses, divergence. */
export type StudioAccessReport = {
  generated_at: string;
  gate: { enforced: boolean; setting: string; capability: string };
  users: {
    total: number;
    by_designer_status: Record<string, number>;
    approved: number;
    approved_without_business: number;
    approved_without_studio_business: number;
    /** canonical unset + legacy decided → review before studio:backfill-designers --apply. */
    backfill_candidates: Array<{ user_id: number; designer_status: string; legacy_status: string; has_designer_role: boolean }>;
    /** canonical already set and disagreeing with legacy → admin decides. */
    divergent: Array<{ user_id: number; designer_status: string; legacy_status: string }>;
    role_without_approval: Array<{ user_id: number; designer_status: string; legacy_status: string | null }>;
  };
  businesses: { total: number; with_card_editor: number; with_designer_studio: number };
  subscriptions: { active: number };
  admin_bypasses: {
    total: number;
    recent: Array<{ id: number; actor_id: number | null; subject_id: number | null; metadata: unknown; created_at: string }>;
  };
};

export async function getStudioReport() {
  return (await api.get<StudioAccessReport>("/admin/studio/report")).data;
}

export type AdminBusinessReport = { id: number; type: string; message: string; status: string; admin_note: string | null; business?: { name: string; slug: string }; reporter?: { phone: string } };

export async function getAdminReports() {
  return (await api.get<{ data: AdminBusinessReport[] }>("/admin/reports")).data;
}

export async function moderateAdminReport(id: number, status: string, admin_note?: string) {
  return (await api.patch<AdminBusinessReport>(`/admin/reports/${id}/moderate`, { status, admin_note })).data;
}

export type AdminAuditEvent = { id: number; actor_id: number | null; event: string; subject_type: string; subject_id: number | null; metadata: Record<string, unknown>; created_at: string };

export async function getAdminAudit() {
  return (await api.get<{ data: AdminAuditEvent[] }>("/admin/audit")).data;
}
