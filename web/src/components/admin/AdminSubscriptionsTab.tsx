"use client";

/**
 * AdminSubscriptionsTab — Phase 6 subscription management.
 *
 * Full list with status filter, money snapshot columns (server-written
 * snapshot, never client values), approve/reject-with-note moderation, and
 * the authorized receipt download (private disk — blob + Authorization
 * header, never a public URL).
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Download,
  Loader2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { extractApiError } from "@/lib/api";
import {
  getAdminSubscriptions,
  downloadAdminSubscriptionReceipt,
  moderateAdminSubscription,
  type AdminSubscription,
} from "@/lib/admin";

const STATUS_LABELS: Record<AdminSubscription["status"], string> = {
  pending_receipt: "در انتظار بررسی رسید",
  active: "فعال",
  rejected: "رد شده",
  expired: "منقضی شده",
  scheduled: "زمان‌بندی برای دوره بعد",
};

const STATUS_STYLES: Record<AdminSubscription["status"], string> = {
  pending_receipt: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  expired: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  scheduled: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
};

const FILTERS: { key: AdminSubscription["status"] | ""; label: string }[] = [
  { key: "pending_receipt", label: "در انتظار رسید" },
  { key: "active", label: "فعال" },
  { key: "scheduled", label: "زمان‌بندی‌شده" },
  { key: "expired", label: "منقضی" },
  { key: "rejected", label: "ردشده" },
  { key: "", label: "همه" },
];

const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value))
    : "—";

const formatMoney = (amount?: number | null, currency?: string | null) =>
  amount == null
    ? "—"
    : `${new Intl.NumberFormat("fa-IR").format(amount)} ${currency === "IRR" ? "ریال" : currency ?? ""}`;

export default function AdminSubscriptionsTab() {
  const [rows, setRows] = useState<AdminSubscription[]>([]);
  const [status, setStatus] = useState<AdminSubscription["status"] | "">("pending_receipt");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await getAdminSubscriptions(status || undefined)).data);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function moderate(row: AdminSubscription, next: "active" | "rejected") {
    let note: string | undefined;
    if (next === "rejected") {
      note = window.prompt("دلیل رد اشتراک را وارد کنید:")?.trim() || undefined;
      if (!note) return;
    }
    setActingId(row.id);
    try {
      await moderateAdminSubscription(row.id, next, note);
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setActingId(null);
    }
  }

  async function downloadReceipt(row: AdminSubscription) {
    try {
      await downloadAdminSubscriptionReceipt(row.id);
    } catch (requestError) {
      const statusCode = (requestError as { response?: { status?: number } })?.response?.status;
      setError(
        statusCode === 404
          ? "فایل رسید روی سرور یافت نشد."
          : extractApiError(requestError),
      );
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <CreditCard className="h-5 w-5 text-emerald-400" />
          مدیریت اشتراک‌ها و رسیدها
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          رسید پرداخت را بررسی کنید، اشتراک را فعال یا رد کنید. فعال‌سازی، تاریخ‌ها و snapshot امکانات را سرور محاسبه می‌کند.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.key || "all"}
            type="button"
            onClick={() => setStatus(filter.key)}
            className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              status === filter.key
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          تازه‌سازی
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-sm text-slate-500">
          اشتراکی در این وضعیت ثبت نشده است.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[820px] text-right text-xs">
            <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">کسب‌وکار</th>
                <th className="px-4 py-3 font-semibold">پلن (snapshot)</th>
                <th className="px-4 py-3 font-semibold">مبلغ</th>
                <th className="px-4 py-3 font-semibold">بازه</th>
                <th className="px-4 py-3 font-semibold">رسید</th>
                <th className="px-4 py-3 font-semibold">وضعیت</th>
                <th className="px-4 py-3 font-semibold">اقدام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row) => {
                const busy = actingId === row.id;
                return (
                  <tr key={row.id} className="text-slate-300">
                    <td className="max-w-[180px] px-4 py-3">
                      <p className="truncate font-bold text-white">{row.business?.name ?? "—"}</p>
                      {row.receipt_reference && (
                        <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500" dir="ltr">
                          {row.receipt_reference}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.plan_name ?? row.plan?.name ?? "—"}</td>
                    <td className="px-4 py-3">{formatMoney(row.price_amount, row.price_currency)}</td>
                    <td className="px-4 py-3 text-[11px]">
                      {formatDate(row.start_date)} تا {formatDate(row.end_date)}
                    </td>
                    <td className="px-4 py-3">
                      {row.has_receipt ? (
                        <button
                          type="button"
                          onClick={() => void downloadReceipt(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 font-semibold text-cyan-300 hover:bg-cyan-500/20"
                        >
                          <Download className="h-3.5 w-3.5" />
                          دریافت
                        </button>
                      ) : row.receipt_reference ? (
                        <span className="text-[11px] text-slate-400">{row.receipt_reference}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${STATUS_STYLES[row.status] ?? "border-white/10 text-slate-400"}`}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {row.status !== "active" && (
                          <button
                            type="button"
                            onClick={() => void moderate(row, "active")}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            فعال‌سازی
                          </button>
                        )}
                        {row.status === "pending_receipt" && (
                          <button
                            type="button"
                            onClick={() => void moderate(row, "rejected")}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 font-semibold text-rose-300 hover:bg-rose-400/20 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            رد
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
