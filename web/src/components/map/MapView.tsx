"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { LeafletMouseEvent } from "leaflet";
import "leaflet/dist/leaflet.css";
import { businessMarkerIcon, userLocationMarkerIcon, activeMarkerIcon } from "./leafletIcons";

export type MapMarker = {
  id: number | string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  href?: string;
  category?: string;
  distance?: number | null;
};

export type MapViewProps = {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  userCoords?: { lat: number; lng: number } | null;
  selectedId?: number | string | null;
  onPick?: (lat: number, lng: number) => void;
  className?: string;
};

function MapController({
  markers,
  center,
  zoom,
  userCoords,
}: {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  userCoords?: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];
    if (userCoords?.lat && userCoords?.lng) {
      points.push([userCoords.lat, userCoords.lng]);
    }
    markers.forEach((m) => {
      if (Number.isFinite(m.latitude) && Number.isFinite(m.longitude)) {
        points.push([m.latitude, m.longitude]);
      }
    });

    if (points.length > 1) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], zoom ?? 14);
    } else if (center) {
      map.setView(center, zoom ?? 12);
    }
  }, [markers, center, zoom, userCoords, map]);

  return null;
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView({
  markers,
  center,
  zoom,
  userCoords,
  selectedId,
  onPick,
  className = "h-[460px] w-full",
}: MapViewProps) {
  // Use internal local tile proxy by default for maximum Iranian intranet resilience & caching
  const tileUrl =
    process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "/api/map/tile/{z}/{x}/{y}";
  const attribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
    '&copy; <a href="https://incard.ir">اینکارت</a> | نقشه‌پایه پایدار';

  const defaultCenter: [number, number] = userCoords
    ? [userCoords.lat, userCoords.lng]
    : center ?? [35.6892, 51.389]; // Default: Tehran center

  return (
    <div className={className} dir="ltr">
      <MapContainer
        center={defaultCenter}
        zoom={zoom ?? 12}
        scrollWheelZoom
        className="h-full w-full rounded-2xl sm:rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm"
      >
        <TileLayer url={tileUrl} attribution={attribution} maxZoom={19} />

        {/* User Location Marker */}
        {userCoords?.lat && userCoords?.lng && (
          <Marker
            position={[userCoords.lat, userCoords.lng]}
            icon={userLocationMarkerIcon}
          >
            <Popup>
              <div dir="rtl" className="p-1 text-xs font-bold text-blue-600 text-center">
                📍 موقعیت مکانی شما
              </div>
            </Popup>
          </Marker>
        )}

        {/* Business Markers */}
        {markers.map((m) =>
          Number.isFinite(m.latitude) && Number.isFinite(m.longitude) ? (
            <Marker
              key={m.id}
              position={[m.latitude, m.longitude]}
              icon={m.id === selectedId ? activeMarkerIcon : businessMarkerIcon}
            >
              <Popup>
                <div dir="rtl" className="p-2 min-w-[160px] text-right font-sans">
                  <strong className="block text-sm text-slate-900 font-bold mb-1">
                    {m.title}
                  </strong>
                  {m.category && (
                    <span className="inline-block text-xs text-slate-500 mb-1">
                      {m.category}
                    </span>
                  )}
                  {m.distance != null && (
                    <div className="text-xs text-emerald-700 font-medium my-1">
                      فاصله: {m.distance < 1000 ? `${Math.round(m.distance)} متر` : `${(m.distance / 1000).toFixed(1)} کیلومتر`}
                    </div>
                  )}
                  {m.href && (
                    <a
                      href={m.href}
                      className="mt-2 block w-full py-1 px-2.5 bg-[#0b1626] hover:bg-[#00c98d] hover:text-[#0b1626] text-white text-xs font-bold rounded-lg text-center transition-colors"
                    >
                      مشاهده پروفایل و کارت →
                    </a>
                  )}
                </div>
              </Popup>
            </Marker>
          ) : null
        )}

        <MapController
          markers={markers}
          center={center}
          zoom={zoom}
          userCoords={userCoords}
        />
        {onPick && <ClickPicker onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
