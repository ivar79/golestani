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

import type { CurveSpec } from "./curveGeometry";

export type CardDocumentV1 = {
  version: 1;
  /** Fixed standard business-card artboard in design pixels (1050×600 ≈ 8.5×5.5cm). */
  artboard: { width: number; height: number };
  /** Solid CSS color. Gradients/shapes are layers, not background magic. */
  background: string;
  /** Order = z-order; last renders on top. */
  layers: CardLayer[];
  /**
   * Live-Paint style region paint (see domain/geometry/regions.ts).
   *
   * Paint is attached to the FACES produced by intersecting paths, never to the
   * paths themselves — so recolouring a region can never rewrite (or corrupt)
   * the user's geometry. Keys are topology-derived, which is what lets an edit
   * remap the paint instead of dropping it.
   */
  regions?: RegionStyleEntry[];
  /** Region-detection settings (gap tolerance + fill rule). */
  regionSettings?: RegionSettings;
};

export type CardDocument = CardDocumentV1;

export type RegionFillKind = "solid" | "linear" | "radial";

/** One painted region/face. */
export type RegionStyleEntry = {
  /** Matches the region's topology key at paint time. */
  key: string;
  fill: RegionFillKind;
  color: string;
  /** Gradient partner colour (linear/radial only). */
  color2?: string;
  /** Gradient direction in degrees (linear only). */
  angle?: number;
  /** 0..1, independent of the source layers' opacity. */
  opacity?: number;
};

/**
 * How the region builder closes gaps and resolves overlapping contours.
 * `gapTolerance > 0` treats a small visual gap as closed for TOPOLOGY only —
 * the anchors are never moved.
 */
/**
 * SVG fill semantics (§13). ONE union, used by both a path's own fill and the
 * region/face resolver, so "nonzero" can never mean two different things.
 */
export type FillRuleKind = "nonzero" | "evenodd";

/** The presets the fill-rule control exposes. */
export const FILL_RULE_LABELS: Record<FillRuleKind, string> = {
  nonzero: "غیرصفر (nonzero)",
  evenodd: "زوج-فرد (evenodd)",
};

export type RegionSettings = {
  gapTolerance: number;
  fillRule: FillRuleKind;
};

export const DEFAULT_REGION_SETTINGS: RegionSettings = { gapTolerance: 0, fillRule: "nonzero" };

/** The presets the paint-tool UI exposes for closing gaps. */
export const GAP_TOLERANCE_PRESETS = [0, 1, 2, 4, 8] as const;

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
  /** Luxury material style or visual effect (Glassmorphism, Velvet, Gold Foil, Chrome Silver, Neon Glow). */
  effect?: "glass" | "velvet" | "gold" | "silver" | "neon" | "none" | null;
  /** Direct arc curvature for 2-point curved lines (-100 to +100). */
  curvature?: number;
  /**
   * Mirror flags (optional for backwards compatibility). They live on the
   * LAYER BASE — not on the image layer — because mirroring is a frame-level
   * transform: every kind (text, shape, path, QR, badge, image) mirrors about
   * its own centre in the canvas AND in the SVG/PDF export, and the flags are
   * whitelisted for every kind by the server validator.
   */
  flipX?: boolean;
  flipY?: boolean;
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
  /**
   * Explicit dash pattern in design px (§14). When present it REPLACES the
   * preset rhythm from `strokeStyle`, which is what makes arbitrary dash
   * patterns possible without inventing a new preset per rhythm.
   * Empty/null means "no explicit pattern".
   */
  strokeDasharray?: number[] | null;
  /** Where the dash pattern starts (§14), in design px. Any sign. */
  strokeDashoffset?: number;
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
  /**
   * Optional raw SVG `d` string — used by catalog templates and the brush tool
   * for curves that are authored directly as path data (ornaments) rather than
   * as editable anchor lists. When present it wins over `points` (see
   * resolveLayerPathD). Kept in the document so it round-trips untouched.
   */
  rawD?: string;
  /**
   * Arc curvature for a 2-point path as a signed sagitta ratio
   * (±1 = semicircle; 0 = straight). See domain/curveLine.ts.
   */
  bend?: number;
  /**
   * Identifies which drawing interaction created the path. Optional for backward
   * compatibility with saved documents.
   */
  pathMode?: "curve" | "pen" | "freehand";
  /**
   * Profile for the dedicated curve tool. `arc` preserves the legacy bend model.
   */
  curveProfile?: "arc" | "sine" | "sine-asymmetric" | "s";
  /**
   * PARAMETRIC CURVE RECORD (§4). When present, `points` are the geometry this
   * spec was generated into, and every parameter (length, amplitude, frequency,
   * phase, symmetry, end tangents, direction) stays editable. Dropping the field
   * is exactly what "Convert to Path" does — the anchors then ARE the geometry.
   */
  curve?: CurveSpec;
  /**
   * SVG fill rule for this path's own fill (§13). Defaults to `nonzero`, which
   * is the SVG default and the pre-upgrade behaviour. Nested subpaths of an
   * evenodd path punch holes instead of filling solid.
   */
  fillRule?: FillRuleKind;
  stroke?: string | null;
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
