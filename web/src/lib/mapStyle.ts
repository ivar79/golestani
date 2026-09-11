/**
 * mapStyle — hand-tuned dark Shortbread theme (PMTiles phase).
 *
 * The brand "Dark Aurora" identity as protomaps-leaflet rules:
 *  - readable deep-blue water / streets (no more "only dark lines":
 *    every class gets its own lightness so the network is legible),
 *  - Persian labels drawn from the Shortbread `name` field with an
 *    automatic `name_en` fallback (bilingual coverage everywhere),
 *  - real Shortbread 1.0 layer names, verified against the archive:
 *    land, water_polygons, ocean, water_lines, buildings, streets,
 *    pois, boundaries, place_labels, street_labels, water_lines_labels.
 *
 * Pure data — no React, imported only by the client-only map component.
 */
import {
  LineSymbolizer,
  PolygonSymbolizer,
  CircleSymbolizer,
  CenteredTextSymbolizer,
  LineLabelSymbolizer,
  type LabelRule,
  type PaintRule,
} from "protomaps-leaflet";

/** Brand palette (kept in sync with the Tailwind theme tokens). */
export const MAP_COLORS = {
  abyss: "#0e1726",
  water: "#12385c",
  land: "#131f33",
  building: "#1d2c46",
  streetMinor: "#31435f",
  streetMajor: "#4a608a",
  streetHighway: "#c9d6f2",
  streetNeon: "#22d3ee",
  rail: "#5b5f7a",
  park: "#14432e",
  boundary: "#8b93a8",
  label: "#e6edf8",
  labelDim: "#aab6cc",
  labelAccent: "#8ff3ff",
} as const;

/** Color ramps by zoom for subtle depth without a heavy style engine. */
const bgZoom = (z: number): string => (z < 6 ? "#0d1523" : z < 10 ? MAP_COLORS.abyss : MAP_COLORS.land);
const waterZoom = (z: number): string => (z < 8 ? "#0f2c49" : MAP_COLORS.water);
const minorZoom = (z: number): string => (z < 11 ? "#26364e" : MAP_COLORS.streetMinor);
const majorZoom = (z: number): string => (z < 11 ? "#3b517a" : MAP_COLORS.streetMajor);

/**
 * Label field priority: Shortbread ships `name` (local/Persian script) and
 * `name_en` (Latin). protomaps-leaflet treats each labelProps entry as a
 * property NAME to look up per feature — first present string wins — so this
 * is a plain field list, not the values themselves.
 */
const bilingual: string[] = ["name", "name_en"];
/**
 * Dark Shortbread paint rules, drawn back-to-front:
 * land → water → landuse(kind) → buildings → streets → rail → boundaries → POIs.
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

    // Green areas: Shortbread carries them in `land` (kind=park|forest|grass…).
    {
      dataLayer: "land",
      symbolizer: new PolygonSymbolizer({ fill: MAP_COLORS.park, opacity: 0.9 }),
      minzoom: 9,
      filter: (_z, f) =>
        ["park", "forest", "grass", "garden", "cemetery", "nature_reserve"].includes(
          String(f.props.kind ?? "")
        ),
    },

    // Buildings appear at z14 in Shortbread — slightly lighter than land.
    {
      dataLayer: "buildings",
      symbolizer: new PolygonSymbolizer({ fill: MAP_COLORS.building }),
      minzoom: 14,
    },

    // Streets: minor under major under highway, each visibly distinct.
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: minorZoom, width: (z) => Math.min(6, 0.4 + z * 0.28) }),
    },
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: majorZoom, width: (z) => Math.min(10, 0.6 + z * 0.45) }),
      filter: (_z, f) => f.props.kind === "major_road",
    },
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: MAP_COLORS.streetHighway, width: (z) => Math.min(12, 0.8 + z * 0.5) }),
      filter: (_z, f) => f.props.kind === "highway",
    },

    // Neon glow on arterials at high zoom (brand accent).
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({
        color: MAP_COLORS.streetNeon,
        opacity: 0.4,
        width: (z) => Math.min(1.6, z * 0.07),
      }),
      minzoom: 13,
      filter: (_z, f) => f.props.kind === "highway" || f.props.kind === "major_road",
    },

    // Rail: dashed over the same `streets` layer (Shortbread kind=rail).
    {
      dataLayer: "streets",
      symbolizer: new LineSymbolizer({ color: MAP_COLORS.rail, width: 1.2, dash: [4, 3] }),
      minzoom: 11,
      filter: (_z, f) => f.props.kind === "rail",
    },

    // Admin boundaries — were missing entirely before.
    {
      dataLayer: "boundaries",
      symbolizer: new LineSymbolizer({ color: MAP_COLORS.boundary, width: 1, opacity: 0.6, dash: [3, 2] }),
      minzoom: 6,
      filter: (_z, f) => Number(f.props.admin_level ?? 0) <= 4,
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
 * (earlier rules win the label layout). Persian `name` with English fallback.
 */
export function darkShortbreadLabelRules(): LabelRule[] {
  return [
    {
      dataLayer: "place_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: bilingual,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: (z) => (z < 8 ? 14 : 13),
        fontWeight: 700,
        fill: MAP_COLORS.label,
        stroke: "#020617",
        width: 3,
      }),
      filter: (z, f) => z >= 4 && Number(f.props.population ?? 0) >= 50000,
    },
    {
      dataLayer: "place_labels",
      symbolizer: new CenteredTextSymbolizer({
        labelProps: bilingual,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 12,
        fontWeight: 600,
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
        labelProps: bilingual,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 10,
        fill: "#5b8ab8",
        stroke: "#020617",
        width: 2,
      }),
      minzoom: 12,
    },
    {
      dataLayer: "street_labels",
      symbolizer: new LineLabelSymbolizer({
        labelProps: bilingual,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: 11,
        fill: MAP_COLORS.labelAccent,
        stroke: "#020617",
        width: 2.5,
        repeatDistance: 300,
      }),
      minzoom: 13,
    },
  ];
}
