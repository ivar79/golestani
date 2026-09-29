/**
 * Shape geometry + paint — PURE. The single source of truth for what a shape
 * layer looks like.
 *
 * WHY THIS EXISTS: before the vector upgrade the rectangle and the ellipse were
 * drawn with CSS `background`/`border` while the other shapes were inline SVG.
 * That meant two different stroke models (and dash support on neither), and the
 * exporter could not reproduce either of them. Now EVERY shape is expressed as
 * SVG primitives here, and BOTH the React projection and the SVG/PDF serializer
 * consume this output — so the preview and the export are mathematically the
 * same drawing rather than "close enough".
 *
 * Pure: no DOM, no React, no network.
 */

import type { ShapeKind, ShapeLayer } from "./document";
import { resolveStroke, type ResolvedStroke } from "./stroke";
import { isGradientCss, parseGradientCss, svgColor, type SvgGradientSpec } from "./svgGradient";

export type SvgPrimitive =
  | { tag: "rect"; attrs: { x: number; y: number; width: number; height: number; rx: number; ry: number } }
  | { tag: "ellipse"; attrs: { cx: number; cy: number; rx: number; ry: number } }
  | { tag: "polygon"; attrs: { points: string } }
  | { tag: "line"; attrs: { x1: number; y1: number; x2: number; y2: number } }
  | { tag: "path"; attrs: { d: string } };

export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 12;
export const POLYGON_DEFAULT_SIDES = 6;

export const DEFAULT_SHAPE_FILL = "#0ea5e9";
export const DEFAULT_SHAPE_STROKE_COLOR = "#0b1c33";

/** Every shape the toolbox can create, in display order. */
export const SHAPE_KINDS: ShapeKind[] = ["rect", "ellipse", "triangle", "line", "arrow", "star", "polygon"];

function n(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampSides(sides: number | undefined): number {
  const value = Number.isFinite(sides as number) ? Math.round(sides as number) : POLYGON_DEFAULT_SIDES;
  return Math.min(POLYGON_MAX_SIDES, Math.max(POLYGON_MIN_SIDES, value));
}

/**
 * SVG centres a stroke on its outline, so every shape is inset by HALF the
 * stroke width. The whole stroke therefore stays inside the layer's own box and
 * the selection frame matches the visible ink exactly.
 *
 * The inset is computed PER AXIS and clamped so a thick stroke on a thin shape
 * can never produce a negative width or height (which SVG would reject). This
 * matters most for a LINE, whose box height IS the thickness in legacy
 * documents: clamping the horizontal inset by the height would pull its
 * endpoints inwards for no reason.
 */
function insetFor(width: number, height: number, strokeWidth: number): { x: number; y: number } {
  const half = Math.max(0, Number.isFinite(strokeWidth) ? strokeWidth : 0) / 2;
  return {
    x: Math.max(0, Math.min(half, width / 2 - 0.5)),
    y: Math.max(0, Math.min(half, height / 2 - 0.5)),
  };
}

/** A regular N-gon inscribed in the (already inset) box. */
function regularPolygonPoints(sides: number, cx: number, cy: number, rx: number, ry: number): string {
  const count = clampSides(sides);
  const points: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // Start at the top (-90°) so a hexagon reads the way users expect.
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    points.push(`${n(cx + rx * Math.cos(angle))},${n(cy + ry * Math.sin(angle))}`);
  }
  return points.join(" ");
}

/**
 * A 5-point star. Kept on the min(width,height) fit it always had, so cards
 * designed before the upgrade keep the exact same star.
 */
function starPoints(width: number, height: number, inset: { x: number; y: number }): string {
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.max(0, Math.min(width, height) / 2 - Math.max(inset.x, inset.y));
  const inner = outer * 0.42;
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    points.push(`${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`);
  }
  return points.join(" ");
}

/** A filled block arrow whose proportions follow the box it lives in. */
function arrowPath(width: number, height: number, inset: { x: number; y: number }): string {
  const y = height / 2;
  const headW = Math.min(height * 1.6, width * 0.4);
  const shaftW = Math.max(height * 0.34, 2);
  const shaftEnd = width - headW;
  return [
    `M ${n(inset.x)} ${n(y - shaftW / 2)}`,
    `H ${n(shaftEnd)}`,
    `V ${n(y - headW / 2)}`,
    `L ${n(width - inset.x)} ${n(y)}`,
    `L ${n(shaftEnd)} ${n(y + headW / 2)}`,
    `V ${n(y + shaftW / 2)}`,
    `H ${n(inset.x)}`,
    "Z",
  ].join(" ");
}

/**
 * The SVG geometry of a shape, in the shape's OWN box coordinates
 * (viewBox = `0 0 width height`), so it scales with the layer.
 *
 * Returns [] for degenerate boxes — callers render nothing instead of a
 * broken element.
 */
export function shapePrimitives(
  kind: ShapeKind,
  width: number,
  height: number,
  options: { radius?: number; sides?: number; strokeWidth?: number } = {},
): SvgPrimitive[] {
  if (!(width > 0) || !(height > 0)) return [];
  const inset = insetFor(width, height, Number(options.strokeWidth ?? 0) || 0);
  const innerW = Math.max(0, width - inset.x * 2);
  const innerH = Math.max(0, height - inset.y * 2);

  switch (kind) {
    case "rect": {
      const radius = Math.max(0, Math.min(Number(options.radius ?? 0) || 0, innerW / 2, innerH / 2));
      return [{ tag: "rect", attrs: { x: n(inset.x), y: n(inset.y), width: n(innerW), height: n(innerH), rx: n(radius), ry: n(radius) } }];
    }
    case "ellipse":
      return [{ tag: "ellipse", attrs: { cx: n(width / 2), cy: n(height / 2), rx: n(innerW / 2), ry: n(innerH / 2) } }];
    case "polygon":
      return [{ tag: "polygon", attrs: { points: regularPolygonPoints(clampSides(options.sides), width / 2, height / 2, innerW / 2, innerH / 2) } }];
    case "triangle":
      return [
        {
          tag: "polygon",
          attrs: {
            points: `${n(width / 2)},${n(inset.y)} ${n(width - inset.x)},${n(height - inset.y)} ${n(inset.x)},${n(height - inset.y)}`,
          },
        },
      ];
    case "star":
      return [{ tag: "polygon", attrs: { points: starPoints(width, height, inset) } }];
    case "line":
      return [{ tag: "line", attrs: { x1: n(inset.x), y1: n(height / 2), x2: n(width - inset.x), y2: n(height / 2) } }];
    case "arrow":
      return [{ tag: "path", attrs: { d: arrowPath(width, height, inset) } }];
    default:
      return [];
  }
}

/* --------------------------------- paint --------------------------------- */

export type FillPaint =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; spec: SvgGradientSpec };

export type ShapePaint = {
  primitives: SvgPrimitive[];
  fill: FillPaint;
  stroke: ResolvedStroke;
};

/** The fill of a shape: a solid color, an editor gradient, or nothing (line). */
export function resolveShapeFill(layer: ShapeLayer): FillPaint {
  if (layer.shape === "line") return { kind: "none" };
  const raw = layer.background ?? layer.color ?? null;
  if (!raw) return { kind: "solid", color: DEFAULT_SHAPE_FILL };
  if (isGradientCss(raw)) {
    const spec = parseGradientCss(raw);
    if (spec) return { kind: "gradient", spec };
  }
  return { kind: "solid", color: svgColor(raw) };
}

/**
 * The stroke of a shape.
 *
 * A LINE IS ITS STROKE — there is no separate fill — so its colour falls back
 * to the fill fields and its width falls back to the box height. That fallback
 * is what keeps documents saved while thickness was derived from the box
 * (instead of from `strokeWidth`) looking exactly as they did; new lines always
 * carry a real `strokeWidth`.
 */
export function resolveShapeStroke(layer: ShapeLayer): ResolvedStroke {
  const isLine = layer.shape === "line";
  const color = layer.stroke
    ?? (isLine ? layer.background ?? layer.color ?? DEFAULT_SHAPE_STROKE_COLOR : DEFAULT_SHAPE_STROKE_COLOR);
  const explicit = Number(layer.strokeWidth ?? 0);
  const width = isLine
    ? Math.max(1, Number.isFinite(explicit) && explicit > 0 ? explicit : Number(layer.height) || 1)
    : Number.isFinite(explicit) && explicit > 0 ? explicit : 0;
  const resolved = resolveStroke({ ...layer, stroke: color, strokeWidth: width }, color);
  return isLine ? { ...resolved, visible: true } : resolved;
}

/**
 * Everything needed to draw a shape layer — geometry, fill and stroke — from
 * one call. `strokeWidth` is resolved first so the geometry inset and the
 * painted width can never disagree.
 */
export function resolveShapePaint(layer: ShapeLayer): ShapePaint {
  const stroke = resolveShapeStroke(layer);
  return {
    primitives: shapePrimitives(layer.shape, layer.width, layer.height, {
      radius: layer.radius,
      sides: layer.sides,
      strokeWidth: stroke.visible ? stroke.width : 0,
    }),
    fill: resolveShapeFill(layer),
    stroke,
  };
}
