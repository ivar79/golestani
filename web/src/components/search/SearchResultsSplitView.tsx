"use client";

import { useCallback, useRef, useState } from "react";
import { LayoutList, Map as MapIcon } from "lucide-react";
import MapView, { type MapMarker } from "@/components/map/MapView";
import PublicAdSlot from "@/components/ads/PublicAdSlot";

/**
 * SearchResultsSplitView — task 10.
 *
 * Desktop: two columns — results list on the right, full-height sticky map
 * on the left (RTL layout). Mobile: a floating segmented switch toggles
 * between «نقشه» and «لیست» with smooth mount/unmount.
 *
 * Mobile map height is responsive, not fixed: `min(62svh, 480px)` bounded by
 * min/max heights, so on 320–414px viewports the map stays usable without
 * crowding out search/filters/cards, and landscape keeps a sane layout.
 * Safe-area insets keep the floating switch clear of the home indicator.
 *
 * Two-way sync: marker click → popup + smooth scroll + highlight ring on
 * the matching card; card focus (hover/click) → map marker highlight.
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
  /** Static license badge (Phase 3) — presentation only. */
  license_verified?: boolean;
  /** Raw tracking code (Phase 3) — feeds the qr.mojavez.ir badge deep link. */
  license_tracking_code?: string | null;
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
    <div className="h-[min(62svh,480px)] min-h-[280px] w-full lg:h-full lg:min-h-0">
      <MapView
        className="h-full w-full"
        markers={markers}
        center={center}
        userCoords={userCoords ? { lat: userCoords.lat, lng: userCoords.lng } : null}
        onPick={onPick}
        onSelectMarker={handleSelectMarker}
        selectedId={selectedId}
      />
    </div>
  );

  const listPane = (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-4">
      <PublicAdSlot slot="search_side" />
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
              ? "ring-2 ring-ik-accent/60 shadow-lg shadow-ik-accent/15"
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
      {/* Mobile floating switch — safe-area aware, 44px touch targets */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex justify-center lg:hidden">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-ik-border bg-ik-panel/95 p-1 shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMobileView("list")}
            aria-pressed={mobileView === "list"}
            className={`flex min-h-[44px] min-w-[88px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-bold transition-colors ${
              mobileView === "list"
                ? "bg-ik-accent/15 text-ik-accent"
                : "text-ik-muted hover:text-ik-text"
            }`}
          >
            <LayoutList className="h-4 w-4" />
            لیست
          </button>
          <button
            type="button"
            onClick={() => setMobileView("map")}
            aria-pressed={mobileView === "map"}
            className={`flex min-h-[44px] min-w-[88px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-bold transition-colors ${
              mobileView === "map"
                ? "bg-ik-accent/15 text-ik-accent"
                : "text-ik-muted hover:text-ik-text"
            }`}
          >
            <MapIcon className="h-4 w-4" />
            نقشه
          </button>
        </div>
      </div>

      {/* Desktop split: results (right) + sticky full-height map (left).
          min-w-0 on both items: without it the auto/1fr tracks grow to the
          cards' min-content width and overflow the viewport on 320px. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_460px]">
        <div className={`min-w-0 ${mobileView === "list" ? "" : "hidden lg:block"}`}>{listPane}</div>
        <div className={`min-w-0 ${mobileView === "map" ? "" : "hidden lg:block"}`}>
          <div className="lg:sticky lg:top-36 lg:h-[calc(100svh-11rem)]">
            <div className="h-full rounded-2xl border border-ik-border bg-ik-panel/60 p-3">
              {mapPane}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom padding so the floating switch never covers cards */}
      <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))] lg:hidden" />
    </div>
  );
}
