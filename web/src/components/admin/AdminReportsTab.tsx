"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { extractApiError } from "@/lib/api";
import { getAdminReports, moderateAdminReport, type AdminBusinessReport } from "@/lib/admin";

export default function AdminReportsTab() {
  const [rows, setRows] = useState<AdminBusinessReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows((await getAdminReports()).data); setError(null); } catch (requestError) { setError(extractApiError(requestError)); } finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, []);

  async function moderate(row: AdminBusinessReport, status: "resolved" | "rejected") {
    try { await moderateAdminReport(row.id, status, status === "resolved" ? "گزارش بررسی شد." : "گزارش پس از بررسی تأیید نشد."); await refresh(); } catch (requestError) { setError(extractApiError(requestError)); }
  }

  return <div className="space-y-6 text-right"><div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><AlertTriangle className="h-5 w-5 text-amber-400" />گزارش‌های مردمی</h2><p className="mt-1 text-sm text-slate-400">گزارش‌های ثبت‌شده درباره اطلاعات کسب‌وکارها را بررسی کنید.</p></div>{error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></div> : <div className="grid gap-3">{rows.map((row) => <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-white">{row.business?.name ?? "کسب‌وکار حذف‌شده"}</p><p className="mt-1 text-xs text-slate-400">نوع: {row.type} · وضعیت: {row.status}</p></div><div className="flex gap-2"><button type="button" onClick={() => void moderate(row, "resolved")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />حل شد</button><button type="button" onClick={() => void moderate(row, "rejected")} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">رد گزارش</button></div></div><p className="mt-3 rounded-xl bg-slate-950/50 p-3 text-sm leading-7 text-slate-300">{row.message}</p></div>)}{rows.length === 0 && <p className="rounded-xl border border-white/10 p-8 text-center text-sm text-slate-500">گزارش بازی برای بررسی وجود ندارد.</p>}</div>}</div>;
}