"use client";
import { useEffect, useRef, useState } from "react";
import { toPng, toJpeg } from "html-to-image";
import { useAuth } from "@/contexts/AuthContext";
import { listBusinesses, type Business } from "@/lib/businesses";
import api from "@/lib/api";
import CardCanvas from "@/components/cards/CardCanvas";

export default function CardMakerPage() {
  const { user, loading } = useAuth();
  const canvas = useRef<HTMLDivElement>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [template, setTemplate] = useState<"classic" | "midnight" | "emerald">("classic");
  const [theme, setTheme] = useState<"navy" | "emerald" | "warm">("navy");
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [message, setMessage] = useState("");

  useEffect(() => { if (!loading && user) listBusinesses().then((items) => setBusiness(items[0] || null)).catch(() => setMessage("بارگذاری کسب‌وکارها ناموفق بود.")); }, [loading, user]);
  async function exportCard(format: "png" | "jpg") { if (!canvas.current) return; const dataUrl = format === "png" ? await toPng(canvas.current) : await toJpeg(canvas.current, { quality: .95 }); const link = document.createElement("a"); link.download = `inkart-${business?.slug || "card"}.${format}`; link.href = dataUrl; link.click(); await api.put(`/businesses/${business?.id}/card`, { template, theme, font_size: fontSize, export_format: format }); setMessage("کارت با موفقیت آماده شد."); }
  if (loading) return <main className="p-8">در حال بارگذاری…</main>;
  if (!user) return <main className="p-8">برای ساخت کارت ابتدا وارد شوید.</main>;
  if (!business) return <main className="p-8">ابتدا یک کسب‌وکار ثبت کنید.</main>;
  return <main dir="rtl" className="min-h-screen bg-surface px-6 py-10"><div className="mx-auto max-w-6xl"><h1 className="text-3xl font-black text-navy-900">ساخت کارت ویزیت دیجیتال</h1><p className="mt-2 text-zinc-600">یک قالب آماده را انتخاب کنید و کارت خود را به‌صورت PNG یا JPG دریافت کنید.</p><div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.2fr]"><section className="rounded-3xl border border-navy-100 bg-white p-6"><label className="block text-sm font-semibold">قالب کارت<select value={template} onChange={(e) => setTemplate(e.target.value as typeof template)} className="mt-2 w-full rounded-xl border border-navy-200 p-3"><option value="classic">کلاسیک</option><option value="midnight">نیمه‌شب</option><option value="emerald">زمردی</option></select></label><label className="mt-5 block text-sm font-semibold">رنگ<select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className="mt-2 w-full rounded-xl border border-navy-200 p-3"><option value="navy">سرمه‌ای</option><option value="emerald">سبز</option><option value="warm">گرم</option></select></label><label className="mt-5 block text-sm font-semibold">اندازه متن<select value={fontSize} onChange={(e) => setFontSize(e.target.value as typeof fontSize)} className="mt-2 w-full rounded-xl border border-navy-200 p-3"><option value="small">کوچک</option><option value="medium">متوسط</option><option value="large">بزرگ</option></select></label><div className="mt-8 flex gap-3"><button onClick={() => exportCard("png")} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white">دانلود PNG</button><button onClick={() => exportCard("jpg")} className="rounded-xl bg-navy-800 px-5 py-3 font-bold text-white">دانلود JPG</button></div>{message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}</section><section className="flex items-center justify-center rounded-3xl bg-navy-50 p-6"><CardCanvas ref={canvas} business={business} template={template} theme={theme} fontSize={fontSize} /></section></div></div></main>;
}
