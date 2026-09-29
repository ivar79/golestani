import Link from "next/link";
import { cms, type HomepageContent } from "@/lib/homepageContent";
import HomeIcon from "./HomeIcon";

/** Subtitle with the CMS accent phrase highlighted in emerald (design: "رایگان شروع کنید"). */
function Subtitle({ content }: { content: Record<string, string> }) {
  const full = cms(content, "cta.subtitle");
  const accent = cms(content, "cta.subtitle_accent");
  if (!accent || !full.includes(accent)) return <>{full}</>;
  const [before, ...rest] = full.split(accent);
  return (
    <>
      {before}
      <span className="text-secondary">{accent}</span>
      {rest.join(accent)}
    </>
  );
}

// Phase 3.5 perf: Server Component — محتوا به‌صورت prop از صفحهٔ اصلی می‌آید.
export default function HomeCta({ content }: { content: HomepageContent }) {
  const secondaryHref = cms(content, "cta.button_secondary_link") || "#features";
  const primaryHref = cms(content, "cta.button_primary_link") || "/login";
  return (
    <section className="mx-auto mt-24 w-full px-[clamp(1.25rem,5vw,6rem)]">
      <div className="relative flex w-full flex-col items-center justify-between gap-8 overflow-hidden rounded-3xl border border-white/10 bg-cta-deep p-8 shadow-2xl md:flex-row md:p-12">
        {/* Glow effects */}
        <div className="pointer-events-none absolute right-0 top-1/2 h-[300px] w-[300px] -translate-y-1/2 rounded-full bg-secondary/20 blur-[80px]" />
        <div className="pointer-events-none absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="relative z-10 flex flex-col gap-3">
          <h2 className="text-3xl font-bold text-white">{cms(content, "cta.title")}</h2>
          <p className="text-lg text-surface-variant">
            <Subtitle content={content} />
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-4">
          <a
            href={secondaryHref}
            className="group inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-4 py-3 text-lg font-semibold leading-none text-secondary transition-[transform,box-shadow] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)]"
          >
            {cms(content, "cta.button_secondary")}
            <HomeIcon name="arrowLeft" className="h-5 w-5 transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-x-[3px]" />
          </a>
          <Link
            href={primaryHref}
            className="group inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-8 py-3.5 text-lg font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]"
          >
            {cms(content, "cta.button_primary")}
            <HomeIcon name="rocket" className="h-6 w-6 transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-x-[3px]" />
          </Link>
        </div>
      </div>
    </section>
  );
}
