"use client";
import { cms, cmsList, useHomepageContent } from "@/lib/homepage";
import HomeIcon from "./HomeIcon";

type ShowcaseCard = { title: string; subtitle: string };

const FALLBACK_CARDS: ShowcaseCard[] = [];

export default function DigitalCardShowcase() {
  const content = useHomepageContent();
  const title = cms(content, "showcase.title");
  const cards = cmsList<ShowcaseCard>(content, "showcase.cards", FALLBACK_CARDS);

  return (
    <div className="flex flex-col rounded-3xl border border-white/5 bg-panel/40 p-8 backdrop-blur-lg">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
      </div>
      <div className="mask-edge-fade -mx-4 flex gap-4 overflow-hidden px-4 py-4">
        {cards.map((card, i) => (
          <div
            key={i}
            className="group relative flex h-[220px] min-w-[160px] flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-[#1a233a] to-[#0a1128] p-3 shadow-lg transition-transform hover:-translate-y-2"
          >
            <div className="relative z-10 flex h-full flex-col items-center justify-between">
              <div className="mt-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-panel text-sm font-black text-secondary">اَ</div>
              <div className="mt-2 w-full truncate text-center text-sm font-medium text-white">
                {card.title}
                <div className="w-full truncate text-[10px] text-surface-variant">{card.subtitle}</div>
              </div>
              <div className="mt-auto w-full rounded-md bg-white p-1">
                <HomeIcon name="qr" className="aspect-square w-full text-night" strokeWidth={1.2} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <div className="h-2 w-2 rounded-full bg-secondary" />
        <div className="h-2 w-2 rounded-full bg-white/20" />
        <div className="h-2 w-2 rounded-full bg-white/20" />
        <div className="h-2 w-2 rounded-full bg-white/20" />
      </div>
    </div>
  );
}
