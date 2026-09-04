"use client";
import Link from "next/link";
import Image from "next/image";
import { cms, useHomepageContent } from "@/lib/homepage";

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
  const title = cms(content, "hero.title");
  const subtitle = cms(content, "hero.subtitle");
  const badge = cms(content, "hero.badges");
  const primaryLabel = cms(content, "hero.button_primary");
  const primaryHref = cms(content, "hero.button_primary_link") || "/login";
  const secondaryLabel = cms(content, "hero.button_secondary");
  const secondaryHref = cms(content, "hero.button_secondary_link") || "#showcase";
  // Design source: hero VISUAL = 2.jpg (phone + floating cards), BACKGROUND = 1.jpg (aurora).
  const heroImage = cms(content, "hero.image") || "/assets/hero-2.jpg";
  const background = cms(content, "hero.background") || "/assets/hero-1.jpg";

  return (
    <section className="relative z-10 w-full overflow-hidden pb-24 pt-32 lg:pb-40">
      {/* Full-bleed atmospheric background (aurora) — spans the whole viewport so
          the desktop hero is not empty on the sides. Content stays in a 1280px box. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <Image
          src={background}
          alt=""
          aria-hidden="true"
          fill
          sizes="100vw"
          priority
          className="object-cover opacity-40 mix-blend-lighten"
        />
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
        <div className="z-10 flex flex-[1.25] flex-col items-start gap-6">
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
          <div className="mt-4 flex flex-wrap gap-4">
            <Link
              href={primaryHref}
              className="btn btn-primary btn-lg"
            >
              {primaryLabel}
              <svg className="btn-arrow h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6" /></svg>
            </Link>
            <Link
              href={secondaryHref}
              className="btn btn-secondary btn-lg"
            >
              {secondaryLabel}
            </Link>
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
  );
}
