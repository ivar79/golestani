"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { Map as MLMap } from "maplibre-gl";
import type { MapMarkerData } from "@/components/map/MapCanvas";

interface MapContextValue {
  mapInstance: MLMap | null;
  setMapInstance: (map: MLMap | null) => void;
  markers: MapMarkerData[];
  setMarkers: (markers: MapMarkerData[]) => void;
  selectedId: number | string | null;
  setSelectedId: (id: number | string | null) => void;
  flyTo: (lng: number, lat: number, zoom?: number) => void;
}

const MapContext = createContext<MapContextValue | null>(null);

/**
 * کانتکست سراسری مدیریت چرخه حیات نقشه
 * این کانتکست به کامپوننت‌های فرانت‌اند اجازه می‌دهد بدون Re-mount کردن نقشه
 * زاویه دید را تغییر داده یا مارکرها را به‌روز کنند.
 */
export function MapProvider({ children }: { children: ReactNode }) {
  const [mapInstance, setMapInstance] = useState<MLMap | null>(null);
  const [markers, setMarkers] = useState<MapMarkerData[]>([]);
  const [selectedId, setSelectedId] = useState<number | string | null>(null);

  const flyTo = (lng: number, lat: number, zoom = 14) => {
    if (mapInstance) {
      mapInstance.flyTo({
        center: [lng, lat],
        zoom,
        essential: true,
      });
    }
  };

  return (
    <MapContext.Provider
      value={{
        mapInstance,
        setMapInstance,
        markers,
        setMarkers,
        selectedId,
        setSelectedId,
        flyTo,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext() {
  const ctx = useContext(MapContext);
  if (!ctx) {
    throw new Error("useMapContext باید داخل MapProvider فراخوانی شود.");
  }
  return ctx;
}
