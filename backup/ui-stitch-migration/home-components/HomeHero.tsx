"use client";
import Link from "next/link";
import { cms, useHomepageContent } from "@/lib/homepage";
import HomeIcon from "./HomeIcon";

export default function HomeHero() {
  const content = useHomepageContent();
  const title = cms(content, "hero.title");
  const subtitle = cms(content, "hero.subtitle");
  const badge = cms(content, "hero.badges");
  const primaryLabel = cms(content, "hero.button_primary");
  const primaryHref = cms(content, "hero.button_primary_link") || "/login";
  const secondaryLabel = cms(content, "hero.button_secondary");
  const secondaryHref = cms(content, "hero.button_secondary_link") || "#showcase";
  const heroImage = cms(content, "hero.image");
  const background = cms(content, "hero.background");
  const cardTitle = cms(content, "hero.card_title");
  const cardSubtitle = cms(content, "hero.card_subtitle");
  const cardPhone = cms(content, "hero.card_phone");
  const cardLocation = cms(content, "hero.card_location");

  return (
    <section
      className="relative z-10 mx-auto flex w-full max-w-7xl flex-col-reverse items-center gap-12 px-4 pb-24 pt-24 md:px-8 lg:flex-row lg:gap-8 lg:pb-40 lg:pt-32"
      style={background ? { backgroundImage: `url(${background})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-b-3xl">
        <div className="absolute -left-1/4 bottom-0 h-[600px] w-[600px] rounded-full bg-primary/20 blur-[100px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-night" />
      </div>

      {/* Content (right in RTL) */}
      <div className="z-10 flex flex-1 flex-col items-start gap-6">
        {badge && (
          <div className="inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary/10 px-4 py-2 text-sm font-medium text-secondary">
            <HomeIcon name="verified" className="h-[18px] w-[18px]" />
            {badge}
          </div>
        )}
        <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-white md:text-5xl">
          {title}
        </h1>
        <p className="max-w-xl text-lg leading-7 text-surface-variant">
          {subtitle}
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link
            href={primaryHref}
            className="flex items-center gap-2 rounded-xl bg-secondary px-8 py-4 text-lg font-semibold text-white shadow-[0_0_20px_rgba(0,108,74,0.4)] transition-all hover:bg-secondary-container hover:text-night"
          >
            {primaryLabel}
            <HomeIcon name="arrowLeft" className="h-6 w-6" />
          </Link>
          <Link
            href={secondaryHref}
            className="rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-white/10"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>

      {/* Hero visual (left in RTL): CMS image if set, otherwise CSS-built digital card mockup */}
      <div className="relative z-10 flex h-[400px] w-full flex-1 items-center justify-center lg:h-[600px]">
        {heroImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={heroImage}
            alt={title}
            className="max-h-full w-auto max-w-full rounded-3xl border border-white/10 object-contain shadow-[0_0_30px_rgba(0,108,74,0.2)]"
          />
        ) : (
          <div className="group relative flex h-full w-full items-center justify-center p-4 md:p-8">
            <div className="relative aspect-square w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-panel via-primary-container to-night shadow-[0_0_30px_rgba(0,108,74,0.2)] transition-transform duration-700 group-hover:scale-105">
              <div className="absolute inset-0 bg-gradient-to-t from-night via-transparent to-transparent opacity-40" />
              <div className="absolute inset-6 flex flex-col rounded-2xl border border-white/10 bg-panel-deep/80 p-6 backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-lg font-black text-white">اَ</div>
                  <div>
                    <p className="text-sm font-bold text-white">{cardTitle}</p>
                    <p className="text-xs text-surface-variant">{cardSubtitle}</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-2">
                  <div className="h-2.5 w-4/5 rounded-full bg-secondary/60" />
                  <div className="h-2.5 w-3/5 rounded-full bg-white/15" />
                  <div className="h-2.5 w-2/5 rounded-full bg-white/10" />
                </div>
                <div className="mt-auto flex items-end justify-between">
                  <div className="space-y-1.5 text-xs text-surface-variant">
                    <p className="flex items-center gap-1.5"><HomeIcon name="phone" className="h-3.5 w-3.5 text-secondary" /> {cardPhone}</p>
                    <p className="flex items-center gap-1.5"><HomeIcon name="location" className="h-3.5 w-3.5 text-secondary" /> {cardLocation}</p>
                  </div>
                  <div className="rounded-lg bg-white p-1.5">
                    <HomeIcon name="qr" className="h-12 w-12 text-night" strokeWidth={1.4} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
