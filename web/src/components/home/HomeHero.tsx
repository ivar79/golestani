"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { cms, useHomepageContent } from "@/lib/homepage";
import HeroVideo from "./HeroVideo";

// Phase 3.5 perf: SearchModal (و زنجیرهٔ iranGeo/taxonomies/axios) فقط روی تعامل
// کاربر لازم است — dynamic import آن را از initial bundle صفحهٔ اصلی خارج می‌کند
// (هم‌الگوی AppTaskbar). خود مودال دست‌نخورده است.
const SearchModal = dynamic(
  () => import("@/components/search/SearchModal"),
  { ssr: false, loading: () => null },
);

/** Render the hero title with the accent word (from CMS) highlighted in emerald. */
function Title({ content }: { content: Record<string, string> }) {
  const full = cms(content, "hero.title");
  const accent = cms(content, "hero.title_accent");
  if (!accent || !full.includes(accent)) return <>{full}</>;
  const parts = full.split(accent);
  return (
    <>
      {parts[0]}
      <span className="text-secondary">{accent}</span>
      {parts.slice(1).join(accent)}
    </>
  );
}

export default function HomeHero() {
  const content = useHomepageContent();
  const [searchOpen, setSearchOpen] = useState(false);
  const title = cms(content, "hero.title");
  const subtitle = cms(content, "hero.subtitle");
  const badge = cms(content, "hero.badges");
  const primaryLabel = cms(content, "hero.button_primary");
  const primaryHref = cms(content, "hero.button_primary_link") || "/card-maker";
  const secondaryLabel = cms(content, "hero.button_secondary");
  const secondaryHref = cms(content, "hero.button_secondary_link") || "#showcase";
  // Design source: hero VISUAL = 2.jpg (phone + floating cards), BACKGROUND =
  // animated particle-wave video (1.mp4) — formerly the static 1.jpg aurora.
  const heroImage = cms(content, "hero.image") || "/assets/hero-2.jpg";

  // Global keyboard shortcut (Cmd+K / Ctrl+K) to open search modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Rendered as a root-level fragment sibling (NOT inside the section): the
  // section creates a z-10 stacking context that would otherwise trap the
  // fixed, z-50 modal beneath the taskbar (z-50) and scroll progress line
  // (z-60). Root-level placement matches the AppTaskbar's (correct) pattern,
  // so both search buttons behave identically. The modal itself is untouched.
  return (
    <>
      <section className="relative z-10 w-full overflow-hidden pb-24 pt-32 lg:pb-40">
      {/* Full-bleed atmospheric background — the animated particle-wave video
          (looping, muted) plays where the static aurora (1.jpg) used to sit.
          Same mix-blend-lighten treatment, same overlay stack. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <HeroVideo />
        <div className="absolute -left-[10%] bottom-0 h-[640px] w-[640px] rounded-full bg-primary/25 blur-[120px]" />
        <div className="absolute -right-[10%] top-0 h-[520px] w-[520px] rounded-full bg-secondary/10 blur-[120px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-night" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-transparent to-transparent opacity-60" />
      </div>

      {/* Content container — now fills the full viewport (fluid padding instead of a
          fixed 1280px box) so a wide monitor has no empty dark sides. The aurora
          background (1.jpg) stays full-bleed behind it. */}
      <div className="mx-auto flex w-full flex-col-reverse items-center gap-12 px-[clamp(1.5rem,6vw,7rem)] lg:flex-row lg:gap-12">
        {/* Content (right in RTL) */}
        <div className="z-10 flex flex-[1.25] flex-col items-start gap-6 w-full">
          {badge && (
            <div className="inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary/10 px-4 py-2 text-sm font-medium text-secondary">
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2l2.4 1.8 3-.2 1 2.8 2.4 1.8-.9 2.9.9 2.9-2.4 1.8-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8-2.4-1.8.9-2.9-.9-2.9 2.4-1.8 1-2.8 3 .2L12 2z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              {badge}
            </div>
          )}
          <h1 className="text-right text-[34px] font-extrabold leading-[1.15] tracking-tight text-white md:text-[52px] lg:text-[56px]">
            <Title content={content} />
          </h1>
          <p className="max-w-xl text-lg leading-8 text-surface-variant">{subtitle}</p>

          {/* Airbnb / Command Palette Style Search Trigger — opens the exact SearchModal */}
          <div className="w-full max-w-xl">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 sm:p-3 shadow-xl shadow-black/30 backdrop-blur-md transition-all duration-200 hover:border-cyan-400/40 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
              aria-label="جستجوی کسب‌وکارها، خدمات یا مکان‌ها"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-400 transition-colors group-hover:bg-cyan-500/20">
                  <Search className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="flex flex-col items-start text-right">
                  <span className="text-[14px] sm:text-[15px] font-medium text-slate-200 group-hover:text-white transition-colors">
                    جستجوی کسب‌وکارها، خدمات یا مکان‌ها...
                  </span>
                  <span className="hidden sm:inline-block text-[12px] text-slate-400">
                    رستوران، زیبایی، آموزش، خدمات و سراسر کشور
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pl-1">
                <kbd className="hidden sm:inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-mono text-slate-400">
                  ⌘K
                </kbd>
                <span className="rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-3.5 py-1.5 text-xs font-semibold text-cyan-300 transition-all group-hover:bg-cyan-500/25 group-hover:text-white">
                  کاوش
                </span>
              </div>
            </button>
          </div>

          {/* Business Owner Pathway & Action Buttons */}
          <div className="mt-2 flex flex-col gap-3 w-full">
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href={primaryHref}
                className="group inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-8 py-3.5 text-lg font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]"
              >
                {primaryLabel}
                <svg className="h-6 w-6 transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-x-[3px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6" /></svg>
              </Link>
              <Link
                href={secondaryHref}
                className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/12 bg-white/[0.06] px-8 py-3.5 text-lg font-semibold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[8px] transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-white/20 hover:bg-white/[0.12] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] active:translate-y-0 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]"
              >
                {secondaryLabel}
              </Link>
            </div>
            <p className="text-[13px] text-slate-400">
              ویژه صاحبان مشاغل: ساخت کارت ویزیت دیجیتال، گالری ویترین اختصاصی و QR اختصاصی
            </p>
          </div>
        </div>

        {/* Hero visual (left in RTL): phone mockup (2.jpg) */}
        <div className="relative z-10 flex h-[500px] w-full flex-1 items-center justify-center lg:h-[600px]">
          <div className="group relative aspect-square w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/10 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
            <Image
              src={heroImage}
              alt={title || "کارت ویزیت دیجیتال اینکارت"}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 512px"
              className="object-cover transition-transform duration-700 group-hover:scale-110"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-night via-transparent to-transparent opacity-40" />
          </div>
        </div>
      </div>

      </section>

      {/* Render the exact SearchModal (100% frozen, untouched) — root-level so
          it stacks above the taskbar like the taskbar's own search modal. */}
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
