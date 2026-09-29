/**
 * CardEditor document — the serialized source of truth for the layered
 * digital business card editor (Phase 4).
 *
 * Architecture contract (docs/EDITOR_ARCHITECTURE_RESEARCH_FA.md):
 *   - State-first: the document is a flat JSON structure; renderers (DOM
 *     preview, export) are pure projections of it.
 *   - Whitelist serialization: only the fields below are persisted; engine
 *     internals never leak into the document.
 *   - Backwards compatible: cards stored before the editor (design_json =
 *     null) render with the template renderer and are untouched by this.
 */

export type CardDocumentV1 = {
  version: 1;
  /** Fixed standard business-card artboard in design pixels (1050×600 ≈ 8.5×5.5cm). */
  artboard: { width: number; height: number };
  /** Solid CSS color. Gradients/shapes are layers, not background magic. */
  background: string;
  /** Order = z-order; last renders on top. */
  layers: CardLayer[];
};

export type CardDocument = CardDocumentV1;

export type LayerBase = {
  id: string;
  /** Optional user label for the layers panel (falls back to kind + snippet). */
  name?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /**
   * Legacy z field. NO LONGER THE SOURCE OF TRUTH — the array order in
   * `CardDocument.layers` is the z-order (single source of truth, matching
   * Photoshop/Figma). This stays in the type only so OLD stored documents
   * (which carry it) still type-check on parse; it is IGNORED by renderers
   * and never written back. See `zIndexOf()`.
   */
  z?: number;
  color: string | null;
  background: string | null;
};

export type TextLayer = LayerBase & {
  kind: "text";
  text: string;
  fontSize: number;
  fontWeight: number;
  /** Semantic alignment — renders correctly in RTL. */
  align: "start" | "center" | "end";
  fontFamily: string;
  /** Typographic decorations (optional for backwards compatibility with stored docs). */
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** Multiplier (1 = single); optional for backwards compatibility. */
  lineHeight?: number;
  /** px letter-spacing; optional for backwards compatibility. */
  letterSpacing?: number;
};

export type ImageLayer = LayerBase & {
  kind: "image";
  /** System storage path only (/storage/…) — remote/data URLs are rejected server-side. */
  src: string;
  radius: number;
  objectFit: "cover" | "contain";
  /** Mirror flags (optional for backwards compatibility). */
  flipX?: boolean;
  flipY?: boolean;
};

export type QrLayer = LayerBase & {
  kind: "qr";
  /** Rendered via the project's own /api/public/businesses/{slug}/qr endpoint. */
  payload: string;
  dark: string;
  light: string;
};

export type BadgeLayer = LayerBase & {
  kind: "badge";
  style: "verified" | "promoted";
  text: string;
};

export type ShapeKind = "rect" | "ellipse" | "triangle" | "line" | "arrow" | "star" | "polygon";

/**
 * Stroke decorations shared by shape + path layers.
 *
 * Every field is OPTIONAL and defaults to the pre-vector-upgrade behaviour
 * (solid / round / round / full opacity), so documents stored before this
 * upgrade render EXACTLY as they did — no migration, no version bump.
 */
export type StrokeStyleKind = "solid" | "dashed" | "dotted";
export type StrokeLineCap = "butt" | "round" | "square";
export type StrokeLineJoin = "miter" | "round" | "bevel";

export type StrokeDecorations = {
  /** Dash pattern preset. */
  strokeStyle?: StrokeStyleKind;
  strokeLinecap?: StrokeLineCap;
  strokeLinejoin?: StrokeLineJoin;
  /** Stroke-only alpha (0..1) — independent of the layer's own opacity. */
  strokeOpacity?: number;
};

export type ShapeLayer = LayerBase & StrokeDecorations & {
  kind: "shape";
  shape: ShapeKind;
  radius: number;
  /** Vertex count for `shape: "polygon"` (3..12); ignored by every other shape. */
  sides?: number;
  /** Optional stroke (outline) — null means no stroke. */
  stroke?: string | null;
  strokeWidth?: number;
};

export type PathPoint = {
  x: number;
  y: number;
  hIn?: { x: number; y: number } | null;
  hOut?: { x: number; y: number } | null;
};

export type PathLayer = LayerBase & StrokeDecorations & {
  kind: "path";
  closed: boolean;
  points: PathPoint[];
  stroke: string;
  strokeWidth: number;
  fill: string | null;
};

export type CardLayer = TextLayer | ImageLayer | QrLayer | BadgeLayer | ShapeLayer | PathLayer;

export type LayerKind = CardLayer["kind"];

export const ARTBOARD = { width: 1050, height: 600 } as const;

/** Layer display labels + which kinds the business-card toolbox exposes. */
export const LAYER_KIND_LABELS: Record<LayerKind, string> = {
  text: "متن",
  image: "تصویر / لوگو",
  qr: "کد QR",
  badge: "نشان",
  shape: "شکل",
  path: "نقاشی",
};

/**
 * Persian labels for the vector shapes — ONE source, consumed by the shape
 * preset grid, the layers panel and the inspector (previously duplicated in
 * the panels file, where `polygon` would have been missing).
 */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: "مستطیل",
  ellipse: "بیضی",
  triangle: "مثلث",
  line: "خط",
  arrow: "فلش",
  star: "ستاره",
  polygon: "چندضلعی",
};

export function isLayerHidden(layer: CardLayer): boolean {
  return layer.hidden || layer.opacity <= 0;
}

/**
 * The z-order of a layer = its ARRAY INDEX in `doc.layers` + 1 (the classic
 * layer-stack contract: later in the array = painted on top). This is the
 * SINGLE source of truth for stacking — `layer.z` is legacy-ignored.
 */
export function layerZ(index: number): number {
  return index + 1;
}
