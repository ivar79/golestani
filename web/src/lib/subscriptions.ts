import api from "@/lib/api";
import type { PublicPlansResponse, PublicPlan } from "@/lib/entitlements";

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
  status: "pending_receipt" | "active" | "rejected" | "expired";
  plan_name?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  duration_days?: number | null;
  receipt_reference: string | null;
  start_date: string | null;
  end_date: string | null;
  admin_note: string | null;
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