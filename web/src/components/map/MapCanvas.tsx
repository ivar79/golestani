"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl, { Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// پیکربندی پلاگین متن راست‌به‌چپ (RTL) پیش از ساخت نمونه نقشه
if (typeof window !== "undefined") {
  try {
    if (maplibregl.getRTLTextPluginStatus() === "unavailable") {
      maplibregl.setRTLTextPlugin(
        "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js",
        (error) => {
          if (error) {
            console.warn("خطا در بارگذاری پلاگین RTL متون نقشه:", error);
          }
        },
        true // بارگذاری تنبل: فقط در صورت مواجهه با نویسه‌های عربی/فارسی
      );
    }
  } catch (err) {
    console.warn("تنظیم اولیه پلاگین RTL با خطا مواجه شد:", err);
  }
}

export type MapMarkerData = {
  id: number | string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  category?: string;
};

export type MapCanvasProps = {
  center?: [number, number]; // [lng, lat] مطابق استاندارد GeoJSON و MapLibre
  zoom?: number;
  maxZoom?: number;
  styleUrl?: string;
  markers?: MapMarkerData[];
  selectedId?: number | string | null;
  onSelectMarker?: (id: number | string) => void;
  onPick?: (lat: number, lng: number) => void;
  className?: string;
};

/**
 * MapCanvas: کامپوننت پایه نقشه سازگار با Blueprint معماری Opus 5
 * 
 * اصول کلیدی:
 * ۱. جلوگیری قطعی از Remount شدن نقشه با استفاده از آرایه وابستگی خالی در useEffect اولیه
 * ۲. ResizeObserver پایدار برای جلوگیری از اعوجاج در تغییر سایز پنل‌ها
 * ۳. اتصال به استایل Shortbread فارسی با متد Overzoom تا زوم ۱۹
 * ۴. مدیریت تغییر زاویه دید از طریق flyTo به جای ساخت مجدد نمونه نقشه
 */
export default function MapCanvas({
  center = [51.389, 35.6892], // مرکز تهران
  zoom = 11,
  maxZoom = 19,
  styleUrl = "/styles/shortbread-fa.json",
  markers = [],
  selectedId = null,
  onSelectMarker,
  onPick,
  className = "h-full w-full",
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<MLMarker[]>([]);

  // ۱. چرخه حیات اولیه: ساخت نقشه تنها برای یک بار
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: center,
      zoom: zoom,
      maxZoom: maxZoom,
      maxParallelImageRequests: 8, // بهینه‌شده برای پایداری در شبکه‌های داخلی
      attributionControl: true,
    });

    mapRef.current = map;

    // ثبت خطاهای تله‌متری نقشه
    map.on("error", (e) => {
      const msg = e.error?.message ?? "خطای ناشناخته در رندر نقشه";
      if (!msg.includes("404")) {
        console.warn("MapLibre Engine Warning:", msg);
      }
    });

    // ثبت رویداد کلیک جهت انتخاب موقعیت (onPick)
    map.on("click", (e) => {
      if (onPick) {
        onPick(e.lngLat.lat, e.lngLat.lng);
      }
    });

    // اتصال ResizeObserver به نگهدارنده نقشه
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      // بر اساس بند ۳.۲ سند معماری، نقشه در حین ناوبری نباید destroy شود
    };
  }, []); // عمداً خالی است تا نقشه هرگز مجدداً ساخته نشود

  // ۲. مدیریت تغییر مرکز و زوم از طریق flyTo به جای بازسازی نقشه
  useEffect(() => {
    if (!mapRef.current) return;
    const currentCenter = mapRef.current.getCenter();
    const [targetLng, targetLat] = center;

    // اگر تغییر مختصات معنادار بود انیمیشن نرم flyTo اجرا شود
    const dist = Math.hypot(currentCenter.lng - targetLng, currentCenter.lat - targetLat);
    if (dist > 0.0001) {
      mapRef.current.flyTo({
        center: [targetLng, targetLat],
        zoom: zoom,
        essential: true,
        duration: 1000,
      });
    }
  }, [center, zoom]);

  // ۳. به‌روزرسانی مارکرها بدون دستکاری بوم اصلی نقشه
  const updateMarkers = useCallback(() => {
    if (!mapRef.current) return;

    // پاک‌سازی مارکرهای قبلی
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    markers.forEach((item) => {
      if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return;

      const isSelected = selectedId === item.id;

      // ساخت المان DOM مارکر با استایل سفارشی دارک
      const el = document.createElement("div");
      el.className = `cursor-pointer transition-transform duration-200 ${
        isSelected ? "scale-125 z-30" : "hover:scale-110 z-10"
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
        </div>
      `;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectMarker?.(item.id);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([item.longitude, item.latitude])
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    });
  }, [markers, selectedId, onSelectMarker]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" dir="ltr" />
    </div>
  );
}
