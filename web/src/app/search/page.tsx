"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import {
  searchBusinesses,
  getSearchFacets,
  type Business,
  type SearchFacets,
} from "@/lib/businesses";
import { extractApiError } from "@/lib/api";
import AppTaskbar from "@/components/layout/AppTaskbar";
import MapViewLazy, { type MapMarker } from "@/components/map/MapViewLazy";
import { useLocationPick } from "@/hooks/useLocationPick";
import MiniCard from "@/components/search/MiniCard";
import SearchFilters, {
  DEFAULT_FILTERS,
  type SearchFiltersState,
} from "@/components/search/SearchFilters";
import { searchIranLocations, getProvince } from "@/lib/iranGeo";

/** True for axios cancellation errors — these are expected, not user-facing failures. */
function isCancellation(err: unknown): boolean {
  return (
    axios.isCancel(err) ||
    (typeof err === "object" &&
      err !== null &&
      ((err as { name?: string }).name === "CanceledError" ||
        (err as { name?: string }).name === "AbortError"))
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const initialCity = searchParams.get("city") ?? null;

  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState<Business[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [filters, setFilters] = useState<SearchFiltersState>({
    ...DEFAULT_FILTERS,
    city: initialCity,
  });
  const abortRef = useRef<AbortController | null>(null);
  const {
    location,
    requestBrowserLocation,
    setManualLocation,
    error: locationError,
  } = useLocationPick();

  // Determine map center: prefer user location, fallback to selected city/province coords, fallback to Tehran
  const [mapCenter, setMapCenter] = useState<[number, number]>([35.6892, 51.389]);

  useEffect(() => {
    if (filters.city) {
      const prov = getProvince(filters.city);
      if (prov) {
        setMapCenter([prov.lat, prov.lng]);
        return;
      }
      const matches = searchIranLocations(filters.city, 1);
      if (matches.length > 0) {
        setMapCenter([matches[0].lat, matches[0].lng]);
      }
    }
  }, [filters.city]);

  /** Run a search with explicit parameters (no ref reads during render). */
  const runSearch = useCallback(
    async (
      text: string,
      f: SearchFiltersState,
      loc: ReturnType<typeof useLocationPick>["location"]
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        const result = await searchBusinesses(
          {
            q: text || undefined,
            category: f.category || undefined,
            city: f.city || undefined,
            verified: f.verified || undefined,
            showcase: f.showcase || undefined,
            latitude: loc?.latitude,
            longitude: loc?.longitude,
            radius: f.radius ?? undefined,
            limit: 20,
          },
          { signal: ac.signal }
        );
        if (ac.signal.aborted) return;
        setItems(result.data ?? (result as unknown as Business[]));
        setTotal(result.pagination?.total ?? result.data?.length ?? null);
      } catch (err: unknown) {
        if (isCancellation(err)) return;
        setError(extractApiError(err));
        setItems([]);
        setTotal(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    []
  );

  // Initial load: search based on URL params (q & city)
  useEffect(() => {
    const initialFilterState: SearchFiltersState = {
      ...DEFAULT_FILTERS,
      city: initialCity,
    };
    const t = setTimeout(() => void runSearch(initialQ, initialFilterState, null), 0);
    return () => clearTimeout(t);
  }, [runSearch, initialQ, initialCity]);

  // Re-search when filters change (user action).
  const applyFilters = useCallback(
    (next: SearchFiltersState) => {
      setFilters(next);
      void runSearch(q, next, location);
    },
    [q, location, runSearch]
  );

  // Re-search when the location changes (browser pick / map pick / clear).
  useEffect(() => {
    if (location === null && filters.radius === null && !filters.nearest) return;
    const t = setTimeout(() => void runSearch(q, filters, location), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Facets for filter chips
  useEffect(() => {
    const ac = new AbortController();
    getSearchFacets({ signal: ac.signal })
      .then(setFacets)
      .catch((err: unknown) => {
        if (isCancellation(err)) return;
        setFacets(null);
      });
    return () => ac.abort();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(q, filters, location);
  }

  const markers: MapMarker[] = items
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({
      id: b.id,
      latitude: b.latitude as number,
      longitude: b.longitude as number,
      title: b.name,
      subtitle: [
        b.category,
        typeof b.distance === "number"
          ? `${Math.round(b.distance).toLocaleString("fa-IR")} متر`
          : null,
      ]
        .filter(Boolean)
        .join(" — "),
      href: `/b/${b.slug}`,
    }));

  return (
    <main dir="rtl" className="min-h-screen bg-[#050B14] pb-10 pt-32 sm:pt-36 text-white">
      <AppTaskbar />
      <div className="mx-auto max-w-7xl px-4">
        {/* Search header form */}
        <form
          onSubmit={submit}
          className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-[#0c1626]/80 backdrop-blur-md p-3 sm:p-4 md:grid-cols-[1fr_auto]"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="چه چیزی پیدا می‌کنید؟ (نام شغل، محصول، کلمه کلیدی یا مکان...)"
            className="rounded-xl bg-white/[0.04] border border-white/5 p-3.5 sm:p-4 outline-none placeholder:text-slate-400 text-white text-base focus:border-cyan-400/40 transition-colors"
          />
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-[#050B14] font-bold px-8 py-3.5 text-base transition-all shadow-lg shadow-emerald-950/40"
          >
            {loading ? "در حال جست‌وجو…" : "جست‌وجو"}
          </button>
        </form>

        {(error || locationError) && (
          <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error ?? locationError}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* Filters + results */}
          <div className="rounded-2xl border border-white/10 bg-[#0c1626]/60 backdrop-blur-md">
            <SearchFilters
              filters={filters}
              onChange={applyFilters}
              facets={facets}
              resultCount={total}
              loading={loading}
              hasLocation={!!location}
            />
            <div className="grid gap-4 p-4">
              {!loading && !error && items.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-slate-400">
                  <p className="font-medium text-slate-300 mb-1">کسب‌وکاری در این محدوده یافت نشد.</p>
                  <p className="text-xs text-slate-500">
                    فیلترها را تغییر دهید یا شهر دیگری را انتخاب کنید.
                  </p>
                </div>
              )}
              {items.map((b) => (
                <MiniCard
                  key={b.id}
                  business={{
                    id: b.id,
                    slug: b.slug,
                    name: b.name,
                    category: b.category,
                    city: b.city,
                    neighborhood: b.neighborhood,
                    verification_badge: b.verification_badge,
                    distance: b.distance ?? null,
                    featured:
                      filters.showcase ||
                      (Array.isArray(b.badges) && b.badges.includes("showcase")),
                  }}
                />
              ))}
            </div>
          </div>

          {/* Real map (provider-independent & nationwide) */}
          <div className="lg:sticky lg:top-36 lg:h-[calc(100vh-12rem)]">
            <div className="rounded-2xl border border-white/10 bg-[#0c1626]/60 backdrop-blur-md p-3 h-full flex flex-col">
              <MapViewLazy
                className="h-[400px] w-full lg:h-full min-h-[380px]"
                markers={markers}
                center={mapCenter}
                userCoords={location ? { lat: location.latitude, lng: location.longitude } : null}
                onPick={setManualLocation}
              />
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400 px-1">
                <button
                  type="button"
                  onClick={requestBrowserLocation}
                  className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 font-medium"
                >
                  📍 {location ? "به‌روزرسانی موقعیت من" : "یافتن موقعیت من با GPS"}
                </button>
                <span className="text-[11px] text-slate-500">
                  {location ? "برای تغییر مکان، روی نقشه کلیک کنید" : "امکان انتخاب دستی با کلیک روی نقشه"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050B14] flex items-center justify-center text-slate-400 text-sm">
          در حال بارگذاری صفحه جست‌وجو…
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
