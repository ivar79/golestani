"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { LeafletMouseEvent } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  businessMarkerIcon,
  userLocationMarkerIcon,
  activeMarkerIcon,
  unclaimedMarkerIcon,
  promotedMarkerIcon,
} from "./leafletIcons";
import {
  FAILURE_KIND_TILE,
  INITIAL_PROVIDER_HEALTH,
  osmAttribution,
  osmRasterUrl,
  recordTileFailure,
  resetTileFailureWindow,
  type FailureKind,
} from "@/lib/mapEngine";

/** Props engine برای گزارش خطا به دیسپچر MapView (لایهٔ fallback دوطرفه). */
export type EngineEvents = {
  onEngineFailed?: (engine: "neshan" | "online", kind: FailureKind) => void;
  onEngineRecovered?: (engine: "neshan" | "online") => void;
};

export type MapMarker = {
  id: number | string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  href?: string;
  category?: string;
  distance?: number | null;
  /** Phase 3: unclaimed businesses get a gray pin + simple popup (no CTA). */
  unclaimed?: boolean;
  /** Phase 3: promoted (ویژه) businesses get a gold star pin. */
  promoted?: boolean;
  /** Phase 3: absolute logo URL for the claimed-business popup. */
  logoUrl?: string | null;
};

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

function MapController({
  markers,
  center,
  zoom,
  userCoords,
  autoFit,
}: {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  userCoords?: { lat: number; lng: number } | null;
  autoFit: boolean;
}) {
  const map = useMap();
  // نقشه داخل toggle لیست/نقشه مونت می‌شود: وقتی مخفی است ظرف 0x0 است و
  // لیفلت اندازهٔ غلط کش می‌کند و فقط یک تایل ناقص لود می‌کند. بعد از اولین
  // اندازهٔ واقعی، fit مجدد لازم است (sizeTick هم‌زمان افکت fit را دوباره
  // اجرا می‌کند) وگرنه مارکرها خارج از دید محاسبه شده‌اند.
  const [sizeTick, setSizeTick] = useState(0);

  useEffect(() => {
    const el = map.getContainer();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (t) clearTimeout(t);
      t = setTimeout(() => setSizeTick((v) => v + 1), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (t) clearTimeout(t);
    };
  }, [map]);

  useEffect(() => {
    if (!autoFit) return;
    const el = map.getContainer();
    // ظرف هنوز مخفی/0×0 است: fit اکنون بی‌معناست؛ بعد از resize واقعی،
    // sizeTick این افکت را دوباره اجرا می‌کند.
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
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
  }, [markers, center, zoom, userCoords, autoFit, map, sizeTick]);

  return null;
}

/** Keeps the marker popup open for the currently selected business id. */
function SelectedMarkerPopup({ selectedId }: { selectedId: number | string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedId == null) return;
    // Wait for marker layers to settle, then open the matching popup.
    const t = setTimeout(() => {
      map.eachLayer((layer) => {
        const marker = layer as unknown as { getPopup?: () => { isOpen: () => boolean } | null };
        if (typeof marker.getPopup === "function") {
          const popup = marker.getPopup();
          if (popup && (layer as unknown as { options?: { id?: number | string } }).options?.id === selectedId) {
            if (!popup.isOpen()) layer.openPopup();
          }
        }
      });
    }, 350);
    return () => clearTimeout(t);
  }, [selectedId, map]);

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

/**
 * MapViewLeaflet — موتور fallback (Leaflet + رستر مستقل از نشان؛ پیش‌فرض OSM).
 * منبع تایل با NEXT_PUBLIC_LEAFLET_TILE_URL قابل تعویض است (برای بار production
 * باید تأمین‌کنندهٔ مجاز طبق سیاست استفاده تنظیم شود). خطاهای تایل تکراری در
 * پنجرهٔ کوتاه (طبق state machine در mapEngine) به دیسپچر گزارش می‌شوند تا در
 * صورت موجودبودن، تلاش دوبارهٔ موتور نشان انجام شود.
 */
export default function MapViewLeaflet({
  markers,
  center,
  zoom,
  userCoords,
  selectedId,
  onPick,
  onSelectMarker,
  autoFit = true,
  className = "h-[460px] w-full",
  onEngineFailed,
}: MapViewProps & EngineEvents) {
  // رستر آنلاین — قالب تایل و attribution از mapEngine (قابل override با env؛
  // پیش‌فرض OSM عمومی، مستقل از نشان)
  const rasterUrl = useMemo(() => osmRasterUrl(), []);
  const attribution = useMemo(() => osmAttribution, []);

  // شمارش خطاهای بحرانی تایل در پنجرهٔ کوتاه — فقط با رسیدن به آستانهٔ state
  // machine به دیسپچر گزارش می‌شود (خطای تکی گذرا سبب تعویض موتور نمی‌شود).
  const tileHealthRef = useRef({ ...INITIAL_PROVIDER_HEALTH });
  const failCbRef = useRef(onEngineFailed);
  useEffect(() => {
    failCbRef.current = onEngineFailed;
  }, [onEngineFailed]);
  const handleTileError = useCallback(() => {
    const nowMs = Date.now();
    const failed = recordTileFailure(tileHealthRef.current, nowMs);
    if (failed) {
      resetTileFailureWindow(tileHealthRef.current);
      failCbRef.current?.("online", FAILURE_KIND_TILE);
    }
  }, []);

  const handleSelect = useCallback(
    (id: number | string) => onSelectMarker?.(id),
    [onSelectMarker]
  );

  const defaultCenter: [number, number] = userCoords
    ? [userCoords.lat, userCoords.lng]
    : center ?? [35.6892, 51.389]; // Default: Tehran center

  return (
    <div className={className} dir="ltr">
      <MapContainer
        center={defaultCenter}
        zoom={zoom ?? 12}
        scrollWheelZoom
        className="h-full w-full rounded-2xl sm:rounded-3xl border border-ik-border bg-ik-panel shadow-sm"
      >
        <TileLayer url={rasterUrl} attribution={attribution} maxZoom={19} eventHandlers={{ tileerror: handleTileError }} />

        {/* User Location Marker */}
        {userCoords?.lat && userCoords?.lng && (
          <Marker
            position={[userCoords.lat, userCoords.lng]}
            icon={userLocationMarkerIcon}
            eventHandlers={{
              click: () => handleSelect("__user__"),
            }}
          >
            <Popup>
              <div dir="rtl" className="p-1 text-xs font-bold text-ik-accent text-center">
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
              icon={
                m.id === selectedId
                  ? activeMarkerIcon
                  : m.unclaimed
                    ? unclaimedMarkerIcon
                    : m.promoted
                      ? promotedMarkerIcon
                      : businessMarkerIcon
              }
              eventHandlers={{
                click: () => handleSelect(m.id),
              }}
            >
              <Popup>
                {m.unclaimed ? (
                  /* Phase 3 approved copy — gray pin, lightweight popup, no
                     profile/social links. The claim CTA goes to /login (the
                     OTP login+signup page); the real claim flow is a later
                     phase, so this link intentionally leads to the generic
                     entry point. */
                  <div dir="rtl" className="p-2 min-w-[200px] max-w-[240px] text-right font-sans bg-ik-panel">
                    <strong className="block text-sm text-ik-text font-bold mb-1">
                      {m.title}
                    </strong>
                    {m.category && (
                      <span className="text-xs text-ik-muted mb-2 block">{m.category}</span>
                    )}
                    <p className="text-[11px] leading-relaxed text-ik-muted mb-2">
                      این کسب‌وکار هنوز در اینکارت فعال نشده است.
                    </p>
                    <Link
                      href="/login"
                      className="block w-full py-1.5 px-2 bg-ik-accent hover:bg-ik-accent-hover text-ik-accent-contrast text-[11px] font-bold rounded-lg text-center transition-colors"
                    >
                      صاحب این کسب‌وکار هستید؟ ثبت مالکیت رایگان
                    </Link>
                  </div>
                ) : (
                <div dir="rtl" className="p-2 min-w-[200px] max-w-[260px] text-right font-sans bg-ik-panel">
                  <div className="flex items-center gap-2 mb-1">
                    {m.logoUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={m.logoUrl}
                        alt=""
                        className="h-9 w-9 rounded-lg object-cover shrink-0"
                        loading="lazy"
                      />
                    ) : null}
                    <strong className="block text-sm text-ik-text font-bold">
                      {m.title}
                    </strong>
                  </div>
                  {m.category && (
                    <span className="inline-block text-xs text-ik-muted mb-1">
                      {m.category}
                    </span>
                  )}
                  {m.distance != null && (
                    <div className="text-xs text-ik-success font-medium my-1">
                      فاصله: {m.distance < 1000 ? `${Math.round(m.distance)} متر` : `${(m.distance / 1000).toFixed(1)} کیلومتر`}
                    </div>
                  )}
                  {m.href && (
                    <a
                      href={m.href}
                      className="mt-2 block w-full py-1 px-2.5 bg-ik-accent hover:bg-ik-accent-hover text-ik-accent-contrast text-xs font-bold rounded-lg text-center transition-colors"
                    >
                      مشاهده کارت ویزیت
                    </a>
                  )}
                </div>
                )}
              </Popup>
            </Marker>
          ) : null
        )}

        <MapController
          markers={markers}
          center={center}
          zoom={zoom}
          userCoords={userCoords}
          autoFit={autoFit}
        />
        <SelectedMarkerPopup selectedId={selectedId ?? null} />
        {onPick && <ClickPicker onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
