"use client";

import { useState } from "react";
import HomeIcon from "@/components/home/HomeIcon";
import type { SearchFacets } from "@/lib/businesses";

export type SearchFiltersState = {
  category: string | null;
  city: string | null;
  verified: boolean;
  showcase: boolean;
  /** Radius in meters; null = unlimited (no radius param sent). */
  radius: number | null;
  /** Distance sorting requires a location; sort chip is shown only then. */
  nearest: boolean;
};

export const DEFAULT_FILTERS: SearchFiltersState = {
  category: null,
  city: null,
  verified: false,
  showcase: false,
  radius: null,
  nearest: false,
};

export type RadiusOption = { label: string; value: number | null };

/** Radius options in meters. null = unlimited (omitted from the API call). */
export const RADIUS_OPTIONS: RadiusOption[] = [
  { label: "۱ کیلومتر", value: 1000 },
  { label: "۲ کیلومتر", value: 2000 },
  { label: "۵ کیلومتر", value: 5000 },
  { label: "۱۰ کیلومتر", value: 10000 },
  { label: "بدون محدودیت", value: null },
];

/**
 * SearchFilters — Phase 3.2 (Stitch: desktop_7 sidebar header).
 *
 * Visual language: search input with inline filter button, location meta row
 * (city + radius), horizontally-scrollable filter chips, result count + sort.
 *
 * Data: category/city options come from the real facets endpoint. Ratings and
 * open-now are deliberately NOT offered — the backend has no data model for
 * them (documented in BusinessController::search).
 */
export default function SearchFilters({
  filters,
  onChange,
  facets,
  resultCount,
  loading,
  hasLocation,
}: {
  filters: SearchFiltersState;
  onChange: (next: SearchFiltersState) => void;
  facets: SearchFacets | null;
  resultCount: number | null;
  loading: boolean;
  hasLocation: boolean;
}) {
  const [showRadius, setShowRadius] = useState(false);
  const radiusLabel =
    RADIUS_OPTIONS.find((o) => o.value === filters.radius)?.label ?? "بدون محدودیت";

  function toggle(kind: "verified" | "showcase") {
    onChange({ ...filters, [kind]: !filters[kind] });
  }

  function pickCategory(cat: string | null) {
    onChange({ ...filters, category: filters.category === cat ? null : cat });
  }

  return (
    <div className="flex shrink-0 flex-col gap-4 border-b border-white/10 px-4 pb-4 pt-6">
      {/* Location meta row: city chip + radius selector */}
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <button
          type="button"
          onClick={() => onChange({ ...filters, city: null })}
          className="flex items-center gap-1 rounded-md bg-surface-container-highest px-2 py-1"
          title={filters.city ? "حذف فیلتر شهر" : undefined}
        >
          <HomeIcon name="location" className="h-3.5 w-3.5" />
          <span>{filters.city ?? "همه شهرها"}</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRadius((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:text-white"
          >
            <span>شعاع: {filters.radius ? radiusLabel : "بدون محدودیت"}</span>
            <HomeIcon name="chevron" className={`h-3.5 w-3.5 transition-transform ${showRadius ? "-rotate-90" : ""}`} />
          </button>
          {showRadius && (
            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-xl border border-white/10 bg-panel shadow-xl">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  disabled={opt.value !== null && !hasLocation}
                  onClick={() => {
                    onChange({ ...filters, radius: opt.value, nearest: opt.value !== null ? filters.nearest : false });
                    setShowRadius(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-right text-xs transition-colors ${
                    filters.radius === opt.value
                      ? "bg-secondary/10 text-secondary"
                      : "text-on-surface-variant hover:bg-white/5"
                  } ${opt.value !== null && !hasLocation ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  <span>{opt.label}</span>
                  {opt.value !== null && !hasLocation && <span className="text-[9px]">نیاز به موقعیت</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="scrollbar-hide -mx-4 flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-1">
        {(facets?.categories ?? []).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => pickCategory(cat)}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              filters.category === cat
                ? "border-secondary/20 bg-secondary/10 text-secondary"
                : "border-white/10 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest"
            }`}
          >
            {cat}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toggle("verified")}
          className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            filters.verified
              ? "border-secondary/20 bg-secondary/10 text-secondary"
              : "border-white/10 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest"
          }`}
        >
          تایید شده
        </button>
        <button
          type="button"
          onClick={() => toggle("showcase")}
          className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            filters.showcase
              ? "border-secondary/20 bg-secondary/10 text-secondary"
              : "border-white/10 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest"
          }`}
        >
          ویژه
        </button>
      </div>

      {/* Result count + nearest sort (distance sort only with a real location) */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-sm text-white">
          {loading ? "در حال جست‌وجو…" : resultCount != null ? `${resultCount.toLocaleString("fa-IR")} نتیجه پیدا شد` : ""}
        </span>
        {hasLocation && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, nearest: !filters.nearest })}
            className={`flex items-center gap-1 text-xs ${
              filters.nearest ? "text-secondary" : "text-on-surface-variant hover:text-white"
            }`}
          >
            <span>نزدیک‌ترین</span>
            <HomeIcon name="arrowLeft" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
