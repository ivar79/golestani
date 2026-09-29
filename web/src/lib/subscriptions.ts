import api from "@/lib/api";
import type { PublicPlansResponse, PublicPlan } from "@/lib/entitlements";
// NOTE: getPlansPricing() is the correct reader of GET /api/plans — the
// endpoint answers ONE object { free_tier, labels, plans }, never a bare
// array. getPlans() below only exists for back-compat callers.

export type Plan = {
  id: number;
  name: string;
  slug?: string;
  description?: string | null;
  price: number;
  currency?: string;
  duration_days: number;
  features: Record<string, unknown> | null;
  sort_order?: number;
  is_featured?: boolean;
  is_public?: boolean;
  is_active: boolean;
};

// Re-export the entitlement contract so existing consumers keep one import path.
export type { PublicPlansResponse, PublicPlan };

/** Subscription carries its own money snapshot (server-written). */
export type Subscription = {
  id: number;
  plan_id: number;
  status: "pending_receipt" | "active" | "rejected" | "expired" | "scheduled";
  plan_name?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  duration_days?: number | null;
  receipt_reference: string | null;
  start_date: string | null;
  end_date: string | null;
  /** TIME LIFECYCLE (server timestamps, UTC) — remaining time is derived
   *  server-side from these; the UI never decrements anything. */
  started_at?: string | null;
  expires_at?: string | null;
  effective_status?: string;
  remaining_seconds?: number | null;
  admin_note: string | null;
  has_receipt?: boolean;
  plan?: Plan;
};

/** GET /api/plans — pricing page payload (free tier + labels + public plans). */
export async function getPlansPricing() {
  return (await api.get<PublicPlansResponse>("/plans")).data;
}

/** Back-compat: the plain active-plan list. */
export async function getPlans() {
  return (await api.get<Plan[]>("/plans")).data;
}

export async function getBusinessSubscriptions(businessId: number) {
  return (await api.get<Subscription[]>(`/businesses/${businessId}/subscriptions`)).data;
}

export async function submitSubscription(
  businessId: number,
  data: { plan_id: number; receipt_reference?: string; receipt?: File },
) {
  const form = new FormData();
  form.set("plan_id", String(data.plan_id));
  if (data.receipt_reference) form.set("receipt_reference", data.receipt_reference);
  if (data.receipt) form.set("receipt", data.receipt);
  return (await api.post<Subscription>(`/businesses/${businessId}/subscriptions`, form)).data;
}

/** Owner/admin authorized receipt download — private disk, blob + token. */
export async function downloadSubscriptionReceipt(id: number): Promise<void> {
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