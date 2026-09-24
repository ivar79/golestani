"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Palette, XCircle } from "lucide-react";
import { extractApiError } from "@/lib/api";
import { getAdminDesigners, moderateAdminDesigner, type AdminDesigner } from "@/lib/admin";

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

export default function AdminDesignersTab() {
  const [rows, setRows] = useState<AdminDesigner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows((await getAdminDesigners()).data); setError(null); } catch (requestError) { setError(extractApiError(requestError)); } finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, []);

  async function moderate(row: AdminDesigner, status: "approved" | "rejected" | "suspended") {
    try { await moderateAdminDesigner(row.id, status, status === "rejected" ? "نیازمند اصلاح اطلاعات یا نمونه‌کار است." : undefined); await refresh(); } catch (requestError) { setError(extractApiError(requestError)); }
  }

  return <div className="space-y-6 text-right"><div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><Palette className="h-5 w-5 text-fuchsia-400" />مدیریت طراحان</h2><p className="mt-1 text-sm text-slate-400">پروفایل طراحان، کد معرفی و کسب‌وکارهای منتسب را بررسی کنید.</p></div>{error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-fuchsia-400" /></div> : <div className="grid gap-3">{rows.map((row) => <div key={row.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-white">{row.display_name}</p><p className="mt-1 font-mono text-xs text-fuchsia-300" dir="ltr">{row.referral_code}</p><p className="mt-1 text-xs text-slate-400">{row.businesses_count} کسب‌وکار منتسب · {row.user?.phone ?? "بدون تماس"}</p></div><div className="flex items-center gap-2"><span className={`rounded-lg border px-2 py-1 text-xs ${STATUS_STYLES[row.status] ?? "border-white/10 text-slate-400"}`}>{STATUS_LABELS[row.status] ?? row.status}</span><button type="button" onClick={() => void moderate(row, "approved")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />تأیید</button><button type="button" onClick={() => void moderate(row, "rejected")} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"><XCircle className="h-4 w-4" />رد</button><button type="button" onClick={() => void moderate(row, "suspended")} className="inline-flex items-center gap-1 rounded-lg border border-slate-400/30 bg-slate-400/10 px-3 py-2 text-xs text-slate-300">تعلیق</button></div></div>)}{rows.length === 0 && <p className="rounded-xl border border-white/10 p-8 text-center text-sm text-slate-500">طراحی برای بررسی ثبت نشده است.</p>}</div>}</div>;
}