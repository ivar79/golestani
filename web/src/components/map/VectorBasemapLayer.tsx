"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type L from "leaflet";
import { leafletLayer } from "protomaps-leaflet";
import { darkShortbreadPaintRules, darkShortbreadLabelRules } from "@/lib/mapStyle";
import { degradeToOnline } from "@/lib/mapSource";

/**
 * VectorBasemapLayer — renders the Shortbread PMTiles archive (vector MVT)
 * with the protomaps-leaflet canvas renderer inside the react-leaflet tree.
 *
 * The URL ends in .pmtiles, so protomaps-leaflet switches to its built-in
 * PmtilesSource: the archive is read over HTTP byte ranges (206 Partial
 * Content) served by Laravel — no per-tile requests, no Node.js anywhere.
 * Markers/panes/popups stay fully intact.
 *
 * Runtime resilience: repeated tile failures downgrade the session via
 * degradeToOnline() and notify the parent to switch to the raster source.
 */
export default function VectorBasemapLayer({
  url,
  onUnavailable,
}: {
  url: string;
  onUnavailable?: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    let layer: ReturnType<typeof leafletLayer> | null = null;
    let removed = false;

    try {
      layer = leafletLayer({
        url,
        paintRules: darkShortbreadPaintRules(),
        labelRules: darkShortbreadLabelRules(),
        backgroundColor: "#0e1726",
        maxDataZoom: 14, // Shortbread tops out at z14; overzoom is interpolated
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      // The factory returns a GridLayer-shaped object that Leaflet accepts at
      // runtime; the official typings lag behind, so bridge the type here.
      (layer as unknown as L.Layer).addTo(map);
    } catch {
      onUnavailable?.();
      return;
    }

    // Count tile failures; a burst of them means the vector source is dead
    // (archive missing, backend down, network blocked) → downgrade session.
    let failures = 0;
    const onTileError = () => {
      failures += 1;
      if (failures === 6) {
        degradeToOnline();
        onUnavailable?.();
      }
    };
    map.on("tileerror", onTileError);

    return () => {
      removed = true;
      void removed;
      map.off("tileerror", onTileError);
      if (layer) {
        try {
          map.removeLayer(layer as unknown as L.Layer);
        } catch {
          // Map already torn down — nothing to do.
        }
      }
    };
  }, [map, url, onUnavailable]);

  return null;
}
