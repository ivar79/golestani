import api from "@/lib/api";

/**
 * Online payment client (ZarinPal era).
 *
 * SECURITY: the client sends ONLY plan_id + business_id. Amount, currency,
 * duration and entitlements are resolved server-side; any value rendered
 * here is display-only and the server's status endpoint is the single
 * source of truth for activation state.
 */
export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "canceled"
  | "expired";

export type PaymentStatusResponse = {
  status: PaymentStatus;
  ref_id: string | null;
  plan_name: string | null;
  business_id: number;
  /** GATEWAY amount in RIAL (see lib/money.ts for the display conversion). */
  amount: number;
  currency: string;
  failure_reason: string | null;
  paid_at: string | null;
  subscription: {
    id: number;
    status: string;
    /** Derived server-side: an `active` row past expires_at reads `expired`. */
    effective_status?: string;
    start_date: string | null;
    end_date: string | null;
    started_at?: string | null;
    expires_at?: string | null;
    remaining_seconds?: number | null;
    plan_name: string;
  } | null;
  created_at: string | null;
};

export type PaymentInitResponse = {
  transaction_id: number;
  authority: string;
  redirect_url: string;
  amount: number;
  currency: string;
};

/**
 * Start an online payment for a plan on one of the user's businesses.
 * Returns the ZarinPal StartPay URL the browser must be redirected to.
 */
export async function initPayment(businessId: number, planId: number): Promise<PaymentInitResponse> {
  return (
    await api.post<PaymentInitResponse>(`/businesses/${businessId}/payments/init`, {
      plan_id: planId,
    })
  ).data;
}

/** Read-only status lookup (safe to poll; never triggers activation). */
export async function getPaymentStatus(authority: string): Promise<PaymentStatusResponse> {
  return (await api.get<PaymentStatusResponse>("/payments/status", { params: { authority } })).data;
}
