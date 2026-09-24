"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { extractApiError } from "@/lib/api";
import { getAdminHealth, type AdminHealth } from "@/lib/admin";

export default function AdminHealthTab() {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try { setHealth(await getAdminHealth()); setError(null); } catch (requestError) { setError(extractApiError(requestError)); } finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, []);

  const checks = health ? [['پایگاه داده', health.database.ok, health.database.driver], ['PostGIS', health.postgis.ok, health.postgis.version ?? 'در دسترس نیست'], ['Redis', health.redis.ok, health.redis.ok ? 'متصل' : 'غیرفعال/در دسترس نیست'], ['Storage', health.storage.ok, health.storage.ok ? 'قابل نوشتن' : 'غیرقابل نوشتن']] as const : [];

  return <div className="space-y-6 text-right"><div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-emerald-400" />سلامت سیستم و سوابق</h2><p className="mt-1 text-sm text-slate-400">وضعیت سرویس‌های اصلی و آخرین بررسی زیرساخت.</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/10" title="بازخوانی"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>{error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}{loading && !health ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-400" /></div> : <><div className={`rounded-2xl border p-4 ${health?.status === 'ok' ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-amber-400/30 bg-amber-400/10'}`}><p className="font-bold text-white">وضعیت کلی: {health?.status === 'ok' ? 'سالم' : 'نیازمند بررسی'}</p><p className="mt-1 text-xs text-slate-400">آخرین بررسی: {health?.checked_at}</p></div><div className="grid gap-3 sm:grid-cols-2">{checks.map(([label, ok, detail]) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span>{ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <XCircle className="h-5 w-5 text-rose-400" />}</span><div><p className="text-sm font-bold text-white">{label}</p><p className="text-xs text-slate-400">{detail}</p></div></div>)}</div></>}</div>;
}