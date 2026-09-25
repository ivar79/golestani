"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import axios from "axios";
import {
  searchBusinesses,
  getSearchFacets,
  type Business,
  type SearchFacets,
} from "@/lib/businesses";
import { extractApiError, default as api } from "@/lib/api";
import { resolveMediaUrl } from "@/lib/businessSafety";
import SearchHeader from "@/components/search/SearchHeader";
import { ThemeProvider, useTheme } from "@/components/dashboard/ThemeProvider";
import { useLocationPick } from "@/hooks/useLocationPick";
import LocationChip from "@/components/search/LocationChip";
import MiniCard from "@/components/search/MiniCard";
import { formatDistance } from "@/lib/format";
import SearchFilters, {
  DEFAULT_FILTERS,
  type SearchFiltersState,
} from "@/components/search/SearchFilters";
import SearchResultsSplitView, {
  type SplitViewCardData,
} from "@/components/search/SearchResultsSplitView";
import type { MapMarker } from "@/components/map/MapView";
import { searchIranLocations, getProvince } from "@/lib/iranGeo";

/**
 * Phase 3 contract: the first 4 list slots are reserved for promoted
 * (special/advertised) cards — the server already sorts is_promoted DESC
 * before distance, so the first four promoted results are exactly the
 * contract's "4 مینی‌کارت اول".
 */
const PROMOTED_CARD_CAP = 4;

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
  const routeParams = useParams();

  const rawRouteCity = typeof routeParams?.city === "string" ? routeParams.city : null;
  const rawRouteCategory =
    typeof routeParams?.category === "string"
      ? routeParams.category
      : typeof routeParams?.slug === "string"
      ? routeParams.slug
      : null;

  const initialCity =
    (rawRouteCity ? decodeURIComponent(rawRouteCity) : null) ??
    searchParams.get("city") ??
    null;
  const initialCategory =
    (rawRouteCategory ? decodeURIComponent(rawRouteCategory) : null) ??
    searchParams.get("category") ??
    null;
  const initialQ = searchParams.get("q") ?? "";

  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState<Business[]>([]);
  // Phase 3 cold-start pins — map-only. Kept separate from `items` so they
  // can never appear as result cards and never affect the result counter.
  const [unclaimedItems, setUnclaimedItems] = useState<Business[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [filters, setFilters] = useState<SearchFiltersState>({
    ...DEFAULT_FILTERS,
    city: initialCity,
    category: initialCategory,
  });
  const abortRef = useRef<AbortController | null>(null);
  const locationState = useLocationPick();
  const {
    location,
    restored,
    setManualLocation,
    error: locationError,
  } = locationState;
  // Theme drives the shell's data-theme in render (no first-paint navy flash)
  // and the brand logo tone.
  const { theme } = useTheme();

  // Determine map center: prefer user location, fallback to selected city/province coords, fallback to Tehran
  const [mapCenter, setMapCenter] = useState<[number, number]>([35.6892, 51.389]);

  useEffect(() => {
    if (filters.city) {
      const prov = getProvince(filters.city);
      if (prov) {
        setTimeout(() => setMapCenter([prov.lat, prov.lng]), 0);
        return;
      }
      const matches = searchIranLocations(filters.city, 1);
      if (matches.length > 0) {
        setTimeout(() => setMapCenter([matches[0].lat, matches[0].lng]), 0);
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
            neighborhood: f.neighborhood || undefined,
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
        // Phase 3: cold-start (unclaimed) pins are delivered in their own key
        // — they are map-only and never consume a pagination slot.
        setUnclaimedItems(result.unclaimed ?? []);
        // The counter describes exactly the visible (claimed) card list.
        setTotal(result.pagination?.total ?? result.data?.length ?? null);
      } catch (err: unknown) {
        if (isCancellation(err)) return;
        setError(extractApiError(err));
        setItems([]);
        setUnclaimedItems([]);
        setTotal(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    []
  );

  // Single owner of the initial + location-driven (re)search.
  //
  // It waits for the location hook's one-time restore to settle BEFORE the
  // first fetch. Without this, a restored saved location lands a moment after
  // mount and triggers a SECOND search right after the initial one — a double
  // fetch plus a visible flash of the wrong ("no location") result set. After
  // restore, the same effect re-runs on every later location change (GPS pick /
  // map pick / clear). Text/filter changes trigger their own explicit search.
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => void runSearch(q, filters, location), 0);
    return () => clearTimeout(t);
    // q/filters are read from the closure of the render that changed the
    // location/restore state; they are intentionally not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, restored]);

  // Re-search when filters change (explicit user action).
  const applyFilters = useCallback(
    (next: SearchFiltersState) => {
      setFilters(next);
      void runSearch(q, next, location);
    },
    [q, location, runSearch]
  );

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

  // Phase 3: the server separates the two sets. Claimed rows (`items`) are
  // the listable results; unclaimed cold-start rows (`unclaimedItems`) exist
  // only as gray map pins so the map never looks empty. Pins = both sets.
  const markers: MapMarker[] = [...items, ...unclaimedItems]
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({
      id: b.id,
      latitude: b.latitude as number,
      longitude: b.longitude as number,
      title: b.name,
      subtitle: [
        b.category,
        // Same human format as the MiniCard: متر under 1km, کیلومتر above.
        typeof b.distance === "number" ? formatDistance(b.distance) : null,
      ]
        .filter(Boolean)
        .join(" — "),
      href: `/b/${b.slug}`,
      category: b.category,
      distance: b.distance ?? null,
      // Phase 3: unclaimed businesses render a gray pin with a simple popup.
      unclaimed: b.is_claimed === false,
      // Phase 3: promoted pins get the star/gold styling on the map.
      promoted: b.is_promoted === true,
      // Phase 3: popup logo slot (resolved to an absolute media URL).
      logoUrl: resolveMediaUrl(api.defaults.baseURL || "", b.logo ?? null),
    }));

  // Result cards come from the claimed set only — the API already excludes
  // unclaimed rows from `data`, so no client-side filtering is needed (and
  // pagination total/last_page match this list exactly).
  const cards: SplitViewCardData[] = items.map((b, index) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    category: b.category,
    city: b.city,
    neighborhood: b.neighborhood,
    verification_badge: b.verification_badge,
    distance: b.distance ?? null,
    featured:
      // Phase 3: promoted businesses wear the ویژه styling — capped to the
      // first 4 list slots (server sorts promoted first, then by distance).
      (index < PROMOTED_CARD_CAP && b.is_promoted === true) ||
      filters.showcase ||
      (Array.isArray(b.badges) && b.badges.includes("showcase")),
    // Phase 3 static license badge — presentation only, no verification workflow.
    license_verified: b.license_verified === true,
    license_tracking_code: b.license_tracking_code ?? null,
    phone: b.phone ?? null,
    latitude: b.latitude ?? null,
    longitude: b.longitude ?? null,
  }));

  const renderCard = useCallback(
    (card: SplitViewCardData) => <MiniCard business={card} />,
    []
  );

  const emptyState = (
    <div className="rounded-2xl border border-ik-border bg-ik-wash p-8 text-center text-sm text-ik-muted">
      <p className="mb-1 font-medium text-ik-text">کسب‌وکاری در این محدوده یافت نشد.</p>
      <p className="text-xs text-ik-muted">
        فیلترها را تغییر دهید یا شهر دیگری را انتخاب کنید.
      </p>
    </div>
  );

  return (
    /* Same theme architecture as the User Panel: the shell class scopes the
       --ik-* tokens and data-theme is set in render (like the dashboard) so
       the first paint is already the Warm Editorial palette — no navy flash.
       The search page's own SearchHeader replaces the marketing AppTaskbar so
       the whole surface shares one design language. */
    <div
      dir="rtl"
      data-theme={theme}
      className="dashboard-shell flex min-h-screen flex-col bg-ik-bg text-ik-text selection:bg-ik-accent/20"
    >
      <SearchHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-6 sm:pt-8">
        {/* Search header form with the location chip */}
        <form
          onSubmit={submit}
          className="relative z-30 grid gap-3 rounded-2xl border border-ik-border bg-ik-panel/80 p-3 sm:p-4 md:grid-cols-[1fr_auto]"
        >
          {/* Mobile-first: chip and input stack on narrow screens, share a row
              from sm up. min-w-0 keeps the input from forcing page overflow. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <LocationChip location={locationState} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="چه چیزی پیدا می‌کنید؟ (نام شغل، محصول، کلمه کلیدی یا مکان...)"
              className="w-full min-w-0 rounded-xl border border-ik-border bg-ik-wash p-3.5 text-base text-ik-text outline-none transition-colors placeholder:text-ik-muted focus:border-ik-accent/40 sm:p-4"
            />
          </div>
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-ik-accent px-8 py-3.5 text-base font-bold text-ik-accent-contrast shadow-sm transition-colors hover:bg-ik-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
            disabled={loading}
          >
            {loading ? "در حال جست‌وجو…" : "جست‌وجو"}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-2xl border border-ik-danger/30 bg-ik-danger/10 p-4 text-sm text-ik-danger">
            {error}
          </p>
        )}
        {locationError && (
          <p className="mt-4 rounded-2xl border border-ik-warning/30 bg-ik-warning/10 p-4 text-sm text-ik-warning">
            {locationError}
          </p>
        )}

        {/* Filter bar above the split view */}
        <div className="mt-6 rounded-2xl border border-ik-border bg-ik-panel/60">
          <SearchFilters
            filters={filters}
            onChange={applyFilters}
            facets={facets}
            resultCount={total}
            loading={loading}
            hasLocation={!!location}
          />
        </div>

        {/* Split view: list + sticky map with two-way sync + mobile toggle */}
        <div className="mt-6">
          <SearchResultsSplitView
            markers={markers}
            cards={cards}
            renderCard={renderCard}
            center={mapCenter}
            userCoords={location ? { lat: location.latitude, lng: location.longitude } : null}
            onPick={setManualLocation}
            loading={loading}
            emptyState={emptyState}
          />
        </div>
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-ik-bg flex items-center justify-center text-ik-muted text-sm">
          در حال بارگذاری صفحه جست‌وجو…</div>
      }
    >
      <ThemeProvider>
        <SearchPageContent />
      </ThemeProvider>
    </Suspense>
  );
}
