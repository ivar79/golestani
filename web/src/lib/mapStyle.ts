/**
 * mapStyle — hand-tuned dark Shortbread theme (tasks 7 & 11).
 *
 * The brand "Dark Aurora" identity as protomaps-leaflet rules:
 *  - abyss background #060c18, deep-blue water, neon-cyan arterial glow
 *  - Persian labels drawn from the Shortbread `name` field
 *
 * Pure data — no React, imported only by the client-only map component.
 */
import {
  PolygonSymbolizer,
  LineSymbolizer,
  CircleSymbolizer,
  CenteredTextSymbolizer,
  type LabelRule,
  type PaintRule,
} from "protomaps-leaflet";

/** Brand palette (kept in sync with the Tailwind theme tokens). */
export const MAP_COLORS = {
  abyss: "#060c18",
  water: "#0a1c30",
  land: "#0a1120",
  building: "#101c30",
  streetMinor: "#16243c",
  streetMajor: "#1d3555",
  streetNeon: "#22d3ee",
  rail: "#24304a",
  park: "#0b1f1a",
  label: "#cbd5e1",
  labelDim: "#7c8aa5",
  labelAccent: "#67e8f9",
} as const;

/** Color ramps by zoom for subtle depth without a heavy style engine. */
const bgZoom = (z: number): string => (z < 6 ? "#070d1a" : z < 10 ? MAP_COLORS.abyss : MAP_COLORS.land);
const waterZoom = (z: number): string => (z < 8 ? "#0c2238" : MAP_COLORS.water);
const minorZoom = (z: number): string => (z < 11 ? "#101c30" : MAP_COLORS.streetMinor);
const majorZoom = (z: number): string => (z < 11 ? "#16243c" : MAP_COLORS.streetMajor);

/**
 * Dark Shortbread paint rules, drawn back-to-front:
 * land → water → landuse → buildings → streets → rail → POIs.
 *
 * Shortbread 1.0 layer names (verified against the shipped archive):
 * land, water_polygons, ocean, water_lines, buildings, streets, pois.
 */
export function darkShortbreadPaintRules(): PaintRule[] {
  return [
    // Base land + ocean/sea + inland water.
    { dataLayer: "land", symbolizer: new PolygonSymbolizer({ fill: bgZoom }) },
    { dataLayer: "water_polygons", symbolizer: new PolygonSymbolizer({ fill: waterZoom }) },
    { dataLayer: "ocean", symbolizer: new PolygonSymbolizer({ fill: waterZoom }) },
    {
      dataLayer: "water_lines",
      symbolizer: new LineSymbolizer({ color: waterZoom, width: (z) => Math.min(3, 0.4 + z * 0.18) }),
    },

    // Parks / green areas (the `land` layer carries a `kind` attribute).
    {
      dataLayer: "land",
      symbolizer: new PolygonSymbolizer({ fill: MAP_COLORS.park, opacity: 0.9 }),
      minzoom: 9,
      filter: (z, f) => z >= 9 && f.props.kind === "park",
    },

    // Buildings appear at z14 in Shortbread.
    {
      dataLayer: "buildings",
      symbolizer: new PolygonSymbolizer({ fill: MAP_COLORS.building }),
      minzoom: 14,
    },

    // Streets: minor under major, then a neon glow on arterials at high zoom.
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: minorZoom, width: (z) => Math.min(6, 0.3 + z * 0.25) }),
    },
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: majorZoom, width: (z) => Math.min(10, 0.5 + z * 0.4) }),
      filter: (_z, f) => f.props.kind === "highway" || f.props.kind === "major_road",
    },
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({
        color: MAP_COLORS.streetNeon,
        opacity: 0.35,
        width: (z) => Math.min(1.4, z * 0.06),
      }),
      minzoom: 13,
      filter: (_z, f) => f.props.kind === "highway" || f.props.kind === "major_road",
    },

    // Rail.
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: MAP_COLORS.rail, width: 1 }),
      minzoom: 12,
      filter: (_z, f) => f.props.kind === "rail",
    },

    // POI dots at max zoom.
    {
      dataLayer: "pois",
      symbolizer: new CircleSymbolizer({ radius: 2, fill: MAP_COLORS.labelDim }),
      minzoom: 14,
    },
  ];
}

/**
 * Label rules: cities → small places → water → streets, in priority order
 * (earlier rules win the label layout). Persian names from `name`.
 */
export function darkShortbreadLabelRules(): LabelRule[] {
  return [
    {
      dataLayer: "place_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: (z, f) => (f ? [String(f.props.name ?? "")] : [""]),
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: (z) => (z < 8 ? 13 : 12),
        fontWeight: 600,
        fill: MAP_COLORS.label,
        stroke: "#020617",
        width: 3,
      }),
      filter: (z, f) => z >= 4 && Number(f.props.population ?? 0) >= 50000,
    },
    {
      dataLayer: "place_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: (z, f) => (f ? [String(f.props.name ?? "")] : [""]),
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 11,
        fontWeight: 500,
        fill: MAP_COLORS.labelDim,
        stroke: "#020617",
        width: 2.5,
      }),
      minzoom: 10,
      filter: (z, f) => z >= 10 && Number(f.props.population ?? 0) < 50000,
    },
    {
      dataLayer: "water_lines_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: (z, f) => (f ? [String(f.props.name ?? "")] : [""]),
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 10,
        fill: "#4c6a8f",
        stroke: "#020617",
        width: 2,
      }),
      minzoom: 12,
    },
    {
      dataLayer: "street_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: (z, f) => (f ? [String(f.props.name ?? "")] : [""]),
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 11,
        fill: MAP_COLORS.labelAccent,
        stroke: "#020617",
        width: 2.5,
      }),
      minzoom: 13,
    },
  ];
}
