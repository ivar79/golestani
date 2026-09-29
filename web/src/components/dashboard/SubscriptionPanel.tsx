"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Download, Loader2, Paperclip, RefreshCw, Send, ShieldCheck, Timer } from "lucide-react";
import { extractApiError } from "@/lib/api";
import {
  downloadSubscriptionReceipt,
  getBusinessSubscriptions,
  getPlansPricing,
  submitSubscription,
  type Plan,
  type Subscription,
} from "@/lib/subscriptions";
import { formatRemaining, remainingMsFromSnapshot, serverTimeSnapshot, type ServerTimeSnapshot } from "@/lib/subscriptionTime";

const statusLabels: Record<Subscription["status"] | "scheduled", string> = {
  pending_receipt: "در انتظار بررسی رسید",
  active: "فعال",
  rejected: "رد شده",
  expired: "منقضی شده",
  scheduled: "پلن بعدی",
};

const statusStyles: Record<Subscription["status"] | "scheduled", string> = {
  pending_receipt: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  expired: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  scheduled: "border-cyan-400/30 bg-cyan-400/10 text-cyan-400",
};

const priceLabel = (price: number) => `${new Intl.NumberFormat("fa-IR").format(price)} تومان`;

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // matches backend max:5120 (KB)
const ALLOWED_RECEIPT_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export function SubscriptionPanel({ businessId }: { businessId?: number }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [receipt, setReceipt] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Display-only countdown anchor: the SERVER snapshot (expires_at /
  // remaining_seconds) taken at the last fetch — never a client-owned clock.
  const [timeSnapshot, setTimeSnapshot] = useState<ServerTimeSnapshot | null>(null);
  // null = «not ticked yet»; the first real value is set inside effects/
  // callbacks (impure Date.now() must never run during render).
  const [nowTick, setNowTick] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // FIX: /api/plans answers ONE object { free_tier, labels, plans } —
      // the old getPlans() call read it as a bare array and the plan list
      // collapsed to empty. getPlansPricing() unwraps it correctly.
      const [pricing, currentSubscriptions] = await Promise.all([
        getPlansPricing(),
        getBusinessSubscriptions(businessId),
      ]);
      setPlans(pricing.plans);
      setSubscriptions(currentSubscriptions);
      setSelectedPlan((current) => current || String(pricing.plans[0]?.id ?? ""));
      setError(null);

      // Anchor the countdown to the freshest server snapshot of the active
      // subscription (server-computed remaining_seconds at fetch time).
      const active = currentSubscriptions.find((s) => s.effective_status === "active" || (s.status === "active" && s.expires_at));
      const fetchedAt = Date.now();
      setTimeSnapshot(
        active
          ? serverTimeSnapshot(active.expires_at ?? null, active.remaining_seconds ?? null, fetchedAt)
          : null,
      );
      setNowTick(fetchedAt);
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

  // Wake re-sync (same pattern as the entitlements hook): after a successful
  // payment the user returns to this panel — focus/visibility refetches the
  // snapshot so the new subscription appears WITHOUT a logout/reload.
  useEffect(() => {
    if (!businessId) return;
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [businessId, refresh]);

  // Display-only tick: only while visible (greetingTicker pattern); it only
  // re-renders the derived remaining time — access control stays server-side.
  useEffect(() => {
    if (!timeSnapshot) return;
    if (document.visibilityState !== "visible") return;
    const interval = window.setInterval(() => setNowTick(Date.now()), 30_000);
    const onWake = () => setNowTick(Date.now());
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [timeSnapshot]);

  function validateReceiptFile(file: File): string | null {
    if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
      return "فرمت فایل رسید مجاز نیست — فقط JPEG، PNG یا PDF.";
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return "حجم فایل رسید بیشتر از سقف ۵ مگابایت است.";
    }
    return null;
  }

  function onReceiptFileChange(file: File | null) {
    setFileError(null);
    if (!file) {
      setReceiptFile(null);
      return;
    }
    const problem = validateReceiptFile(file);
    if (problem) {
      setFileError(problem);
      setReceiptFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setReceiptFile(file);
  }

  async function submit() {
    if (!businessId || !selectedPlan) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await submitSubscription(businessId, {
        plan_id: Number(selectedPlan),
        receipt_reference: receipt.trim() || undefined,
        receipt: receiptFile ?? undefined,
      });
      setReceipt("");
      setReceiptFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("درخواست اشتراک ثبت شد و پس از بررسی مدیر فعال می‌شود.");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadReceipt(subscription: Subscription) {
    setDownloadingId(subscription.id);
    setError(null);
    try {
      await downloadSubscriptionReceipt(subscription.id);
    } catch (requestError) {
      const statusCode = (requestError as { response?: { status?: number } })?.response?.status;
      setError(statusCode === 404 ? "فایل رسید روی سرور یافت نشد." : extractApiError(requestError));
    } finally {
      setDownloadingId(null);
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
          <p className="mt-1 text-xs leading-6 text-ik-muted">
            پلن را انتخاب کنید، شماره پیگیری را وارد کرده و (اختیاری) تصویر یا PDF رسید پرداخت را پیوست کنید.
          </p>
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
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={receipt} onChange={(event) => setReceipt(event.target.value)} maxLength={160} placeholder="شماره رسید یا کد پیگیری" className="ik-field min-w-0 flex-1 rounded-xl border border-ik-border bg-ik-wash px-4 py-3 text-sm text-ik-text outline-none focus:border-ik-accent" />
            <button type="button" onClick={() => void submit()} disabled={submitting || !selectedPlan} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ik-accent px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} ثبت درخواست
            </button>
          </div>

          {/* Receipt file attachment — validated client-side; the backend
              re-validates and stores it on the PRIVATE receipts disk. */}
          <div className="rounded-xl border border-ik-border bg-ik-wash p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ik-text">
              <Paperclip className="h-4 w-4 text-ik-accent" />
              {receiptFile ? receiptFile.name : "پیوست فایل رسید (اختیاری — JPEG، PNG یا PDF)"}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => onReceiptFileChange(e.target.files?.[0] || null)}
              />
            </label>
            {fileError && <p role="alert" className="mt-2 text-[11px] text-ik-danger">{fileError}</p>}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-ik-border pt-5">
        <h3 className="text-sm font-bold text-ik-text">سوابق اشتراک</h3>
        {loading ? <p className="text-xs text-ik-muted">در حال دریافت اطلاعات...</p> : subscriptions.length === 0 ? <p className="text-xs text-ik-muted">هنوز درخواستی ثبت نشده است.</p> : subscriptions.map((subscription) => (
          <div key={subscription.id} className="space-y-2 rounded-xl bg-ik-wash p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ik-text">{subscription.plan?.name ?? subscription.plan_name ?? "اشتراک"}</span>
              {/* effective_status: the DERIVED server status — an `active`
                  row past expires_at reads «منقضی شده» immediately. */}
              <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold ${statusStyles[(subscription.effective_status as Subscription["status"]) ?? subscription.status] ?? "border-ik-border text-ik-muted"}`}>{statusLabels[(subscription.effective_status as Subscription["status"]) ?? subscription.status] ?? subscription.effective_status ?? subscription.status}</span>
            </div>

            {/* Server-written money snapshot — never client values. */}
            <div className="grid gap-1 text-[11px] text-ik-muted sm:grid-cols-3">
              <span>مبلغ: {subscription.price_amount != null ? priceLabel(subscription.price_amount) : "—"}</span>
              <span>شروع: {formatDate(subscription.start_date)}</span>
              <span>پایان: {formatDate(subscription.end_date)}</span>
            </div>

            {/* Remaining time: derived from the SERVER timestamp snapshot
                (expires_at − now). No DB counter exists; every resync
                re-anchors to fresh server truth. Display only. */}
            {subscription.status === "active" && timeSnapshot && nowTick !== null && remainingMsFromSnapshot(timeSnapshot, nowTick) !== null && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-ik-accent">
                <Timer className="h-3.5 w-3.5" />
                زمان باقی‌مانده: {formatRemaining(remainingMsFromSnapshot(timeSnapshot, nowTick))}
              </span>
            )}

            {/* A scheduled row is a downgrade/renewal waiting for the current
                period to end (FeatureGate promotes it lazily at started_at). */}
            {subscription.status === "scheduled" && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400">
                <Timer className="h-3.5 w-3.5" />
                پلن بعدی از {formatDate(subscription.started_at ?? subscription.start_date)} فعال می‌شود
              </span>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {subscription.receipt_reference && (
                <span className="font-mono text-[10px] text-ik-muted" dir="ltr">{subscription.receipt_reference}</span>
              )}
              <button
                type="button"
                onClick={() => void downloadReceipt(subscription)}
                disabled={downloadingId === subscription.id}
                className="inline-flex items-center gap-1 rounded-lg border border-ik-accent/40 bg-ik-accent/10 px-2.5 py-1 text-[11px] font-semibold text-ik-accent hover:bg-ik-accent/20 disabled:opacity-50"
              >
                {downloadingId === subscription.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                دانلود رسید
              </button>
            </div>

            {subscription.admin_note && <span className="block text-ik-danger">یادداشت مدیر: {subscription.admin_note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
