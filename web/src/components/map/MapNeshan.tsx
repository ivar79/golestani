"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type maplibregl from "@neshan-maps-platform/maplibre-sdk";
import {
  FAILURE_KIND_INIT,
  FAILURE_KIND_TILE,
  type FailureKind,
  INITIAL_PROVIDER_HEALTH,
  neshanApiKey,
  neshanKeyPresent,
  neshanStyleUrl,
  recordNeshanFailure,
  resetTileFailureWindow,
} from "@/lib/mapEngine";
import { buildPopupDom } from "@/lib/mapPopupDom";
import type { MapMarker, MapViewProps } from "./MapView";

/** Props engine برای گزارش خطا/بازیابی به دیسپچر MapView (لایهٔ fallback). */
export type EngineEvents = {
  onEngineFailed?: (engine: "neshan" | "online", kind: FailureKind) => void;
  onEngineRecovered?: (engine: "neshan" | "online") => void;
};

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
  onEngineFailed,
  onEngineRecovered,
}: MapViewProps & EngineEvents) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<MLMap | null>(null);
  const mlMarkersRef = useRef<MLMarker[]>([]);
  const mlPopupRef = useRef<InstanceType<typeof maplibregl.Popup> | null>(null);

  // هندلرها در ref پایدار نگه داشته می‌شوند تا listeners به هویت تابع صفحه وابسته نباشند.
  const onSelectRef = useRef(onSelectMarker);
  const onPickRef = useRef(onPick);
  /** openBusinessPopup lives in a ref because marker listeners close over it. */
  const openPopupRef = useRef<(map: MLMap, item: MapMarker) => void>(() => {});
  // شمارش خطاهای بحرانی تایل/استایل در پنجرهٔ کوتاه — طبق state machine لایهٔ mapEngine.
  const tileHealthRef = useRef({ ...INITIAL_PROVIDER_HEALTH });
  const failCbRef = useRef(onEngineFailed);
  const recoverCbRef = useRef(onEngineRecovered);
  useEffect(() => {
    failCbRef.current = onEngineFailed;
  }, [onEngineFailed]);
  useEffect(() => {
    recoverCbRef.current = onEngineRecovered;
  }, [onEngineRecovered]);
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

    // گارد کلید: بدون کلید نشان، SDK اصلاً instantiate نمی‌شود تا استثنای
    // «Api key is not defined!» به کنسول/DevTools نریزد. به‌جای نمایش صفحهٔ
    // خطا، خرابی init به دیسپچر MapView گزارش می‌شود تا موتور جایگزین
    // (Leaflet) بی‌صدا فعال شود — تجربهٔ کاربر سالم می‌ماند.
    if (!neshanKeyPresent) {
      failCbRef.current?.("neshan", FAILURE_KIND_INIT);
      return;
    }

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
          // نشان با موفقیت بالا آمد: شمارنده‌های خرابی صفر می‌شود تا
          // fallback/retry state machine بتواند دوباره نشان را ترجیح دهد.
          recoverCbRef.current?.("neshan");
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

        // خطاهای سطح اجرا (کلید نامعتبر، سهمیه، استایل در دسترس نیست).
        // طبقه‌بندی: خطای کلید/سهمیه/استایل = بحرانی (شمارش برای اعلام خرابی
        // موتور)؛ خطای گذرا فقط warn. با رسیدن به آستانهٔ state machine، خرابی
        // به دیسپچر گزارش می‌شود تا fallback انجام شود.
        map.on("error", (e: { error?: { message?: string } }) => {
          const msg = e.error?.message ?? "";
          if (/Api key|KeyNotFound|LimitExceeded|RateExceeded|48[0-3]|Failed to fetch|style/i.test(msg)) {
            const nowMs = Date.now();
            const failed = recordNeshanFailure(tileHealthRef.current, FAILURE_KIND_TILE, nowMs);
            if (failed && !cancelled) {
              resetTileFailureWindow(tileHealthRef.current);
              failCbRef.current?.("neshan", FAILURE_KIND_TILE);
            }
          } else if (msg && !msg.includes("404")) {
            console.warn("Neshan engine warning:", msg);
          }
        });
      } catch (err) {
        console.error("خطا در ساخت نقشهٔ نشان:", err);
        // init failure → سقوط فوری به fallback (بدون صفحهٔ خطا برای کاربر).
        if (!cancelled) failCbRef.current?.("neshan", FAILURE_KIND_INIT);
      }
    })();

    return () => {
      cancelled = true;
      mlPopupRef.current?.remove();
      mlPopupRef.current = null;
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

      // پین موقعیت کاربر — فقط markup ثابت (بدون دادهٔ کاربر) با DOM API.
      if (userCoords?.lat != null && userCoords?.lng != null) {
        const el = document.createElement("div");
        el.className = "cursor-pointer z-20";
        const wrap = document.createElement("div");
        wrap.className = "relative flex items-center justify-center";
        const dot = document.createElement("div");
        dot.className =
          "w-4 h-4 rounded-full bg-ik-accent border-2 border-white shadow-md shadow-ik-accent/50";
        wrap.appendChild(dot);
        el.appendChild(wrap);
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
        const isUnclaimed = item.unclaimed === true; // Phase 3: gray pin for unclaimed
        const isPromoted = item.promoted === true; // Phase 3: gold star pin for promoted
        // پین‌های مارکر: فقط markup ثابت کامپوننت (رنگ/آیکون بر اساس state)،
        // بدون هیچ interpolation دادهٔ کسب‌وکار — با DOM API (ضد XSS).
        const el = document.createElement("div");
        el.className = `cursor-pointer transition-transform duration-200 ${
          isSelected ? "scale-125 z-30" : "z-10 hover:scale-110"
        }`;
        const wrap = document.createElement("div");
        wrap.className = "relative flex items-center justify-center";
        const badge = document.createElement("div");
        // Pin colors come from the --ik-* tokens (resolved through the
        // .dashboard-shell ancestor) so pins follow the active theme.
        badge.className = `w-8 h-8 rounded-full flex items-center justify-center ${
          isSelected
            ? "bg-ik-accent text-ik-accent-contrast shadow-lg shadow-ik-accent/40"
            : isUnclaimed
              ? "bg-ik-muted/35 text-ik-muted border border-ik-border shadow-md"
              : isPromoted
                ? "bg-ik-warning text-ik-accent-contrast border border-ik-warning/70 shadow-md"
                : "bg-ik-panel/90 text-ik-accent border border-ik-accent/40 shadow-md"
        }`;
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "w-4 h-4");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.5");
        const pinPath = document.createElementNS(NS, "path");
        pinPath.setAttribute("d", "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z");
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "10");
        circle.setAttribute("r", "3");
        svg.appendChild(pinPath);
        svg.appendChild(circle);
        if (isPromoted) {
          const star = document.createElementNS(NS, "path");
          star.setAttribute(
            "d",
            "M12 4.8l1.6 3.2 3.5.5-2.55 2.5.6 3.5L12 12.9l-3.15 1.6.6-3.5L6.9 8.5l3.5-.5L12 4.8z",
          );
          star.setAttribute("fill", "currentColor");
          star.setAttribute("stroke", "none");
          svg.appendChild(star);
        }
        badge.appendChild(svg);
        wrap.appendChild(badge);
        el.appendChild(wrap);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current?.(item.id);
          openPopupRef.current(map, item);
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
  // نقشه داخل toggle لیست/نقشه مونت می‌شود: ظرف مخفی 0×0 است و fit اولیه
  // غلط محاسبه می‌شود. بعد از اولین اندازهٔ واقعی (sizeTick) fit تکرار می‌شود.
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const el = mountRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setSizeTick((v) => v + 1), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (t) clearTimeout(t);
    }; 
  }, [mapInstance]);

  useEffect(() => {
    const map = mapInstance;
    if (!map || !autoFit) return;
    const el = mountRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;

    // Viewport parity with MapController (Leaflet): the user pin joins the
    // fit like every marker, so both engines frame the same area.
    const pts: Array<[number, number]> = [];
    if (userCoords?.lat != null && userCoords?.lng != null) {
      pts.push([userCoords.lat, userCoords.lng]);
    }
    for (const m of markers) {
      if (Number.isFinite(m.latitude) && Number.isFinite(m.longitude)) {
        pts.push([m.latitude, m.longitude]);
      }
    }
    if (pts.length >= 2) {
      const bounds: BoundsLike = [
        [Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[0]))],
        [Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0]))],
      ];
      map.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: 800, essential: true });
    } else if (pts.length === 1) {
      // Single point — Leaflet parity: explicit zoom ?? 14 instead of
      // max(current, 13), so a GPS-only view starts at the same scale.
      map.flyTo({
        center: [pts[0][1], pts[0][0]],
        zoom: zoom ?? 14,
        duration: 600,
        essential: true,
      });
    } else if (center) {
      // center از صفحات با قرارداد قدیمی Leaflet به‌صورت [lat, lng] می‌آید.
      map.flyTo({ center: [center[1], center[0]], zoom: zoom ?? 12, duration: 600, essential: true });
    }
    // Viewport parity with MapController (Leaflet): identical dependency set
    // (markers / userCoords / center / zoom / autoFit + sizeTick) so both
    // engines re-fit on exactly the same inputs. Notably the user's own
    // location joins the fit in both — a location change never leaves the
    // user pin outside the frame, and neither engine refits without the other.
  }, [mapInstance, markers, userCoords, center, zoom, autoFit, sizeTick]);

  /** RTL popup — ساخته‌شده با DOM-safe builder ( ضد XSS؛ بدون innerHTML). */
  const openBusinessPopup = useCallback(
    (map: MLMap, item: MapMarker) => {
      void (async () => {
        const maplibregl = (await import("@neshan-maps-platform/maplibre-sdk")).default;
        mlPopupRef.current?.remove();
        // Phase 3 semantics live in the shared builder: unclaimed → lightweight
        // approved copy + only the /login claim CTA; claimed → logo + info + CTA.
        // Security: business-controlled strings are set via textContent inside
        // buildPopupDom — never interpolated into HTML.
        const html = buildPopupDom(item);
        const popup = new maplibregl.Popup({ offset: 28, closeButton: true, maxWidth: "240px" })
          .setLngLat([item.longitude, item.latitude])
          .setDOMContent(html)
          .addTo(map);
        mlPopupRef.current = popup;
      })();
    },
    [],
  );

  // Keep the stable ref pointing at the latest implementation.
  useEffect(() => {
    openPopupRef.current = openBusinessPopup;
  }, [openBusinessPopup]);

  // Re-open the popup when selection changes from the list side too.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !selectedId || selectedId === "__user__") return;
    const item = markers.find((m) => m.id === selectedId);
    if (item) openBusinessPopup(map, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, selectedId, openBusinessPopup]);

  // فقط خطاهای runtime واقعی (که fallback هم نجات‌شان نمی‌دهد) به کاربر نشان
  // داده می‌شوند؛ «کلید تنظیم نشده» دیگر صفحهٔ خطا نمی‌سازد — دیسپچر MapView
  // خودکار به Leaflet سوییچ می‌کند و پیام فنی فقط در dev لازم است.
  const handleRetry = useCallback(() => window.location.reload(), []);
  const error = !neshanKeyPresent && process.env.NODE_ENV === "development"
    ? "NEXT_PUBLIC_NESHAN_MAP_KEY تنظیم نشده — fallback Leaflet فعال شد (فقط پیام dev)."
    : null;

  return (
    <div className={className} dir="ltr">
      <div ref={mountRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ik-bg/85 p-6 text-center backdrop-blur-sm">
          <p className="max-w-md text-sm font-bold leading-relaxed text-ik-danger">{error}</p>
          <p className="max-w-md text-xs leading-relaxed text-ik-muted">
            می‌توانید موقتاً از نقشهٔ جایگزین آنلاین استفاده کنید:
            <code className="mx-1 rounded bg-ik-wash px-1.5 py-0.5 font-mono text-[11px] text-ik-accent" dir="ltr">
              ?mapsource=online
            </code>
          </p>
          {/* نکته: این پیام فقط برای خطاهای runtime بحرانی (پس از تلاش fallback) نشان داده می‌شود؛ در حالت عادی دیسپچر MapView خودکار موتور جایگزین را فعال می‌کند. */}
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-xl border border-ik-border bg-ik-wash px-4 py-2 text-xs font-semibold text-ik-text transition-colors hover:bg-ik-wash-hover"
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
