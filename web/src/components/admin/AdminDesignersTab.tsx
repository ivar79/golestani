"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Palette, ShieldCheck, XCircle } from "lucide-react";
import { extractApiError } from "@/lib/api";
import {
  getAdminDesigners,
  getStudioReport,
  moderateAdminDesigner,
  saveAdminSetting,
  type AdminDesigner,
  type StudioAccessReport,
} from "@/lib/admin";

const STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار بررسی",
  approved: "تأییدشده",
  rejected: "ردشده",
  suspended: "تعلیق‌شده",
};
const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  suspended: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

/** One number tile of the rollout board. */
function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default function AdminDesignersTab() {
  const [rows, setRows] = useState<AdminDesigner[]>([]);
  const [report, setReport] = useState<StudioAccessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [designers, studio] = await Promise.all([getAdminDesigners(), getStudioReport()]);
      setRows(designers.data);
      setReport(studio);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function moderate(row: AdminDesigner, status: "approved" | "rejected" | "suspended") {
    try {
      await moderateAdminDesigner(row.id, status, status === "rejected" ? "نیازمند اصلاح اطلاعات یا نمونه‌کار است." : undefined);
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  /**
   * Staged rollout: while `studio_designer_only` is '0' the designer-only
   * studio gate is dormant; flipping it to '1' enforces designer approval +
   * the designer_studio capability on every Level B write.
   */
  async function toggleGate(next: boolean) {
    setBusy(true);
    try {
      await saveAdminSetting("studio_designer_only", next ? "1" : "0");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setBusy(false);
    }
  }

  const statusCount = (status: string) => report?.users.by_designer_status?.[status] ?? 0;

  return (
    <div className="space-y-6 text-right">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Palette className="h-5 w-5 text-fuchsia-400" />
          مدیریت طراحان
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          پروفایل طراحان، کد معرفی، کسب‌وکارهای منتسب و دروازهٔ «استودیوی طراحی» را بررسی کنید.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && !report ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-fuchsia-400" />
        </div>
      ) : (
        <>
          {report && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">دروازهٔ استودیوی طراحی</h3>
                  <span
                    className={`rounded-lg border px-2 py-0.5 text-[11px] ${
                      report.gate.enforced
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                    }`}
                  >
                    {report.gate.enforced ? "اجرا فعال است" : "غیرفعال (راه‌اندازی مرحله‌ای)"}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleGate(!report.gate.enforced)}
                  className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {report.gate.enforced ? "غیرفعال‌کردن اجرای دروازه" : "فعال‌کردن اجرای دروازه"}
                </button>
              </div>

              <p className="mt-2 text-[11px] leading-5 text-slate-400">
                تا وقتی این دروازه غیرفعال است، رفتار قبلی برقرار می‌ماند. با فعال‌کردن آن، ویرایش و ذخیرهٔ سند
                لایه‌ای (و قالب شخصی، ارسال به گالری و جایگزینی فایل چاپی روی کارت لایه‌ای) فقط برای طراحِ
                تأییدشده‌ای مجاز است که پلن همان کسب‌وکار امکان «استودیو طراحی» را داشته باشد. تیم مدیر با
                ثبت حسابرسی‌شده از این دروازه عبور می‌کند.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="طراحان تأییدشده" value={statusCount("approved")} hint={`از ${report.users.total} کاربر`} />
                <Stat
                  label="تأییدشده بدون کسب‌وکار"
                  value={report.users.approved_without_business}
                  hint="استودیو برایشان قابل استفاده نیست"
                />
                <Stat
                  label="کسب‌وکار دارای استودیو"
                  value={report.businesses.with_designer_studio}
                  hint={`از ${report.businesses.total} کسب‌وکار`}
                />
                <Stat label="عبور حسابرسی‌شدهٔ مدیران" value={report.admin_bypasses.total} hint="رویداد admin.studio_bypass" />
              </div>

              {(report.users.divergent.length > 0 ||
                report.users.backfill_candidates.length > 0 ||
                report.users.role_without_approval.length > 0) && (
                <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    ناهم‌خوانی وضعیت طراحان
                  </p>
                  {report.users.divergent.length > 0 && (
                    <p className="mt-2 text-[11px] text-amber-100/90">
                      {report.users.divergent.length} کاربر بین وضعیت رسمی و پروفایل قدیمی طراح اختلاف دارند؛ وضعیت
                      رسمی (ستون «وضعیت طراح» در تب کاربران) مرجع است.
                    </p>
                  )}
                  {report.users.backfill_candidates.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-100/90">
                      {report.users.backfill_candidates.length} کاربر دارای ردیف قدیمی طراح و وضعیت رسمیِ تعیین‌نشده‌اند —
                      پیش از اجرای studio:backfill-designers --apply این فهرست را انسانی مرور کنید (داشتن نقش طراح یا
                      اشتراک به‌تنهایی تأیید صلاحیت نیست).
                    </p>
                  )}
                  {report.users.role_without_approval.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-100/90">
                      {report.users.role_without_approval.length} کاربر نقش طراح دارند اما وضعیت رسمی‌شان تأیید نشده —
                      برای جلوگیری از قطع دسترسی، وضعیتشان را از تب کاربران بررسی کنید.
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-amber-100/60">
                    پس از افزودن امکان «استودیو طراحی» به پلن‌ها، ابتدا دستور subscriptions:refresh-snapshot را
                    با --only=designer_studio و بدون --apply اجرا کنید (حالت افزودنی، هیچ کلید موجودی تغییر نمی‌کند).
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3">
            {rows.map((row) => {
              const canonical = row.user?.designer_status ?? "none";
              const divergent = row.user?.designer_status !== undefined && canonical !== row.status;
              return (
                <div
                  key={row.id}
                  className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-bold text-white">{row.display_name}</p>
                    <p className="mt-1 font-mono text-xs text-fuchsia-300" dir="ltr">
                      {row.referral_code}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.businesses_count} کسب‌وکار منتسب · {row.user?.phone ?? "بدون تماس"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg border px-2 py-1 text-xs ${STATUS_STYLES[row.status] ?? "border-white/10 text-slate-400"}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                    {divergent && (
                      <span
                        className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-300"
                        title={`وضعیت رسمی: ${STATUS_LABELS[canonical] ?? canonical}`}
                      >
                        ناهم‌خوانی با وضعیت رسمی
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void moderate(row, "approved")}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      تأیید
                    </button>
                    <button
                      type="button"
                      onClick={() => void moderate(row, "rejected")}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"
                    >
                      <XCircle className="h-4 w-4" />
                      رد
                    </button>
                    <button
                      type="button"
                      onClick={() => void moderate(row, "suspended")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-400/30 bg-slate-400/10 px-3 py-2 text-xs text-slate-300"
                    >
                      تعلیق
                    </button>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <p className="rounded-xl border border-white/10 p-8 text-center text-sm text-slate-500">
                طراحی برای بررسی ثبت نشده است.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
