"use client";

import L from "leaflet";

/**
 * Self-contained SVG vector icons for Leaflet.
 * No external PNG files or CDN requests are needed.
 * Works 100% offline and in Iranian intranet / National Network.
 */

// Business marker (Emerald Green with Pin shape and store icon)
export const businessMarkerIcon = L.divIcon({
  className: "custom-leaflet-marker",
  html: `
    <div style="position: relative; width: 32px; height: 42px; transform: translate(-50%, -100%); cursor: pointer; filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));">
      <svg viewBox="0 0 32 42" width="32" height="42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 11.2 14.4 24.8 15.04 25.4.52.52 1.4.52 1.92 0C17.6 40.8 32 27.2 32 16 32 7.163 24.837 0 16 0z" fill="#00c98d"/>
        <path d="M16 2C8.268 2 2 8.268 2 16c0 9.8 12.6 22 14 23.4 1.4-1.4 14-13.6 14-23.4 0-7.732-6.268-14-14-14z" fill="#059669"/>
        <circle cx="16" cy="15" r="7" fill="#ffffff"/>
        <path d="M13 13h6v4h-6z" fill="#0b1626"/>
      </svg>
    </div>
  `,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -38],
});

// User location marker (Blue glowing circle with pulsing ring)
export const userLocationMarkerIcon = L.divIcon({
  className: "custom-leaflet-user-marker",
  html: `
    <div style="position: relative; width: 24px; height: 24px; transform: translate(-50%, -50%);">
      <div style="position: absolute; inset: -8px; border-radius: 9999px; background: rgba(59, 130, 246, 0.25); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; inset: 0; border-radius: 9999px; background: #3b82f6; border: 3px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14],
});

// Active / Selected marker (Highlighted amber/gold pin)
export const activeMarkerIcon = L.divIcon({
  className: "custom-leaflet-active-marker",
  html: `
    <div style="position: relative; width: 38px; height: 48px; transform: translate(-50%, -100%); cursor: pointer; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.4));">
      <svg viewBox="0 0 32 42" width="38" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 11.2 14.4 24.8 15.04 25.4.52.52 1.4.52 1.92 0C17.6 40.8 32 27.2 32 16 32 7.163 24.837 0 16 0z" fill="#f59e0b"/>
        <path d="M16 2C8.268 2 2 8.268 2 16c0 9.8 12.6 22 14 23.4 1.4-1.4 14-13.6 14-23.4 0-7.732-6.268-14-14-14z" fill="#d97706"/>
        <circle cx="16" cy="15" r="7" fill="#ffffff"/>
        <circle cx="16" cy="15" r="4" fill="#0b1626"/>
      </svg>
    </div>
  `,
  iconSize: [38, 48],
  iconAnchor: [19, 48],
  popupAnchor: [0, -44],
});

// Set default fallback icon in case anything falls back
L.Marker.prototype.options.icon = businessMarkerIcon;
