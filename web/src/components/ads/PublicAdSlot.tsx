"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Megaphone } from "lucide-react";
import { getPublicAds, visibleAdsFor, type Advertisement } from "@/lib/ads";
import { resolveMediaUrl, safeHttpUrl } from "@/lib/businessSafety";

type PublicAdSlotName = "home_banner" | "search_top" | "search_side";

export default function PublicAdSlot({ slot }: { slot: PublicAdSlotName }) {
  const [items, setItems] = useState<Advertisement[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getPublicAds(slot)
        .then((ads) => {
          // Defence-in-depth: re-check eligibility (moderation status, slot,
          // schedule window, one position per business) so a STALE cached
          // payload can never render an ad the server already stopped serving.
          if (!cancelled) {
            setItems(visibleAdsFor(ads, slot));
          }
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slot]);

  if (items.length === 0) return null;

  const isHome = slot === "home_banner";
  const sectionClass = isHome
    ? "mx-auto mt-12 w-full max-w-7xl px-[clamp(1.25rem,5vw,6rem)]"
    : "w-full";
  const cardClass = isHome
    ? "border-white/10 bg-white/[0.045] text-white hover:border-emerald-300/30"
    : "border-ik-border bg-ik-panel text-ik-text hover:border-ik-accent/40";

  return (
    <section aria-label="تبلیغات" data-ad-slot={slot} className={sectionClass}>
      {isHome && (
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-300">SPONSORED</p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">تبلیغات و پیشنهادهای ویژه</h2>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-slate-300">تبلیغ</span>
        </div>
      )}
      <div className={`grid gap-3 ${slot === "search_side" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {items.map((ad) => {
          const href = safeHttpUrl(ad.target_url);
          const image = resolveMediaUrl(process.env.NEXT_PUBLIC_API_URL ?? "", ad.image_path);
          return (
            <article
              key={ad.id}
              className={`group flex min-w-0 items-center gap-3 rounded-2xl border p-4 transition-colors ${cardClass}`}
            >
              <div
                aria-hidden="true"
                className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl ${isHome ? "bg-white/10 text-emerald-200" : "bg-ik-wash text-ik-accent"}`}
                style={image ? { backgroundImage: `url("${image}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
              >
                {!image && <Megaphone className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${isHome ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-ik-accent/25 bg-ik-accent/10 text-ik-accent"}`}>
                  تبلیغ
                </span>
                <h3 className="mt-1 line-clamp-2 text-sm font-bold">{ad.title || "پیشنهاد ویژه"}</h3>
              </div>
              {href && (
                <Link
                  href={href}
                  target="_blank"
                  rel="sponsored noopener noreferrer"
                  className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-bold transition-colors ${isHome ? "bg-emerald-300 text-slate-950 hover:bg-emerald-200" : "bg-ik-accent text-ik-accent-contrast hover:bg-ik-accent-hover"}`}
                >
                  مشاهده <ArrowLeft className="h-3.5 w-3.5" />
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
