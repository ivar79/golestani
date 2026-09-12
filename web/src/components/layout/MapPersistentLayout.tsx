"use client";

import { type ReactNode } from "react";
import MapCanvasLazy from "@/components/map/MapCanvasLazy";
import { MapProvider } from "@/contexts/MapContext";
import type { MapMarkerData } from "@/components/map/MapCanvas";

interface MapPersistentLayoutProps {
  children?: ReactNode;
  markers?: MapMarkerData[];
  selectedId?: number | string | null;
  onSelectMarker?: (id: number | string) => void;
  center?: [number, number];
  zoom?: number;
}

/**
 * ساختار لایوت پایدار نقشه (مطابق بند ۳.۲ سند معماری Opus 5)
 * نقشه در سطح لایوت بارگذاری شده و بین تغییر مسیرها unmount نمی‌شود.
 */
export default function MapPersistentLayout({
  children,
  markers = [],
  selectedId = null,
  onSelectMarker,
  center = [51.389, 35.6892],
  zoom = 11,
}: MapPersistentLayoutProps) {
  return (
    <MapProvider>
      <div className="relative flex h-screen w-full overflow-hidden bg-[#0e1726]">
        {/* بوم پایدار نقشه در پس‌زمینه لایوت */}
        <div className="absolute inset-0 z-0 h-full w-full">
          <MapCanvasLazy
            center={center}
            zoom={zoom}
            markers={markers}
            selectedId={selectedId}
            onSelectMarker={onSelectMarker}
            className="h-full w-full"
          />
        </div>

        {/* پنل محتوا / اسلات‌های تعاملی که بر روی نقشه قرار می‌گیرند */}
        {children && (
          <div className="relative z-10 pointer-events-none flex h-full w-full">
            <div className="pointer-events-auto h-full w-full">
              {children}
            </div>
          </div>
        )}
      </div>
    </MapProvider>
  );
}
