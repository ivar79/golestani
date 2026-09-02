"use client";
import { cms, cmsList, useHomepageContent } from "@/lib/homepage";
import HomeIcon, { type HomeIconName } from "./HomeIcon";

type Step = { icon?: string; title: string; description: string };
const FALLBACK_ICONS: HomeIconName[] = ["storefront", "badge", "groups"];

export default function HowItWorks() {
  const content = useHomepageContent();
  const title = cms(content, "howitworks.title");
  const steps = cmsList<Step>(content, "howitworks.steps").map((s, i) => ({
    icon: (s.icon as HomeIconName) || FALLBACK_ICONS[i % 3],
    num: `۰${i + 1}`,
    title: s.title,
    description: s.description,
  }));

  return (
    <div className="relative flex flex-col overflow-hidden rounded-3xl border border-white/5 bg-panel/40 p-8 backdrop-blur-lg">
      <h2 className="mb-12 text-center text-2xl font-bold text-white">{title}</h2>
      {/* Neon wave */}
      <div className="pointer-events-none absolute inset-0 top-32 opacity-40">
        <svg className="h-32 w-full" preserveAspectRatio="none" viewBox="0 0 1000 200">
          <path className="animate-dash" d="M0,100 Q250,0 500,100 T1000,100" fill="none" stroke="url(#neon-grad)" strokeDasharray="10 5" strokeWidth="3" />
          <defs>
            <linearGradient id="neon-grad" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor="#006c4a" stopOpacity="0" />
              <stop offset="50%" stopColor="#82f5c1" />
              <stop offset="100%" stopColor="#006c4a" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="relative z-10 flex items-start justify-between">
        {steps.map((step, index) => (
          <div key={step.num} className={`flex flex-1 flex-col items-center text-center ${index === 1 ? "pt-8" : ""}`}>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-secondary/50 bg-night shadow-[0_0_20px_rgba(0,108,74,0.3)]">
              <HomeIcon name={step.icon} className="h-7 w-7 text-secondary" />
            </div>
            <div className="mb-1 font-bold text-secondary">{step.num}</div>
            <h4 className="mb-2 text-lg font-semibold text-white">{step.title}</h4>
            <p className="max-w-[180px] text-sm leading-5 text-surface-variant">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
