"use client";
import Link from "next/link";
import { cms, useHomepageContent } from "@/lib/homepage";
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

export default function HomeCta() {
  const content = useHomepageContent();
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
            className="btn btn-ghost btn-md px-4 text-lg font-semibold text-secondary"
          >
            {cms(content, "cta.button_secondary")}
            <HomeIcon name="arrowLeft" className="btn-arrow h-5 w-5" />
          </a>
          <Link
            href={primaryHref}
            className="btn btn-primary btn-lg"
          >
            {cms(content, "cta.button_primary")}
            <HomeIcon name="rocket" className="btn-arrow h-6 w-6" />
          </Link>
        </div>
      </div>
    </section>
  );
}
