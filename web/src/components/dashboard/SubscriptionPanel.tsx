"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { extractApiError } from "@/lib/api";
import {
  getBusinessSubscriptions,
  getPlans,
  submitSubscription,
  type Plan,
  type Subscription,
} from "@/lib/subscriptions";

const statusLabels: Record<Subscription["status"], string> = {
  pending_receipt: "در انتظار بررسی رسید",
  active: "فعال",
  rejected: "رد شده",
  expired: "منقضی شده",
};

const priceLabel = (price: number) => `${new Intl.NumberFormat("fa-IR").format(price)} تومان`;

export function SubscriptionPanel({ businessId }: { businessId?: number }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [receipt, setReceipt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [availablePlans, currentSubscriptions] = await Promise.all([
        getPlans(),
        getBusinessSubscriptions(businessId),
      ]);
      setPlans(availablePlans);
      setSubscriptions(currentSubscriptions);
      setSelectedPlan((current) => current || String(availablePlans[0]?.id ?? ""));
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function submit() {
    if (!businessId || !selectedPlan) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await submitSubscription(businessId, {
        plan_id: Number(selectedPlan),
        receipt_reference: receipt.trim() || undefined,
      });
      setReceipt("");
      setMessage("درخواست اشتراک ثبت شد و پس از بررسی مدیر فعال می‌شود.");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  if (!businessId) {
    return <section className="rounded-3xl border border-ik-border bg-ik-panel/80 p-6 text-sm text-ik-muted">ابتدا یک کسب‌وکار انتخاب یا ثبت کنید.</section>;
  }

  return (
    <section className="space-y-6 rounded-3xl border border-ik-border bg-ik-panel/80 p-6 shadow-xl sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-ik-text sm:text-lg">
            <CreditCard className="h-5 w-5 text-ik-accent" /> اشتراک و امکانات
          </h2>
          <p className="mt-1 text-xs leading-6 text-ik-muted">پلن را انتخاب کنید و شماره رسید یا کد پیگیری را ثبت کنید.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg p-2 text-ik-muted hover:bg-ik-wash hover:text-ik-text" title="بازخوانی">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-ik-success/30 bg-ik-success/10 p-3 text-xs text-ik-success">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => (
          <button key={plan.id} type="button" onClick={() => setSelectedPlan(String(plan.id))} className={`rounded-2xl border p-4 text-right transition-colors ${selectedPlan === String(plan.id) ? "border-ik-accent bg-ik-accent/10" : "border-ik-border bg-ik-wash hover:border-ik-accent/50"}`}>
            <span className="block text-sm font-bold text-ik-text">{plan.name}</span>
            <span className="mt-2 block text-xs text-ik-muted">{priceLabel(plan.price)} · {plan.duration_days} روز</span>
            <span className="mt-3 flex items-center gap-1 text-[11px] text-ik-muted"><ShieldCheck className="h-3.5 w-3.5 text-ik-success" />{plan.features?.showcase ? "ویترین فعال" : "ویترین پایه"}</span>
          </button>
        ))}
      </div>

      {plans.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <input value={receipt} onChange={(event) => setReceipt(event.target.value)} maxLength={160} placeholder="شماره رسید یا کد پیگیری" className="ik-field min-w-0 flex-1 rounded-xl border border-ik-border bg-ik-wash px-4 py-3 text-sm text-ik-text outline-none focus:border-ik-accent" />
          <button type="button" onClick={() => void submit()} disabled={submitting || !selectedPlan} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ik-accent px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} ثبت درخواست
          </button>
        </div>
      )}

      <div className="space-y-2 border-t border-ik-border pt-5">
        <h3 className="text-sm font-bold text-ik-text">سوابق اشتراک</h3>
        {loading ? <p className="text-xs text-ik-muted">در حال دریافت اطلاعات...</p> : subscriptions.length === 0 ? <p className="text-xs text-ik-muted">هنوز درخواستی ثبت نشده است.</p> : subscriptions.map((subscription) => (
          <div key={subscription.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ik-wash p-3 text-xs">
            <span className="font-semibold text-ik-text">{subscription.plan?.name ?? "اشتراک"}</span>
            <span className="text-ik-muted">{statusLabels[subscription.status]}</span>
            {subscription.admin_note && <span className="basis-full text-ik-danger">یادداشت مدیر: {subscription.admin_note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}