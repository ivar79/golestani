"use client";

import { useEffect, useState } from "react";
import { Database, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { extractApiError } from "@/lib/api";
import { deleteAdminTaxonomy, getAdminTaxonomies, saveAdminTaxonomy, updateAdminTaxonomy, type AdminTaxonomy } from "@/lib/admin";

const types: Array<{ value: AdminTaxonomy["type"]; label: string }> = [
  { value: "category", label: "دسته‌بندی" },
  { value: "service", label: "خدمت" },
  { value: "city", label: "شهر" },
  { value: "neighborhood", label: "محله" },
  { value: "badge", label: "نشان" },
];

export default function AdminTaxonomiesTab() {
  const [type, setType] = useState<AdminTaxonomy["type"]>("category");
  const [rows, setRows] = useState<AdminTaxonomy[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows((await getAdminTaxonomies(type)).data);
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
  }, [type]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveAdminTaxonomy({ type, name: name.trim(), slug: slug.trim() || undefined, is_active: true });
      setName("");
      setSlug("");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: AdminTaxonomy) {
    try {
      await updateAdminTaxonomy(row.id, { is_active: !row.is_active });
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  async function remove(row: AdminTaxonomy) {
    if (!window.confirm(`حذف «${row.name}» انجام شود؟`)) return;
    try {
      await deleteAdminTaxonomy(row.id);
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  return (
    <div className="space-y-6 text-right">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><Database className="h-5 w-5 text-cyan-400" />مدیریت داده‌های پایه</h2><p className="mt-1 text-sm text-slate-400">شهر، محله، دسته‌بندی، خدمات و نشان‌ها از این بخش مدیریت می‌شوند.</p></div>
      {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1.5 text-xs text-slate-300">نوع داده<select value={type} onChange={(event) => setType(event.target.value as AdminTaxonomy["type"])} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400">{types.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="flex-1 space-y-1.5 text-xs text-slate-300">نام<input value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً رستوران" className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /></label>
        <label className="flex-1 space-y-1.5 text-xs text-slate-300">Slug انگلیسی<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="restaurant" dir="ltr" className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /></label>
        <button type="button" onClick={() => void create()} disabled={busy || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-50"><Plus className="h-4 w-4" />افزودن</button>
      </div>
      {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-400" /></div> : <div className="overflow-hidden rounded-2xl border border-white/[0.08]"><table className="w-full text-sm"><thead className="bg-white/[0.04] text-xs text-slate-400"><tr><th className="p-3 text-right">نام</th><th className="p-3 text-right">Slug</th><th className="p-3 text-right">وضعیت</th><th className="p-3 text-left">عملیات</th></tr></thead><tbody className="divide-y divide-white/[0.08]">{rows.map((row) => <tr key={row.id}><td className="p-3 font-semibold text-white">{row.name}</td><td className="p-3 font-mono text-xs text-slate-400" dir="ltr">{row.slug}</td><td className="p-3"><span className={row.is_active ? "text-emerald-300" : "text-slate-500"}>{row.is_active ? "فعال" : "غیرفعال"}</span></td><td className="p-3 text-left"><div className="flex justify-end gap-2"><button type="button" onClick={() => void toggle(row)} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10" title="تغییر وضعیت"><Power className="h-4 w-4" /></button><button type="button" onClick={() => void remove(row)} className="rounded-lg border border-rose-400/20 p-2 text-rose-300 hover:bg-rose-400/10" title="حذف"><Trash2 className="h-4 w-4" /></button></div></td></tr>)}{rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500">موردی ثبت نشده است.</td></tr>}</tbody></table></div>}
    </div>
  );
}