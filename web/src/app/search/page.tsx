"use client";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { searchBusinesses, type Business } from "@/lib/businesses";
import { extractApiError } from "@/lib/api";
import AppTaskbar from "@/components/layout/AppTaskbar";
import MapViewLazy, { type MapMarker } from "@/components/map/MapViewLazy";
import { useLocationPick } from "@/hooks/useLocationPick";
import MiniCard from "@/components/search/MiniCard";

/** True for axios cancellation errors — these are expected, not user-facing failures. */
function isCancellation(err: unknown): boolean {
  return (
    axios.isCancel(err) ||
    (typeof err === "object" && err !== null &&
      ((err as { name?: string }).name === "CanceledError" ||
        (err as { name?: string }).name === "AbortError"))
  );
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { location, requestBrowserLocation, setManualLocation, error: locationError } = useLocationPick();

  /**
   * Search with stale-response protection: every new request aborts the
   * previous one, so slow dev-API responses can never overwrite fresh results.
   */
  async function runSearch(params: { q?: string; city?: string }) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const geo = location ? { latitude: location.latitude, longitude: location.longitude } : {};
      const result = await searchBusinesses(
        { ...params, ...geo, limit: 20 },
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setItems(result.data ?? (result as unknown as Business[]));
    } catch (err) {
      if (isCancellation(err)) return;
      setError(extractApiError(err));
      setItems([]);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  // Initial load (no filters). Aborted on unmount to avoid stray state writes.
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    searchBusinesses({ limit: 20 }, { signal: ac.signal })
      .then((r) => {
        if (!ac.signal.aborted) setItems(r.data ?? (r as unknown as Business[]));
      })
      .catch((err) => {
        if (ac.signal.aborted || isCancellation(err)) return;
        setError(extractApiError(err));
        setItems([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch({ q: q || undefined, city: city || undefined });
  }

  const markers: MapMarker[] = items
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({
      id: b.id,
      latitude: b.latitude as number,
      longitude: b.longitude as number,
      title: b.name,
      subtitle: [b.category, b.distance ? `${Math.round(b.distance)} متر` : null]
        .filter(Boolean)
        .join(" — "),
      href: `/b/${b.slug}`,
    }));

  return (
    <main dir="rtl" className="min-h-screen bg-night px-4 pb-10 pt-36 text-white">
      <AppTaskbar />
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-black">جست‌وجوی کسب‌وکار</h1>
        <form
          onSubmit={submit}
          className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-[1fr_220px_auto_auto]"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="نام، خدمت یا دسته‌بندی"
            className="rounded-xl bg-white/10 p-4 outline-none"
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="شهر"
            className="rounded-xl bg-white/10 p-4 outline-none"
          />
          <button
            type="button"
            onClick={requestBrowserLocation}
            title="موقعیت من"
            className="btn btn-secondary btn-md"
          >
            {location ? "موقعیت ذخیره‌شده" : "موقعیت من"}
          </button>
          <button type="submit" className="btn btn-primary btn-md px-6 font-bold">
            {loading ? "در حال جست‌وجو…" : "جست‌وجو"}
          </button>
        </form>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="grid gap-4">
            {(error || locationError) && (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {error ?? locationError}
              </p>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-surface-variant">
                کسب‌وکاری یافت نشد. فیلترها را تغییر دهید یا شهر دیگری را جست‌وجو کنید.
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
                  featured: Array.isArray(b.badges) && b.badges.includes("showcase"),
                }}
              />
            ))}
          </section>
          <MapViewLazy
            className="h-[560px] w-full"
            markers={markers}
            onPick={setManualLocation}
          />
        </div>
      </div>
    </main>
  );
}
