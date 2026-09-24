"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { extractApiError } from "@/lib/api";
import { getAdminAudit, type AdminAuditEvent } from "@/lib/admin";

export default function AdminAuditTab() {
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getAdminAudit().then((result) => setEvents(result.data)).catch((requestError) => setError(extractApiError(requestError))).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return <div className="space-y-6 text-right"><div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><History className="h-5 w-5 text-cyan-400" />سوابق مدیریتی</h2><p className="mt-1 text-sm text-slate-400">رخدادهای ثبت‌شده برای عملیات حساس سامانه.</p></div>{error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-400" /></div> : <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-sm"><thead className="bg-white/[0.04] text-xs text-slate-400"><tr><th className="p-3 text-right">رخداد</th><th className="p-3 text-right">موضوع</th><th className="p-3 text-right">مدیر</th><th className="p-3 text-right">زمان</th></tr></thead><tbody className="divide-y divide-white/[0.08]">{events.map((event) => <tr key={event.id}><td className="p-3 font-semibold text-white">{event.event}</td><td className="p-3 text-slate-300">{event.subject_type} #{event.subject_id ?? "-"}</td><td className="p-3 text-slate-400">{event.actor_id ?? "سیستم"}</td><td className="p-3 whitespace-nowrap text-xs text-slate-500">{event.created_at}</td></tr>)}{events.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500">رخدادی ثبت نشده است.</td></tr>}</tbody></table></div>}</div>;
}