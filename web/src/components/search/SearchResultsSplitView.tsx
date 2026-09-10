"use client";

import { useCallback, useRef, useState } from "react";
import { LayoutList, Map as MapIcon } from "lucide-react";
import MapViewLazy, { type MapMarker } from "@/components/map/MapViewLazy";
import type { MapSourceMode } from "@/lib/mapSource";

/**
 * SearchResultsSplitView — task 10.
 *
 * Desktop: two columns — results list on the right, full-height sticky map
 * on the left (RTL layout). Mobile: a floating segmented switch toggles
 * between «نقشه» and «لیست» with smooth mount/unmount.
 *
 * Two-way sync: marker click → popup + smooth scroll + neon ring highlight
 * on the matching card; card focus (hover/click) → map marker highlight.
 */

export type SplitViewCardData = {
  id: number;
  slug: string;
  name: string;
  category?: string;
  city?: string;
  neighborhood?: string;
  verification_badge?: boolean;
  distance?: number | null;
  featured?: boolean;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SearchResultsSplitViewProps = {
  markers: MapMarker[];
  cards: SplitViewCardData[];
  /** Renders one list card (the page passes its MiniCard factory). */
  renderCard: (card: SplitViewCardData, state: { selected: boolean }) => React.ReactNode;
  center?: [number, number];
  userCoords?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  sourceMode?: MapSourceMode;
  loading?: boolean;
  emptyState?: React.ReactNode;
};

export default function SearchResultsSplitView({
  markers,
  cards,
  renderCard,
  center,
  userCoords,
  onPick,
  sourceMode = "auto",
  loading = false,
  emptyState,
}: SearchResultsSplitViewProps) {
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const cardRefs = useRef<Map<number | string, HTMLDivElement | null>>(new Map());

  const handleSelectMarker = useCallback((id: number | string) => {
    setSelectedId(id);
    if (id === "__user__") return;
    // Two-way sync: marker click → scroll the card into view (desktop list).
    const el = cardRefs.current.get(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleFocusCard = useCallback((id: number) => {
    setSelectedId(id);
  }, []);

  const mapPane = (
    <div className="h-full min-h-[420px] w-full">
      <MapViewLazy
        className="h-[420px] w-full lg:h-full lg:min-h-0"
        markers={markers}
        center={center}
        userCoords={userCoords ? { lat: userCoords.lat, lng: userCoords.lng } : null}
        onPick={onPick}
        onSelectMarker={handleSelectMarker}
        selectedId={selectedId}
        sourceMode={sourceMode}
      />
    </div>
  );

  const listPane = (
    <div className="grid content-start gap-4 p-4">
      {!loading && cards.length === 0 && (emptyState ?? null)}
      {cards.map((card) => (
        <div
          key={card.id}
          ref={(el) => {
            cardRefs.current.set(card.id, el);
          }}
          onMouseEnter={() => handleFocusCard(card.id)}
          onFocus={() => handleFocusCard(card.id)}
          className={`rounded-[20px] transition-all duration-300 ${
            selectedId === card.id
              ? "ring-2 ring-cyan-400/70 shadow-[0_0_25px_rgba(34,211,238,0.35)]"
              : ""
          }`}
        >
          {renderCard(card, { selected: selectedId === card.id })}
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative">
      {/* Mobile floating switch */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center lg:hidden">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/[0.08] bg-[#060c18]/90 p-1 shadow-[0_10px_35px_rgba(0,0,0,0.6),0_0_30px_-8px_rgba(34,211,238,0.4)] backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => setMobileView("list")}
            aria-pressed={mobileView === "list"}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              mobileView === "list"
                ? "bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.25)]"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <LayoutList className="h-4 w-4" />
            لیست
          </button>
          <button
            type="button"
            onClick={() => setMobileView("map")}
            aria-pressed={mobileView === "map"}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              mobileView === "map"
                ? "bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.25)]"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <MapIcon className="h-4 w-4" />
            نقشه
          </button>
        </div>
      </div>

      {/* Desktop split: results (right) + sticky full-height map (left) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_460px]">
        <div className={mobileView === "list" ? "" : "hidden lg:block"}>{listPane}</div>
        <div className={mobileView === "map" ? "" : "hidden lg:block"}>
          <div className="lg:sticky lg:top-36 lg:h-[calc(100vh-11rem)]">
            <div className="h-full rounded-2xl border border-white/10 bg-[#0c1626]/60 p-3 backdrop-blur-md">
              {mapPane}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom padding so the floating switch never covers cards */}
      <div className="h-16 lg:hidden" />
    </div>
  );
}
