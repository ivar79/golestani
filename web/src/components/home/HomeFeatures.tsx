"use client";
import { cms, useHomepageContent } from "@/lib/homepage";
import HomeIcon, { type HomeIconName } from "./HomeIcon";

const FALLBACK_ICONS: HomeIconName[] = ["contactPage", "qrScanner", "search"];

export default function HomeFeatures() {
  const content = useHomepageContent();
  const features = [1, 2, 3].map((n) => ({
    icon: (cms(content, `feature.${n}.icon`) as HomeIconName) || FALLBACK_ICONS[n - 1],
    title: cms(content, `feature.${n}.title`),
    description: cms(content, `feature.${n}.description`),
  }));
  return (
    <section id="features" className="relative z-20 mx-auto -mt-16 w-full px-[clamp(1.25rem,5vw,6rem)]">
      <div className="grid grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-panel/60 p-6 shadow-2xl backdrop-blur-xl md:grid-cols-3 lg:p-8">
        {features.map((feature, index) => (
          <div
            key={index}
            className="group relative flex flex-col items-center gap-4 rounded-2xl p-6 text-center transition-colors hover:bg-white/5"
          >
            {index === 1 && (
              <>
                <div className="absolute inset-y-8 left-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
                <div className="absolute inset-y-8 right-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
              </>
            )}
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border border-secondary/20 bg-secondary/10 shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-transform group-hover:scale-110">
              <HomeIcon name={feature.icon} className="h-8 w-8 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
            <p className="text-sm leading-6 text-surface-variant">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
