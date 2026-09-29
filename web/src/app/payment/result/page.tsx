"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import AppTaskbar from "@/components/layout/AppTaskbar";
import SiteFooter from "@/components/layout/SiteFooter";
import { getPaymentStatus, type PaymentStatusResponse } from "@/lib/payments";
import { extractApiError } from "@/lib/api";
import { formatToman, tomanFromRial } from "@/lib/money";

/** Server `amount` is the GATEWAY amount in RIAL; display is TOMAN (money.ts = the single conversion point). */
const displayToman = (rialAmount: number, currency: string) =>
  formatToman(currency === "IRR" ? tomanFromRial(rialAmount) : rialAmount);

/** User-showable failure reasons (never raw internal codes when avoidable). */
const friendlyFailureReason = (reason: string): string => {
  const map: Record<string, string> = {
    canceled_at_gateway: "پرداخت در درگاه لغو شد.",
    amount_mismatch: "مبلغ تأییدشده با مبلغ تراکنش مطابقت نداشت.",
    unknown_authority: "شناسه تراکنش معتبر نیست.",
    pending_ttl_exceeded: "زمان انتظار پرداخت به پایان رسید.",
  };
  if (map[reason]) return map[reason];
  if (reason.startsWith("verify_failed")) return "تأیید تراکنش در درگاه ناموفق بود.";
  if (reason.startsWith("request_rejected")) return "درگاه پرداخت درخواست را نپذیرفت.";
  if (reason.startsWith("provider_error")) return "خطای موقت درگاه پرداخت؛ بعداً تلاش کنید.";
  return reason;
};

/**
 * Payment result page — the browser lands here after the ZarinPal callback
 * redirects back. SECURITY: this page is strictly READ-ONLY. It polls the
 * server's status endpoint; activation never happens here and refreshing
 * can never re-activate (the server is the single source of truth).
 */
function ResultInner() {
  const params = useSearchParams();
  const authority = params.get("authority") ?? "";
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!authority) {
      // Defer state updates out of the synchronous effect body.
      const t = window.setTimeout(() => {
        setError("لینک نامعتبر است.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(t);
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await getPaymentStatus(authority);
        if (cancelled) return;
        setStatus(data);
        setError(null);
        // Stop polling on any terminal state.
        if (data.status !== "pending") {
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      } catch (e) {
        if (cancelled) return;
        setError(extractApiError(e));
        if (pollRef.current) window.clearInterval(pollRef.current);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    pollRef.current = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [authority]);

  const badge = (s: string) => {
    switch (s) {
      case "paid":
        return { text: "پرداخت موفق", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" };
      case "pending":
        return { text: "در انتظار تأیید درگاه", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" };
      case "canceled":
        return { text: "پرداخت لغو شد", cls: "border-slate-400/30 bg-slate-400/10 text-slate-300" };
      default:
        return { text: "پرداخت ناموفق", cls: "border-rose-400/40 bg-rose-400/10 text-rose-200" };
    }
  };

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-night px-4 pb-20 pt-28 text-surface sm:px-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
        {loading && <p className="text-sm text-slate-400">در حال بررسی وضعیت پرداخت…</p>}
        {!loading && error && (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        )}
        {!loading && !error && status && (
          <>
            <span className={`inline-block rounded-full border px-4 py-1.5 text-sm font-black ${badge(status.status).cls}`}>
              {badge(status.status).text}
            </span>
            {status.plan_name && <h1 className="mt-4 text-2xl font-black text-white">{status.plan_name}</h1>}
            {status.amount > 0 && (
              <p className="mt-2 text-sm text-slate-400">
                مبلغ پرداخت‌شده: {displayToman(status.amount, status.currency)}
              </p>
            )}
            {status.ref_id && <p className="mt-1 text-xs text-slate-500" dir="ltr">شماره پیگیری: {status.ref_id}</p>}

            {status.subscription && (status.subscription.effective_status ?? status.subscription.status) === "active" ? (
              <div data-payment-result="active" className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4 text-sm leading-7 text-emerald-100">
                وضعیت: <b>فعال</b> ✅
                <br />
                پلن خریداری‌شده: <b>{status.subscription.plan_name}</b>
                <br />
                تاریخ شروع: {status.subscription.start_date}
                <br />
                تاریخ پایان: {status.subscription.end_date}
              </div>
            ) : status.status === "paid" ? (
              <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4 text-sm text-amber-100">
                پرداخت تأیید شد؛ فعال‌سازی در حال انجام است.
              </div>
            ) : (
              status.status !== "pending" && (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  {status.status === "canceled"
                    ? "پرداخت لغو شد — تکمیل نشد و اشتراکی فعال نشد."
                    : "پرداخت ناموفق بود — اشتراکی فعال نشد."}
                  {status.failure_reason && (
                    <span className="mt-1 block text-xs text-slate-500">دلیل: {friendlyFailureReason(status.failure_reason)}</span>
                  )}
                </div>
              )
            )}

            <div className="mt-8 flex justify-center gap-3">
              {/* «بازگشت به پنل کاربری» — هر سه حالت (success/failed/cancel). */}
              <Link href="/dashboard" className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-300">
                بازگشت به پنل کاربری
              </Link>
              <Link href="/pricing" className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10">
                تعرفه‌ها
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function PaymentResultPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-night" />}>
      <AppTaskbar />
      <ResultInner />
      <SiteFooter />
    </Suspense>
  );
}
