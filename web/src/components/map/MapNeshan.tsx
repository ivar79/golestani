"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type maplibregl from "@neshan-maps-platform/maplibre-sdk";
import { neshanApiKey, neshanKeyPresent, neshanStyleUrl } from "@/lib/mapEngine";
import type { MapMarker, MapViewProps } from "./MapView";

// تایپ‌های SDK از طریق namespace پیش‌فرض در دسترس‌اند (export مستقیم ندارند)
type MLMap = InstanceType<typeof maplibregl.Map>;
type MLMarker = InstanceType<typeof maplibregl.Marker>;
type BoundsLike = ConstructorParameters<typeof maplibregl.LngLatBounds>[0];

/**
 * MapNeshan — موتور اصلی نقشه با SDK رسمی نشان.
 *
 * SDK نشان یک جانشین drop-in برای maplibre-gl است: همان کلاس Map، همان
 * متدها، به‌علاوهٔ apiKey اجباری، RTL خودکار برای لیبل‌های فارسی و لوگوی
 * نشان. تایل‌ها از زیرساخت نشان می‌آیند (بدون هیچ فایل محلی).
 *
 * قرارداد props عیناً همان MapViewProps مشترک است تا صفحات هیچ تغییری
 * نکنند (center با ترتیب قدیمی Leaflet یعنی [lat, lng] می‌آید و همین‌جا
 * به ترتیب [lng, lat] خود MapLibre تبدیل می‌شود).
 */
export default function MapNeshan({
  markers = [],
  center,
  zoom,
  userCoords,
  selectedId = null,
  onSelectMarker,
  onPick,
  autoFit = true,
  className = "h-full w-full",
}: MapViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<MLMap | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const mlMarkersRef = useRef<MLMarker[]>([]);

  // هندلرها در ref پایدار نگه داشته می‌شوند تا listeners به هویت تابع صفحه وابسته نباشند.
  const onSelectRef = useRef(onSelectMarker);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onSelectRef.current = onSelectMarker;
  }, [onSelectMarker]);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // ۱. ساخت نمونهٔ نقشه — یک بار در عمر کامپوننت
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let cancelled = false;
    let map: MLMap | null = null;

    void (async () => {
      try {
        // dynamic import تا بستهٔ SDK فقط در صفحات دارای نقشه لود شود
        const maplibregl = (await import("@neshan-maps-platform/maplibre-sdk")).default;
        await import("@neshan-maps-platform/maplibre-sdk/style.css");

        if (cancelled || !mountRef.current) return;

        const view = initialViewFromUrl();
        map = new maplibregl.Map({
          container: mountRef.current,
          style: neshanStyleUrl(),
          center: view.center,
          zoom: view.zoom,
          apiKey: neshanApiKey,
          attributionControl: { compact: true },
          maxZoom: 19,
        }) as unknown as MLMap;

        if (cancelled) {
          map.remove();
          return;
        }
        setMapInstance(map);

        map.on("load", () => {
          if (cancelled) return;
          // همگام‌سازی بی‌صدا دید با URL (replaceState، بدون رندر مجدد)
          let t: ReturnType<typeof setTimeout> | null = null;
          map!.on("moveend", () => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
              const c = map!.getCenter();
              const z = Number(map!.getZoom().toFixed(2));
              const url = new URL(window.location.href);
              url.searchParams.set("lat", c.lat.toFixed(5));
              url.searchParams.set("lng", c.lng.toFixed(5));
              url.searchParams.set("z", String(z));
              window.history.replaceState(null, "", url.toString());
            }, 400);
          });
        });

        // خطاهای سطح اجرا (کلید نامعتبر، سهمیه، استایل در دسترس نیست)
        map.on("error", (e: { error?: { message?: string } }) => {
          const msg = e.error?.message ?? "";
          if (/Api key|KeyNotFound|LimitExceeded|RateExceeded|48[0-3]/i.test(msg)) {
            setRuntimeError("سرویس نقشهٔ نشان در دسترس نیست (کلید نامعتبر یا سهمیه تمام شده).");
          } else if (msg && !msg.includes("404")) {
            console.warn("Neshan engine warning:", msg);
          }
        });
      } catch (err) {
        console.error("خطا در ساخت نقشهٔ نشان:", err);
        if (!cancelled) setRuntimeError("راه‌اندازی نقشهٔ نشان ناموفق بود.");
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      map = null;
      mlMarkersRef.current = [];
    };
  }, []);

  // ۲. کلیک روی بوم → onPick (انتخاب موقعیت در داشبورد)
  useEffect(() => {
    const map = mapInstance;
    if (!map || !onPick) return;
    const handler = (e: { lngLat: { lat: number; lng: number } }) => {
      onPickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [mapInstance, onPick]);

  // ۳. همگام‌سازی مارکرها — فقط لایهٔ DOM عوض می‌شود، بوم دست نمی‌خورد
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    let cancelled = false;

    const sync = async () => {
      const maplibregl = (await import("@neshan-maps-platform/maplibre-sdk")).default;
      if (cancelled) return;

      mlMarkersRef.current.forEach((m) => m.remove());
      mlMarkersRef.current = [];

      const add = (item: MapMarker, el: HTMLDivElement) => {
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map);
        mlMarkersRef.current.push(marker);
      };

      // پین موقعیت کاربر
      if (userCoords?.lat != null && userCoords?.lng != null) {
        const el = document.createElement("div");
        el.className = "cursor-pointer z-20";
        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            <div class="w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_14px_rgba(56,189,248,0.9)]"></div>
          </div>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current?.("__user__");
        });
        add(
          { id: "__user__", latitude: userCoords.lat, longitude: userCoords.lng, title: "موقعیت شما" },
          el
        );
      }

      // مارکرهای کسب‌وکارها
      markers.forEach((item) => {
        if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return;
        const isSelected = selectedId === item.id;
        const el = document.createElement("div");
        el.className = `cursor-pointer transition-transform duration-200 ${
          isSelected ? "scale-125 z-30" : "z-10 hover:scale-110"
        }`;
        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full ${
              isSelected
                ? "bg-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.8)]"
                : "bg-slate-900/90 text-cyan-400 border border-cyan-500/40 shadow-md"
            } flex items-center justify-center">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
          </div>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current?.(item.id);
        });
        add(item, el);
      });
    };

    if (map.loaded()) void sync();
    else map.once("load", () => void sync());

    return () => {
      cancelled = true;
    };
  }, [mapInstance, markers, selectedId, userCoords]);

  // ۴. هم‌ترازی دید (رفتار معادل MapController لیفلت)
  useEffect(() => {
    const map = mapInstance;
    if (!map || !autoFit) return;

    const pts = markers.filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude));
    if (pts.length >= 2) {
      const bounds: BoundsLike = [
        [Math.min(...pts.map((m) => m.longitude)), Math.min(...pts.map((m) => m.latitude))],
        [Math.max(...pts.map((m) => m.longitude)), Math.max(...pts.map((m) => m.latitude))],
      ];
      map.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: 800, essential: true });
    } else if (pts.length === 1) {
      map.flyTo({
        center: [pts[0].longitude, pts[0].latitude],
        zoom: Math.max(map.getZoom(), 13),
        duration: 600,
        essential: true,
      });
    } else if (center) {
      // center از صفحات با قرارداد قدیمی Leaflet به‌صورت [lat, lng] می‌آید.
      map.flyTo({ center: [center[1], center[0]], zoom: zoom ?? 12, duration: 600, essential: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, markers, autoFit]);

  const handleRetry = useCallback(() => window.location.reload(), []);
  const error = runtimeError ?? (neshanKeyPresent ? null : "کلید دسترسی نقشهٔ نشان تنظیم نشده است (NEXT_PUBLIC_NESHAN_MAP_KEY در web/.env.local).");

  return (
    <div className={className} dir="ltr">
      <div ref={mountRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/85 p-6 text-center backdrop-blur-sm">
          <p className="max-w-md text-sm font-bold leading-relaxed text-rose-300">{error}</p>
          <p className="max-w-md text-xs leading-relaxed text-slate-400">
            می‌توانید موقتاً از نقشهٔ جایگزین آنلاین استفاده کنید:
            <code className="mx-1 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300" dir="ltr">
              ?mapsource=online
            </code>
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            تلاش مجدد
          </button>
        </div>
      )}
    </div>
  );
}

/** دید اولیه از URL با اعتبارسنجی محدودهٔ ایران + اصلاح جفت جابه‌جاشده. */
function initialViewFromUrl(): { center: [number, number]; zoom: number } {
  const center: [number, number] = [51.389, 35.6892]; // تهران [lng, lat]
  let zoom = 11;
  try {
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get("lat"));
    const lng = Number(q.get("lng"));
    const z = Number(q.get("z"));
    const inIran = (a: number, b: number) =>
      Number.isFinite(a) && Number.isFinite(b) && a >= 23.5 && a <= 40.3 && b >= 43.5 && b <= 63.9;
    if (inIran(lat, lng)) {
      center[0] = lng;
      center[1] = lat;
    } else if (inIran(lng, lat)) {
      center[0] = lat; // جفت جابه‌جاشده — اصلاح خودکار
      center[1] = lng;
    }
    if (Number.isFinite(z) && z >= 4 && z <= 19) zoom = z;
  } catch {
    /* مقادیر پیش‌فرض */
  }
  return { center, zoom };
}
