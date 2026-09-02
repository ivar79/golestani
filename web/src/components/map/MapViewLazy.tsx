"use client";

import dynamic from "next/dynamic";
import type { MapMarker, MapViewProps } from "./MapView";

export type { MapMarker, MapViewProps };

/**
 * SSR-safe wrapper: Leaflet touches `window` at import time, so the actual
 * map is dynamically imported with ssr:false. Consumers import from HERE,
 * never from MapView directly.
 */
const MapViewClient = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-surface-variant">
      در حال بارگذاری نقشه…
    </div>
  ),
});

export default function MapViewLazy(props: MapViewProps) {
  return <MapViewClient {...props} />;
}
