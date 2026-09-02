"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Business[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [filters, setFilters] = useState<SearchFiltersState>(DEFAULT_FILTERS);
  const abortRef = useRef<AbortController | null>(null);
  const {
    location,
    requestBrowserLocation,
    setManualLocation,
    error: locationError,
  } = useLocationPick();

  /** Run a search with explicit parameters (no ref reads during render). */
  const runSearch = useCallback(
    async (text: string, f: SearchFiltersState, loc: ReturnType<typeof useLocationPick>["location"]) => {
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
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        setItems(result.data ?? (result as unknown as Business[]));
        setTotal(result.pagination?.total ?? result.data?.length ?? null);
      } catch (err) {
        if (isCancellation(err)) return;
        setError(extractApiError(err));
        setItems([]);
        setTotal(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  // Initial load: single empty-filter search (deferred — effect stays side-effect-free).
  useEffect(() => {
    const t = setTimeout(() => void runSearch("", DEFAULT_FILTERS, null), 0);
    return () => clearTimeout(t);
  }, [runSearch]);

  // Re-search when filters change (user action).
  const applyFilters = useCallback(
    (next: SearchFiltersState) => {
      setFilters(next);
      void runSearch(q, next, location);
    },
    [q, location, runSearch],
  );

  // Re-search when the location changes (browser pick / map pick / clear).
  // Deferred via queueMicrotask so the effect body stays side-effect-free.
  useEffect(() => {
    if (location === null && filters.radius === null && !filters.nearest) return;
    const t = setTimeout(() => void runSearch(q, filters, location), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on location identity change
  }, [location]);

  // Facets for the filter chips (cached server-side).
  useEffect(() => {
    getSearchFacets()
      .then(setFacets)
      .catch(() => setFacets(null)); // chips simply hidden when unavailable
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
        typeof b.distance === "number" ? `${b.distance.toLocaleString("fa-IR")} متر` : null,
      ]
        .filter(Boolean)
        .join(" — "),
      href: `/b/${b.slug}`,
    }));

  return (
    <main dir="rtl" className="min-h-screen bg-night pb-10 pt-36 text-white">
      <AppTaskbar />
      <div className="mx-auto max-w-7xl px-4">
        <form
          onSubmit={submit}
          className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-panel/40 p-4 md:grid-cols-[1fr_auto]"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="چه چیزی پیدا می‌کنید؟"
            className="rounded-xl bg-surface-container-highest/40 p-4 outline-none placeholder:text-on-surface-variant/60"
          />
          <button type="submit" className="btn btn-primary btn-md px-6 font-bold">
            {loading ? "در حال جست‌وجو…" : "جست‌وجو"}
          </button>
        </form>

        {(error || locationError) && (
          <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error ?? locationError}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* Filters + results */}
          <div className="rounded-2xl border border-white/10 bg-panel/40">
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
                <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-surface-variant">
                  کسب‌وکاری یافت نشد. فیلترها را تغییر دهید یا شعاع جست‌وجو را بزرگ‌تر کنید.
                </p>
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

          {/* Real map (provider-independent) */}
          <div className="lg:sticky lg:top-36 lg:h-[calc(100vh-12rem)]">
            <MapViewLazy
              className="h-[420px] w-full lg:h-full"
              markers={markers}
              onPick={setManualLocation}
            />
            <div className="mt-2 flex items-center justify-center gap-3 text-xs text-on-surface-variant">
              <button type="button" onClick={requestBrowserLocation} className="hover:text-white">
                {location ? "برای تغییر موقعیت، روی نقشه کلیک کنید" : "استفاده از موقعیت فعلی"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
