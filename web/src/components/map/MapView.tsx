"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./leafletIcons";

/**
 * MapView — provider-independent map abstraction (M2, contract Phase 3).
 *
 * Everything else in the app consumes THIS component only. Swapping the map
 * provider (OSM -> Map.ir / Neshan / MapLibre) later means touching this file
 * (and the tile URL env var) — no business component ever imports Leaflet.
 *
 * Tiles are env-driven: NEXT_PUBLIC_MAP_TILE_URL + NEXT_PUBLIC_MAP_ATTRIBUTION.
 * Default: OpenStreetMap (free, no key, no billing — no vendor lock-in).
 */

export type MapMarker = {
  id: number | string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  /** Slug of the business page the popup links to. */
  href?: string;
};

export type MapViewProps = {
  markers: MapMarker[];
  /** Map center; defaults to first marker or Tehran. */
  center?: [number, number];
  zoom?: number;
  /** Fired when the user clicks/taps the map (location picking — M3). */
  onPick?: (lat: number, lng: number) => void;
  className?: string;
};

/** Fit the map to contain every marker once they change. */
function FitToMarkers({ markers, center, zoom }: { markers: MapMarker[]; center?: [number, number]; zoom?: number }) {
  const map = useMap();

  useEffect(() => {
    const points = markers
      .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
      .map((m) => [m.latitude, m.longitude] as [number, number]);

    if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], zoom ?? 15);
    } else if (center) {
      map.setView(center, zoom ?? 12);
    }
  }, [markers, center, zoom, map]);

  return null;
}

/** Report map clicks/taps upward for the M3 location-picking flow. */
function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView({
  markers,
  center,
  zoom,
  onPick,
  className = "h-[420px] w-full",
}: MapViewProps) {
  const tileUrl =
    process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const fallbackCenter: [number, number] = center ?? [35.6892, 51.389]; // Tehran
  const initialCenter: [number, number] =
    markers.length === 1 && Number.isFinite(markers[0].latitude)
      ? [markers[0].latitude, markers[0].longitude]
      : fallbackCenter;

  return (
    <div className={className} dir="ltr">
      {/* Leaflet needs an LTR container even on the RTL site. */}
      <MapContainer
        center={initialCenter}
        zoom={zoom ?? 12}
        scrollWheelZoom
        className="h-full w-full rounded-2xl"
      >
        <TileLayer url={tileUrl} attribution={attribution} />
        {markers.map((m) =>
          Number.isFinite(m.latitude) && Number.isFinite(m.longitude) ? (
            <Marker key={m.id} position={[m.latitude, m.longitude]}>
              <Popup>
                <strong>{m.title}</strong>
                {m.subtitle && (
                  <>
                    <br />
                    <span>{m.subtitle}</span>
                  </>
                )}
                {m.href && (
                  <>
                    <br />
                    <a href={m.href}>مشاهده صفحه کسب‌وکار</a>
                  </>
                )}
              </Popup>
            </Marker>
          ) : null,
        )}
        <FitToMarkers markers={markers} center={center} zoom={zoom} />
        {onPick && <ClickPicker onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
