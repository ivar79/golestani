"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, MapPin, Navigation, X } from "lucide-react";
import { getAllProvinces, searchIranLocations, type ProvinceData } from "@/lib/iranGeo";
import type { LocationState } from "@/hooks/useLocationPick";

/**
 * LocationChip — Phase 3 location chip (task 6).
 *
 * A compact glass chip for the search header that opens a luxury popup with:
 *  - the active location (manual / browser / saved) and a clear action
 *  - one-tap browser GPS request
 *  - province → city/village two-step picker (real nationwide geo data)
 *
 * Pure presentation: all state lives in the shared useLocationPick hook.
 */
export default function LocationChip({ location }: { location: LocationState }) {
  const { location: point, source, status, error, requestBrowserLocation, setManualLocation, clearLocation } =
    location;

  const [open, setOpen] = useState(false);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const provinceList = useMemo(() => getAllProvinces(), []);

  const cityMatches = useMemo(() => {
    if (!cityQuery.trim()) return null;
    return searchIranLocations(cityQuery, 8);
  }, [cityQuery]);

  const label =
    point?.label ??
    (selectedProvince ? `استان ${selectedProvince.name}` : null) ??
    (source === "browser" ? "موقعیت GPS من" : null) ??
    (source === "manual" ? "موقعیت انتخابی روی نقشه" : null) ??
    "همه ایران";

  const busy = status === "locating";

  return (
    <div ref={rootRef} className="relative">
      {/* Chip trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#060c18]/85 px-3.5 py-2.5 text-sm font-medium text-slate-200 shadow-[0_0_18px_rgba(6,182,212,0.08)] backdrop-blur-xl transition-all hover:border-cyan-400/40 hover:text-white active:scale-[0.98]"
        title="انتخاب موقعیت و شهر"
      >
        <MapPin className={`h-4 w-4 ${point ? "text-cyan-400" : "text-slate-400"}`} />
        <span className="max-w-[140px] truncate">{label}</span>
        {busy && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-cyan-400" />}
      </button>

      {open && (
        <div
          dir="rtl"
          className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#060c18]/90 shadow-[0_25px_60px_rgba(0,0,0,0.65),0_0_40px_-12px_rgba(34,211,238,0.25)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Luminous top glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 left-1/2 h-16 w-48 -translate-x-1/2 rounded-full bg-cyan-400/15 blur-2xl"
          />

          {/* Active location row */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400">موقعیت فعال</p>
              <p className="truncate text-sm font-semibold text-white">{label}</p>
              {point && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">
                  {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
                </p>
              )}
            </div>
            {point && (
              <button
                type="button"
                onClick={() => clearLocation()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300"
                title="حذف موقعیت"
                aria-label="حذف موقعیت"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* GPS row */}
          <button
            type="button"
            onClick={() => {
              requestBrowserLocation();
              setOpen(false);
            }}
            className="group flex w-full items-center gap-3 border-b border-white/[0.08] px-4 py-3 text-right transition-colors hover:bg-cyan-500/10"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
              <Crosshair className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">یافتن موقعیت من با GPS</span>
              <span className="block text-[11px] text-slate-400">دقیق‌ترین نتیجه برای «نزدیک‌ترین»‌ها</span>
            </span>
            <Navigation className="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-cyan-400" />
          </button>

          {error && (
            <p className="border-b border-white/[0.08] bg-rose-500/10 px-4 py-2 text-[11px] text-rose-300">
              {error}
            </p>
          )}

          {/* Free-text nationwide city search */}
          <div className="border-b border-white/[0.08] p-3">
            <input
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="جست‌وجوی شهر یا روستا در سراسر ایران…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/40"
            />
            {cityMatches && (
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {cityMatches.length === 0 && (
                  <p className="px-1 py-2 text-xs text-slate-500">موردی پیدا نشد.</p>
                )}
                {cityMatches.map((m) => (
                  <button
                    key={`${m.name}-${m.lat}-${m.lng}`}
                    type="button"
                    onClick={() => {
                      setManualLocation(m.lat, m.lng, m.name);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <span>{m.name}</span>
                    <span className="text-[10px] text-slate-500">{m.province}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Province grid */}
          <div className="max-h-56 overflow-y-auto p-3">
            {!cityMatches && (
              <div className="grid grid-cols-3 gap-1.5">
                {provinceList.map((p) => (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => {
                      setSelectedProvince(p);
                      setManualLocation(p.lat, p.lng, p.center);
                      setOpen(false);
                    }}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-[11px] font-medium text-slate-300 transition-all hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-200"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
