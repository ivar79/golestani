"use client";
import { useEffect, useState } from "react";
import { getHomepageContent } from "@/lib/businesses";
import HomeIcon, { type HomeIconName } from "./HomeIcon";

const features: { icon: HomeIconName; title: string; description: string }[] = [
  {
    icon: "contactPage",
    title: "", description: "",
  },
  {
    icon: "qrScanner",
    title: "", description: "",
  },
  {
    icon: "search",
    title: "", description: "",
  },
];

export default function HomeFeatures() {
  const [content, setContent] = useState<Record<string,string>>({});
  useEffect(() => { getHomepageContent().then(setContent).catch(() => undefined); }, []);
  const featureContent = [1,2,3].map((n) => ({ title: content[`homepage.feature.${n}.title`] || "", description: content[`homepage.feature.${n}.description`] || "" }));
  return (
    <section id="features" className="relative z-20 mx-auto -mt-16 w-full max-w-7xl px-4 md:px-8">
      <div className="grid grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-panel/60 p-6 shadow-2xl backdrop-blur-xl md:grid-cols-3 lg:p-8">
        {features.map((feature, index) => { const copy = featureContent[index]; return (
          <div
            key={feature.title}
            className="group relative flex flex-col items-center gap-4 rounded-2xl p-6 text-center transition-colors hover:bg-white/5"
          >
            {index === 1 && (
              <>
                <div className="absolute inset-y-8 left-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
                <div className="absolute inset-y-8 right-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
              </>
            )}
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border border-secondary/20 bg-secondary/10 shadow-[0_0_15px_rgba(0,108,74,0.2)] transition-transform group-hover:scale-110">
              <HomeIcon name={feature.icon} className="h-8 w-8 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold text-white">{copy.title}</h3>
            <p className="text-sm leading-6 text-surface-variant">{copy.description}</p>
          </div>
        ); })}
      </div>
    </section>
  );
}
