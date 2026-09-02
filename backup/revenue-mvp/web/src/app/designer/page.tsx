"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";

type Portfolio = { id: number; title: string; description?: string; status: string; file_path: string };
type Designer = { display_name: string; bio?: string; status: string; portfolios?: Portfolio[] };

export default function DesignerPage() {
  const { user, loading } = useAuth();
  const [designer, setDesigner] = useState<Designer | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!loading && user) api.get<Designer>("/designer/profile").then(({ data }) => { setDesigner(data); setName(data.display_name); setBio(data.bio || ""); }).catch(() => setMessage("پروفایل طراح بارگذاری نشد.")); }, [loading, user]);
  async function saveProfile(e: React.FormEvent) { e.preventDefault(); const { data } = await api.put<Designer>("/designer/profile", { display_name: name, bio }); setDesigner((old) => ({ ...old, ...data } as Designer)); setMessage("پروفایل ذخیره شد."); }
  async function upload(e: React.FormEvent) { e.preventDefault(); if (!file) return; const form = new FormData(); form.append("title", title); form.append("file", file); const { data } = await api.post<Portfolio>("/designer/portfolios", form); setDesigner((old) => old ? { ...old, portfolios: [data, ...(old.portfolios || [])] } : old); setTitle(""); setFile(null); setMessage("نمونه‌کار برای بررسی ارسال شد."); }
  if (loading) return <main className="p-8">در حال بارگذاری…</main>;
  if (!user) return <main className="p-8">برای مدیریت پروفایل طراح ابتدا وارد شوید.</main>;
  return <main dir="rtl" className="min-h-screen bg-surface px-6 py-10"><div className="mx-auto max-w-4xl"><h1 className="text-3xl font-black text-navy-900">پروفایل طراح</h1><form onSubmit={saveProfile} className="mt-8 rounded-3xl border border-navy-100 bg-white p-6"><label className="block text-sm font-semibold">نام نمایشی<input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-navy-200 p-3" /></label><label className="mt-5 block text-sm font-semibold">درباره شما<textarea value={bio} onChange={(e) => setBio(e.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-navy-200 p-3" /></label><button className="mt-5 rounded-xl bg-navy-800 px-5 py-3 font-bold text-white">ذخیره پروفایل</button></form><form onSubmit={upload} className="mt-6 rounded-3xl border border-navy-100 bg-white p-6"><h2 className="text-xl font-bold text-navy-900">افزودن نمونه‌کار</h2><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان نمونه‌کار" className="mt-4 w-full rounded-xl border border-navy-200 p-3" required /><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-4 block w-full text-sm" required /><button className="mt-5 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white">ارسال برای بررسی</button></form>{message && <p role="status" className="mt-5 text-sm text-emerald-700">{message}</p>}<section className="mt-6 grid gap-4 sm:grid-cols-2">{designer?.portfolios?.map((item) => <article key={item.id} className="rounded-2xl border border-navy-100 bg-white p-5"><h3 className="font-bold text-navy-900">{item.title}</h3><p className="mt-2 text-sm text-zinc-500">وضعیت: {item.status === "pending" ? "در انتظار بررسی" : item.status}</p></article>)}</section></div></main>;
}
