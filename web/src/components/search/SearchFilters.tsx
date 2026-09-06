"use client";

import { useState } from "react";
import HomeIcon from "@/components/home/HomeIcon";
import type { SearchFacets } from "@/lib/businesses";
import { getAllProvinces, type ProvinceData } from "@/lib/iranGeo";
import { ChevronDown, MapPin, X } from "lucide-react";

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
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);

  const radiusLabel =
    RADIUS_OPTIONS.find((o) => o.value === filters.radius)?.label ?? "بدون محدودیت";

  function toggle(kind: "verified" | "showcase") {
    onChange({ ...filters, [kind]: !filters[kind] });
  }

  function pickCategory(cat: string | null) {
    onChange({ ...filters, category: filters.category === cat ? null : cat });
  }

  function pickCity(cityName: string | null) {
    onChange({ ...filters, city: cityName });
    setShowCityPicker(false);
    setSelectedProvince(null);
  }

  return (
    <div className="flex shrink-0 flex-col gap-4 border-b border-white/10 px-4 pb-4 pt-6 relative">
      {/* Location meta row: city chip + radius selector */}
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <button
          type="button"
          onClick={() => setShowCityPicker(true)}
          className="flex items-center gap-1.5 rounded-lg bg-surface-container-highest/60 hover:bg-surface-container-highest border border-white/5 px-2.5 py-1.5 text-white transition-colors"
          title="انتخاب یا تغییر شهر و منطقه"
        >
          <MapPin className="h-3.5 w-3.5 text-secondary" />
          <span>{filters.city ?? "همه شهرها (سراسری)"}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>

        {filters.city && (
          <button
            type="button"
            onClick={() => pickCity(null)}
            className="text-[11px] text-slate-400 hover:text-white"
          >
            حذف فیلتر شهر
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRadius((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:text-white"
          >
            <span>شعاع: {filters.radius ? radiusLabel : "بدون محدودیت"}</span>
            <HomeIcon
              name="chevron"
              className={`h-3.5 w-3.5 transition-transform ${showRadius ? "-rotate-90" : ""}`}
            />
          </button>
          {showRadius && (
            <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-xl border border-white/10 bg-panel shadow-xl">
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
                  className={`flex w-full items-center justify-between px-3 py-2 text-right text-xs transition-colors ${
                    filters.radius === opt.value
                      ? "bg-secondary/10 text-secondary"
                      : "text-on-surface-variant hover:bg-white/5"
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

      {/* Modal / Dialog for Selecting Province & Cities/Villages */}
      {showCityPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c1626] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                {selectedProvince
                  ? `شهرها و روستاهای استان ${selectedProvince.name}`
                  : "پوشش سراسری: انتخاب استان"}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowCityPicker(false);
                  setSelectedProvince(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => pickCity(null)}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  همه شهرهای ایران (بدون محدودیت)
                </button>
                {selectedProvince && (
                  <button
                    type="button"
                    onClick={() => setSelectedProvince(null)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    ← بازگشت به لیست استان‌ها
                  </button>
                )}
              </div>

              {selectedProvince ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
                  {selectedProvince.cities.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickCity(c)}
                      className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-right text-xs text-cyan-200 hover:bg-cyan-500/25 transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
                  {getAllProvinces().map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => setSelectedProvince(p)}
                      className="rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2 text-right text-xs text-slate-300 hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300 transition-colors flex items-center justify-between"
                    >
                      <span>{p.name}</span>
                      <ChevronDown className="w-3 h-3 opacity-40 -rotate-90" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Result count + nearest sort */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-sm text-white">
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
