"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Crosshair, MapPin, Navigation, Search, X } from "lucide-react";
import { getAllProvinces, searchIranLocations, type ProvinceData } from "@/lib/iranGeo";
import type { LocationState } from "@/hooks/useLocationPick";
import {
  neshanSearchAvailable,
  placeLabel,
  searchNeshanAddress,
  type NeshanPlace,
} from "@/lib/neshanSearch";
import MapView from "@/components/map/MapView";

/**
 * LocationChip — Phase 3 location chip (task 6).
 *
 * A compact chip for the search header that opens a restrained panel with:
 *  - the active location (manual / browser / saved) and a clear action
 *  - one-tap browser GPS request
 *  - province → city/village two-step picker (real nationwide geo data)
 *
 * Pure presentation: all state lives in the shared useLocationPick hook.
 * Colors come exclusively from the --ik-* semantic tokens (same theme
 * system as the User Panel) — no hard-coded navy/cyan palette.
 */
export default function LocationChip({ location }: { location: LocationState }) {
  const { location: point, source, status, error, requestBrowserLocation, setManualLocation, clearLocation } =
    location;

  const [open, setOpen] = useState(false);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  // Address search (Neshan geocoding) state — optional, offline-safe.
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState<NeshanPlace[] | null>(null);
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressUnavailable, setAddressUnavailable] = useState(false);
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
  const lowAccuracy =
    typeof point?.accuracy === "number" && point.accuracy > 500;

  const runAddressSearch = async () => {
    if (!addressQuery.trim()) return;
    setAddressSearching(true);
    const results = await searchNeshanAddress(addressQuery);
    setAddressSearching(false);
    if (results === null) {
      // Network failure / timeout — fall back to the offline pick flow.
      setAddressUnavailable(true);
      setAddressResults(null);
      return;
    }
    setAddressUnavailable(false);
    setAddressResults(results);
  };

  return (
    <div ref={rootRef} className="relative">
      {/* Chip trigger — 44px touch target */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-ik-border bg-ik-panel px-3.5 text-sm font-medium text-ik-text shadow-sm transition-colors hover:border-ik-accent/40 active:scale-[0.98]"
        title="انتخاب موقعیت و شهر"
      >
        <MapPin className={`h-4 w-4 ${point ? "text-ik-accent" : "text-ik-muted"}`} />
        <span className="max-w-[140px] truncate">{label}</span>
        {busy && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-ik-accent" />}
      </button>

      {open && (
        <div
          dir="rtl"
          className="absolute right-0 top-full z-50 mt-2 max-h-[min(70svh,560px)] w-[min(92vw,360px)] overflow-y-auto rounded-2xl border border-ik-border bg-ik-panel/95 shadow-lg backdrop-blur-md"
        >
          {/* Active location row */}
          <div className="flex items-center justify-between gap-2 border-b border-ik-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] text-ik-muted">موقعیت فعال</p>
              <p className="truncate text-sm font-semibold text-ik-text">{label}</p>
              {point && (
                <p className="mt-0.5 font-mono text-[10px] text-ik-muted" dir="ltr">
                  {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
                  {typeof point.accuracy === "number" && (
                    <span> (±{Math.round(point.accuracy)}m)</span>
                  )}
                </p>
              )}
            </div>
            {point && (
              <button
                type="button"
                onClick={() => clearLocation()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-ik-border bg-ik-wash text-ik-muted transition-colors hover:border-ik-danger/40 hover:text-ik-danger"
                title="حذف موقعیت"
                aria-label="حذف موقعیت"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* GPS row — 44px+ touch target */}
          <button
            type="button"
            onClick={() => {
              requestBrowserLocation();
              setOpen(false);
            }}
            className="group flex min-h-[52px] w-full items-center gap-3 border-b border-ik-border px-4 py-3 text-right transition-colors hover:bg-ik-wash"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ik-accent/30 bg-ik-accent/10 text-ik-accent">
              <Crosshair className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ik-text">یافتن موقعیت من با GPS</span>
              <span className="block text-[11px] text-ik-muted">دقیق‌ترین نتیجه برای «نزدیک‌ترین»‌ها</span>
            </span>
            <Navigation className="h-3.5 w-3.5 text-ik-muted transition-colors group-hover:text-ik-accent" />
          </button>

          {error && (
            <p className="border-b border-ik-border bg-ik-danger/10 px-4 py-2 text-[11px] text-ik-danger">
              {error}
            </p>
          )}

          {/* Low-accuracy hint: nudge the user toward manual fine-tuning. */}
          {lowAccuracy && (
            <p className="flex items-center gap-1.5 border-b border-ik-border bg-ik-warning/10 px-4 py-2 text-[11px] text-ik-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>دقت موقعیت پایین است — برای نتیجهٔ دقیق‌تر، پین را روی نقشه جابه‌جا کنید.</span>
            </p>
          )}

          {/* Address search (Neshan geocoding) — hidden entirely when the key is missing. */}
          {neshanSearchAvailable() && (
            <div className="border-b border-ik-border p-3">
              <div className="flex items-center gap-2" role="search">
                <input
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runAddressSearch();
                    }
                  }}
                  placeholder="آدرس دقیق یا نام مکان… (مثلاً ونک، رستوران)"
                  className="min-h-[44px] w-full rounded-xl border border-ik-border bg-ik-wash px-3 text-sm text-ik-text outline-none transition-colors placeholder:text-ik-muted focus:border-ik-accent/40"
                />
                <button
                  type="button"
                  disabled={addressSearching}
                  onClick={() => void runAddressSearch()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ik-accent/30 bg-ik-accent/10 text-ik-accent transition-colors hover:bg-ik-accent/20 disabled:opacity-50"
                  title="جست‌وجوی آدرس"
                  aria-label="جست‌وجوی آدرس"
                >
                  <Search className={`h-4 w-4 ${addressSearching ? "animate-pulse" : ""}`} />
                </button>
              </div>

              {addressUnavailable && (
                <p className="mt-2 text-[11px] text-ik-warning">
                  سرویس آدرس‌یاب در دسترس نیست (آفلاین؟) — از جست‌وجوی شهر/محله یا انتخاب دستی روی نقشه استفاده کنید.
                </p>
              )}

              {addressResults && addressResults.length === 0 && (
                <p className="mt-2 px-1 py-1 text-xs text-ik-muted">موردی پیدا نشد.</p>
              )}

              {addressResults && addressResults.length > 0 && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {addressResults.map((p) => (
                    <button
                      key={`${p.lat}-${p.lng}-${p.title}`}
                      type="button"
                      onClick={() => {
                        setManualLocation(p.lat, p.lng, placeLabel(p));
                        setOpen(false);
                      }}
                      className="flex min-h-[44px] w-full flex-col justify-center rounded-lg px-2.5 py-1.5 text-right transition-colors hover:bg-ik-wash"
                    >
                      <span className="text-xs font-medium text-ik-text">{p.title}</span>
                      {(p.neighbourhood || p.city || p.province) && (
                        <span className="text-[10px] text-ik-muted">
                          {[p.neighbourhood, p.city, p.province].filter(Boolean).join("، ")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fine-tuning on the map (Snap-style) — only when a location exists. */}
          {point && (
            <div className="border-b border-ik-border p-3">
              <p className="mb-2 text-[11px] font-semibold text-ik-muted">
                دقیق‌سازی روی نقشه — پین را به مکان دقیق بکشید:
              </p>
              <div className="overflow-hidden rounded-xl border border-ik-border">
                <MapView
                  className="h-[220px] w-full"
                  markers={[]}
                  zoom={16}
                  autoFit={false}
                  center={[point.latitude, point.longitude]}
                  userCoords={{ lat: point.latitude, lng: point.longitude }}
                  onPick={(lat, lng) => setManualLocation(lat, lng, point.label ?? undefined)}
                />
              </div>
            </div>
          )}

          {/* Free-text nationwide city search */}
          <div className="border-b border-ik-border p-3">
            <input
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="جست‌وجوی شهر یا روستا در سراسر ایران…"
              className="min-h-[44px] w-full rounded-xl border border-ik-border bg-ik-wash px-3 text-sm text-ik-text outline-none transition-colors placeholder:text-ik-muted focus:border-ik-accent/40"
            />
            {cityMatches && (
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {cityMatches.length === 0 && (
                  <p className="px-1 py-2 text-xs text-ik-muted">موردی پیدا نشد.</p>
                )}
                {cityMatches.map((m) => (
                  <button
                    key={`${m.name}-${m.lat}-${m.lng}`}
                    type="button"
                    onClick={() => {
                      setManualLocation(m.lat, m.lng, m.name);
                      setOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-ik-text transition-colors hover:bg-ik-wash"
                  >
                    <span>{m.name}</span>
                    <span className="text-[10px] text-ik-muted">{m.province}</span>
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
                    className="min-h-[44px] rounded-lg border border-ik-border bg-ik-wash px-2 text-[11px] font-medium text-ik-text transition-colors hover:border-ik-accent/40 hover:bg-ik-wash-hover"
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
