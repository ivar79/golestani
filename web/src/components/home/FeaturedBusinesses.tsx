"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Sparkles, Store } from "lucide-react";
import api from "@/lib/api";

type FeaturedBusiness = { id: number; name: string; slug: string; category?: string | null; city?: string | null; neighborhood?: string | null; logo?: string | null; cover_image?: string | null; description?: string | null; is_promoted: boolean };
import { resolveMediaUrl } from "@/lib/businessSafety";

export default function FeaturedBusinesses() {
  const [items, setItems] = useState<FeaturedBusiness[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.get<FeaturedBusiness[]>("/public/businesses/featured")
        .then((response) => {
          if (!cancelled) setItems(Array.isArray(response.data) ? response.data.slice(0, 4) : []);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // No reserved blank space when no business is currently promoted.
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="featured-businesses-title" className="mx-auto mt-16 w-full max-w-7xl px-[clamp(1.25rem,5vw,6rem)]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold text-emerald-300">
            <Sparkles className="h-4 w-4" /> انتخاب‌های برجستهٔ اینکارت
          </p>
          <h2 id="featured-businesses-title" className="mt-2 text-2xl font-black text-white sm:text-3xl">کسب‌وکارهای ویژه</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
            کسب‌وکارهای منتخب را ببینید و مستقیم وارد صفحهٔ اختصاصی آن‌ها شوید.
          </p>
        </div>
        <Link href="/search" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-emerald-300/40 hover:text-white">
          جست‌وجوی همهٔ کسب‌وکارها <ArrowLeft className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((business) => {
          const image = resolveMediaUrl(process.env.NEXT_PUBLIC_API_URL ?? "", business.logo || business.cover_image);
          return (
            <Link
              key={business.id}
              href={`/b/${business.slug}`}
              className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-300/35 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
            >
              <div
                aria-label={image ? `لوگوی ${business.name}` : undefined}
                role={image ? "img" : undefined}
                className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5 text-emerald-200"
                style={image ? { backgroundImage: `url("${image}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
              >
                {!image && <Store className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                  <Sparkles className="h-3 w-3" /> ویژه
                </span>
                <h3 className="mt-1 truncate text-sm font-bold text-white">{business.name}</h3>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {[business.category, business.city].filter(Boolean).join(" · ") || "کسب‌وکار محلی"}
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:-translate-x-1 group-hover:text-emerald-200" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
