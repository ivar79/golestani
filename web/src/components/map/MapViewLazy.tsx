"use client";

import dynamic from "next/dynamic";
import type { MapMarker, MapViewProps } from "./MapViewLeaflet";

export type { MapMarker, MapViewProps };

/**
 * SSR-safe wrapper for the Leaflet fallback engine: Leaflet touches `window`
 * at import time, so the engine is dynamically imported with ssr:false.
 * (فقط برای موتور fallback — مصرف‌کنندگان باید از MapView استفاده کنند.)
 */
const MapViewLeafletClient = dynamic(() => import("./MapViewLeaflet"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-surface-variant">
      در حال بارگذاری نقشه…
    </div>
  ),
});

export default function MapViewLazy(props: MapViewProps) {
  return <MapViewLeafletClient {...props} />;
}
