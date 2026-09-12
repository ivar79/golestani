"use client";

import MapNeshanLazy from "./MapNeshanLazy";
import MapViewLazy from "./MapViewLazy";
import type { MapMarker } from "./MapViewLeaflet";
import { resolveMapEngine } from "@/lib/mapEngine";

export type { MapMarker };

export type MapViewProps = {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  userCoords?: { lat: number; lng: number } | null;
  selectedId?: number | string | null;
  onPick?: (lat: number, lng: number) => void;
  onSelectMarker?: (id: number | string) => void;
  className?: string;
  /** هم‌تراز کردن دید با مارکرها پس از هر به‌روزرسانی (پیش‌فرض فعال) */
  autoFit?: boolean;
};

/**
 * دیسپچر موتور نقشه — دو موتور سوییچ‌پذیر با قرارداد props یکسان:
 *
 *   neshan  → SDK رسمی نشان (موتور اصلی؛ تایل میزبانی‌شده + لیبل فارسی)
 *   online  → Leaflet + رستر عمومی OSM (fallback؛ همیشه کار می‌کند)
 *
 * انتخاب موتور: ?mapsource=neshan|online → NEXT_PUBLIC_MAP_ENGINE →
 * خودکار (neshan اگر کلید نشان موجود باشد، وگرنه online). جزئیات در
 * web/src/lib/mapEngine.ts.
 */
export default function MapView(props: MapViewProps) {
  if (resolveMapEngine() === "online") {
    return <MapViewLazy {...props} />;
  }
  return <MapNeshanLazy {...props} />;
}
