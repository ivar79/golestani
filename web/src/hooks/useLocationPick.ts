"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api, { TOKEN_KEY } from "@/lib/api";

export type GeoPoint = { latitude: number; longitude: number; label?: string | null };

export type LocationSource = "saved" | "browser" | "manual" | null;

export type LocationState = {
  /** Current location, or null when unset/invalid. */
  location: GeoPoint | null;
  /** Where the current location came from (null = none). */
  source: LocationSource;
  /** "locating" = browser geolocation in flight. */
  status: "idle" | "locating" | "syncing" | "error";
  /** Human-readable error for the last failed operation. */
  error: string | null;
  /** Ask the browser for the device position. Never overwrites a manual pick silently. */
  requestBrowserLocation: () => void;
  /** Set a location manually (map click / city choice). Always wins over saved/browser. */
  setManualLocation: (lat: number, lng: number, label?: string) => void;
  /** Clear everything (including the server copy for logged-in users). */
  clearLocation: () => void;
};

const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LNG = -180;
const MAX_LNG = 180;
const STORAGE_KEY = "golestani_location";

function isValid(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= MIN_LAT && lat <= MAX_LAT && lng >= MIN_LNG && lng <= MAX_LNG
  );
}

function readStored(): { point: GeoPoint; source: LocationSource; at: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { point: GeoPoint; source: LocationSource; at: number };
    if (!parsed?.point || !isValid(parsed.point.latitude, parsed.point.longitude)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * useLocationPick — engineering foundation for Phase 3 location UX (no UI).
 *
 * Layers, in precedence order:
 *   1. manual pick (map click) — wins until the user changes or clears it
 *   2. browser geolocation
 *   3. saved location (localStorage = anonymous device layer; server = logged-in layer)
 *
 * Authenticated users get their location synced to PUT /auth/location; anonymous
 * usage is unaffected (localStorage only, no API calls).
 */
export function useLocationPick(): LocationState {
  // Hydration-safe restore: the first (server + client) render uses the same
  // empty state so SSR markup matches; the saved location is restored in an
  // effect AFTER hydration. Reading localStorage during render (lazy
  // initializer) made the client's first render differ from the server HTML
  // and broke hydration whenever a location was persisted.
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [source, setSource] = useState<LocationSource>(null);
  const [status, setStatus] = useState<LocationState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  /** True while a manual pick is authoritative; browser geolocation must defer. */
  const manualActive = useRef<boolean>(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Restore the persisted location once, after hydration (hydration-safe):
  // the first (server + client) render is identical (no location), and the
  // saved value is applied only after the hydration commit — deferred out of
  // the effect body so the update cannot race or cascade during hydration.
  // A manual pick is restored with full protection — it never expires. Only
  // the user changing or clearing it removes it (contract:
  // "حفظ موقعیت انتخاب‌شده تا تغییر دستی توسط کاربر").
  useEffect(() => {
    const stored = readStored();
    if (!stored) return;
    queueMicrotask(() => {
      setLocation(stored.point);
      setSource(stored.source);
    });
    manualActive.current = stored.source === "manual";
  }, []);

  const persist = useCallback((point: GeoPoint | null, src: LocationSource) => {
    if (typeof window === "undefined") return;
    if (point) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ point, source: src, at: Date.now() }),
      );
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  /** Fire-and-forget server sync for logged-in users; silently skips anonymous. */
  const syncToServer = useCallback(async (point: GeoPoint | null) => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(TOKEN_KEY)) return; // anonymous — local only
    try {
      await api.put("/auth/location", point
        ? { latitude: point.latitude, longitude: point.longitude, label: point.label ?? null }
        : {});
    } catch {
      // Server sync is best-effort; local location remains authoritative for the session.
    }
  }, []);

  const commit = useCallback((point: GeoPoint | null, src: LocationSource) => {
    setLocation(point);
    setSource(point ? src : null);
    persist(point, src);
    void syncToServer(point);
  }, [persist, syncToServer]);

  const requestBrowserLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setError("مرورگر شما از تعیین موقعیت پشتیبانی نمی‌کند.");
      setStatus("error");
      return;
    }
    if (manualActive.current) return; // manual pick wins until the user changes/clears it
    setStatus("locating");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        const { latitude, longitude } = pos.coords;
        if (!isValid(latitude, longitude)) {
          setError("موقعیت دریافتی نامعتبر است.");
          setStatus("error");
          return;
        }
        commit({ latitude, longitude, label: null }, "browser");
        setStatus("idle");
      },
      (err) => {
        if (!mounted.current) return;
        setError(
          err.code === err.PERMISSION_DENIED
            ? "دسترسی به موقعیت رد شد. می‌توانید موقعیت را دستی روی نقشه انتخاب کنید."
            : err.code === err.TIMEOUT
              ? "دریافت موقعیت بیش از حد طول کشید."
              : "دریافت موقعیت ناموفق بود.",
        );
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, [commit]);

  const setManualLocation = useCallback((lat: number, lng: number, label?: string) => {
    if (!isValid(lat, lng)) {
      setError("مختصات انتخاب‌شده نامعتبر است.");
      setStatus("error");
      return;
    }
    manualActive.current = true;
    setError(null);
    setStatus("idle");
    commit({ latitude: lat, longitude: lng, label: label ?? null }, "manual");
  }, [commit]);

  const clearLocation = useCallback(() => {
    manualActive.current = false;
    setError(null);
    setStatus("idle");
    commit(null, null);
  }, [commit]);

  return {
    location,
    source,
    status,
    error,
    requestBrowserLocation,
    setManualLocation,
    clearLocation,
  };
}
