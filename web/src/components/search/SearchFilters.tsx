"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import HomeIcon from "@/components/home/HomeIcon";
import type { SearchFacets } from "@/lib/businesses";
import { getAllProvinces, type ProvinceData } from "@/lib/iranGeo";
import { ChevronDown, MapPin, X } from "lucide-react";

export type SearchFiltersState = {
  category: string | null;
  city: string | null;
  /** Neighborhood text filter — sent as `neighborhood` to the search API. */
  neighborhood: string | null;
  verified: boolean;
  showcase: boolean;
  /** Radius options require a location; radius chip is disabled without one. */
  radius: number | null;
  /** Distance sorting requires a location; sort chip is shown only then. */
  nearest: boolean;
};

export const DEFAULT_FILTERS: SearchFiltersState = {
  category: null,
  city: null,
  neighborhood: null,
  verified: false,
  showcase: false,
  radius: null,
  nearest: false,
};

export type RadiusOption = { label: string; value: number | null };

export const RADIUS_OPTIONS: RadiusOption[] = [
  { label: "۱ کیلومتر", value: 1000 },
  { label: "۲ کیلومتر", value: 2000 },
  { label: "۵ کیلومتر", value: 5000 },
  { label: "۱۰ کیلومتر", value: 10000 },
  { label: "بدون محدودیت", value: null },
];

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
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [showNeighborhood, setShowNeighborhood] = useState(false);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);

  const radiusLabel =
    RADIUS_OPTIONS.find((o) => o.value === filters.radius)?.label ?? "بدون محدودیت";

  const neighborhoods = (facets?.neighborhoods ?? []).filter(Boolean).slice(0, 40);

  function toggle(kind: "verified" | "showcase") {
    onChange({ ...filters, [kind]: !filters[kind] });
  }

  function pickCategory(cat: string | null) {
    onChange({ ...filters, category: filters.category === cat ? null : cat });
  }

  // Single place that closes the picker AND resets the province drill-down.
  // Used by the X button, backdrop click, Escape, and pickCity.
  const closeCityPicker = useCallback(() => {
    setShowCityPicker(false);
    setSelectedProvince(null);
  }, []);

  function pickCity(cityName: string | null) {
    // Changing the city invalidates the neighborhood filter (different area).
    onChange({ ...filters, city: cityName, neighborhood: null });
    closeCityPicker();
  }

  function pickNeighborhood(name: string | null) {
    onChange({ ...filters, neighborhood: filters.neighborhood === name ? null : name });
    setShowNeighborhood(false);
  }

  // Lock background scroll while the picker is open. Restores the previous
  // value on close/unmount so concurrent locks never fight each other.
  useEffect(() => {
    if (!showCityPicker) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showCityPicker]);

  // Close the picker with the Escape key while it is open.
  useEffect(() => {
    if (!showCityPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCityPicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCityPicker, closeCityPicker]);

  return (
    <div className="sticky top-[4.5rem] z-20 flex shrink-0 flex-col gap-4 rounded-t-2xl border-b border-ik-border bg-ik-panel/85 px-4 pb-4 pt-5">
      {/* Location meta row: city chip + neighborhood + radius selector.
          Mobile-first: wraps to tidy rows on narrow screens instead of
          squeezing into one overflowing toolbar. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ik-muted">
        <button
          type="button"
          onClick={() => setShowCityPicker(true)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-ik-border bg-ik-wash px-2.5 text-ik-text transition-colors hover:bg-ik-wash-hover"
          title="انتخاب یا تغییر شهر و منطقه"
        >
          <MapPin className="h-3.5 w-3.5 text-ik-accent" />
          <span>{filters.city ?? "همه شهرها (سراسری)"}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>

        {filters.city && (
          <button
            type="button"
            onClick={() => pickCity(null)}
            className="min-h-[44px] text-[11px] text-ik-muted transition-colors hover:text-ik-text"
          >
            حذف فیلتر شهر
          </button>
        )}

        <div className="flex items-center gap-1">
          {/* Neighborhood dropdown (populated from real API facets) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNeighborhood((v) => !v)}
              disabled={neighborhoods.length === 0}
              className={`flex min-h-[44px] items-center gap-1 rounded-md px-2 transition-colors ${
                filters.neighborhood
                  ? "text-ik-accent"
                  : "transition-colors hover:text-ik-text disabled:cursor-not-allowed disabled:opacity-40"
              }`}
              title={neighborhoods.length === 0 ? "محله‌ای ثبت نشده است" : "فیلتر محله"}
            >
              <span>{filters.neighborhood ? `محله: ${filters.neighborhood}` : "محله"}</span>
              <HomeIcon
                name="chevron"
                className={`h-3.5 w-3.5 transition-transform ${showNeighborhood ? "-rotate-90" : ""}`}
              />
            </button>
            {showNeighborhood && neighborhoods.length > 0 && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-44 overflow-y-auto rounded-xl border border-ik-border bg-ik-panel shadow-lg">
                {neighborhoods.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => pickNeighborhood(n)}
                    className={`flex min-h-[44px] w-full items-center justify-between px-3 text-right text-xs transition-colors ${
                      filters.neighborhood === n
                        ? "bg-ik-accent/10 text-ik-accent"
                        : "text-ik-muted hover:bg-ik-wash"
                    }`}
                  >
                    <span>{n}</span>
                    {filters.neighborhood === n && <X className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRadius((v) => !v)}
              className="flex min-h-[44px] items-center gap-1 rounded-md px-2 transition-colors hover:text-ik-text"
            >
              <span>شعاع: {filters.radius ? radiusLabel : "بدون محدودیت"}</span>
              <HomeIcon
                name="chevron"
                className={`h-3.5 w-3.5 transition-transform ${showRadius ? "-rotate-90" : ""}`}
              />
            </button>
            {showRadius && (
              <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-xl border border-ik-border bg-ik-panel shadow-lg">
                {RADIUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={opt.value !== null && !hasLocation}
                    onClick={() => {
                      onChange({
                        ...filters,
                        radius: opt.value,
                        nearest: opt.value !== null ? filters.nearest : false,
                      });
                      setShowRadius(false);
                    }}
                    className={`flex min-h-[44px] w-full items-center justify-between px-3 text-right text-xs transition-colors ${
                      filters.radius === opt.value
                        ? "bg-ik-accent/10 text-ik-accent"
                        : "text-ik-muted hover:bg-ik-wash"
                    } ${opt.value !== null && !hasLocation ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    <span>{opt.label}</span>
                    {opt.value !== null && !hasLocation && (
                      <span className="text-[9px]">نیاز به موقعیت</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal / Dialog for Selecting Province & Cities/Villages.
          Rendered through createPortal(document.body) so it escapes this
          sticky panel's stacking context (z-20 + backdrop-blur), which
          previously trapped the z-50 overlay beneath the page's z-40 header
          and made it move with the panel's scroll position. */}
      {showCityPicker &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ik-bg/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCityPicker();
          }}
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-ik-border bg-ik-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ik-border pb-3">
              <h4 className="flex items-center gap-2 text-sm font-bold text-ik-text">
                <MapPin className="h-4 w-4 text-ik-accent" />
                {selectedProvince
                  ? `شهرها و روستاهای استان ${selectedProvince.name}`
                  : "پوشش سراسری: انتخاب استان"}
              </h4>
              <button
                type="button"
                onClick={closeCityPicker}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ik-muted transition-colors hover:bg-ik-wash hover:text-ik-text"
                aria-label="بستن"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => pickCity(null)}
                  className="min-h-[44px] text-xs text-ik-accent transition-colors hover:underline"
                >
                  همه شهرهای ایران (بدون محدودیت)
                </button>
                {selectedProvince && (
                  <button
                    type="button"
                    onClick={() => setSelectedProvince(null)}
                    className="min-h-[44px] text-xs text-ik-muted transition-colors hover:text-ik-text"
                  >
                    ← بازگشت به لیست استان‌ها
                  </button>
                )}
              </div>

              {selectedProvince ? (
                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">
                  {selectedProvince.cities.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickCity(c)}
                      className="min-h-[44px] rounded-xl border border-ik-accent/30 bg-ik-accent/10 px-3 text-right text-xs text-ik-accent transition-colors hover:bg-ik-accent/20"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">
                  {getAllProvinces().map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => setSelectedProvince(p)}
                      className="flex min-h-[44px] items-center justify-between rounded-xl border border-ik-border bg-ik-wash px-3 text-right text-xs text-ik-text transition-colors hover:border-ik-accent/40 hover:bg-ik-wash-hover"
                    >
                      <span>{p.name}</span>
                      <ChevronDown className="h-3 w-3 -rotate-90 opacity-40" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Filter chips — strip scrolls horizontally; it must NOT bleed past
          the panel edges (negative margins caused page-level overflow on 320px). */}
      <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto pb-1 px-1">
        {(facets?.categories ?? []).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => pickCategory(cat)}
            className={`min-h-[44px] whitespace-nowrap rounded-lg border px-3 text-xs transition-colors ${
              filters.category === cat
                ? "border-ik-accent/30 bg-ik-accent/10 text-ik-accent"
                : "border-ik-border bg-ik-wash text-ik-text hover:bg-ik-wash-hover"
            }`}
          >
            {cat}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toggle("verified")}
          className={`min-h-[44px] whitespace-nowrap rounded-lg border px-3 text-xs transition-colors ${
            filters.verified
              ? "border-ik-accent/30 bg-ik-accent/10 text-ik-accent"
              : "border-ik-border bg-ik-wash text-ik-text hover:bg-ik-wash-hover"
          }`}
        >
          تایید شده
        </button>
        <button
          type="button"
          onClick={() => toggle("showcase")}
          className={`min-h-[44px] whitespace-nowrap rounded-lg border px-3 text-xs transition-colors ${
            filters.showcase
              ? "border-ik-accent/30 bg-ik-accent/10 text-ik-accent"
              : "border-ik-border bg-ik-wash text-ik-text hover:bg-ik-wash-hover"
          }`}
        >
          ویژه
        </button>
      </div>

      {/* Result count + nearest sort */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-sm text-ik-text">
          {loading
            ? "در حال جست‌وجو…"
            : resultCount != null
            ? `${resultCount.toLocaleString("fa-IR")} نتیجه پیدا شد`
            : ""}
        </span>
        {hasLocation && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, nearest: !filters.nearest })}
            className={`flex min-h-[44px] items-center gap-1 text-xs transition-colors ${
              filters.nearest ? "text-ik-accent" : "text-ik-muted hover:text-ik-text"
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
