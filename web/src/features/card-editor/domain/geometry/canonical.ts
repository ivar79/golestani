/**
 * Canonical path geometry — the ONE place a PathLayer becomes real geometry.
 *
 * `resolveLayerPathD` (domain/path.ts) already decides which spelling of a
 * path is authoritative (editable `bend` arc → raw `d` → Bézier anchors).
 * This module parses that same `d` into cubic segments and flattens it into
 * polylines, which is what regions/faces, hit-testing and future boolean ops
 * actually need.
 *
 * Nothing here re-decides geometry: it is a pure, lossless projection of the
 * resolver's output, so the canvas, the export and the region builder can
 * never disagree about where a path is.
 *
 * Pure: no DOM, no React.
 */

import { nearestSegmentOnCubics, resolveLayerPathD, type PathPoint } from "../path";
import { parsePathData, type CubicSegment, type Pt, type SubPath } from "./pathData";

export type { CubicSegment, Pt, SubPath } from "./pathData";

/** Minimal shape this module needs from a path layer. */
export type PathGeometrySource = {
  points: { x: number; y: number; hIn?: { x: number; y: number } | null; hOut?: { x: number; y: number } | null }[];
  closed?: boolean;
  rawD?: string;
  bend?: number;
  x?: number;
  y?: number;
};

/**
 * Local-space subpaths for any path layer.
 *
 * Coordinates stay in the layer's own frame (the anchors' own space), exactly
 * like `resolveLayerPathD`. Call `toWorldSubPaths` when a consumer needs
 * artboard coordinates (regions do).
 */
export function resolvePathGeometry(layer: PathGeometrySource): SubPath[] {
  return parsePathData(resolveLayerPathD(layer));
}

/** Shift subpaths from layer-local space into artboard space. */
export function offsetSubPaths(subpaths: SubPath[], dx: number, dy: number): SubPath[] {
  if (dx === 0 && dy === 0) return subpaths;
  const shift = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return subpaths.map((sub) => ({
    start: shift(sub.start),
    closed: sub.closed,
    segments: sub.segments.map((s) => ({ p0: shift(s.p0), c1: shift(s.c1), c2: shift(s.c2), p1: shift(s.p1) })),
  }));
}

/** Artboard-space subpaths — what region/face detection works on. */
export function toWorldSubPaths(layer: PathGeometrySource): SubPath[] {
  return offsetSubPaths(resolvePathGeometry(layer), layer.x ?? 0, layer.y ?? 0);
}

/* ------------------------------------------------------------------ */
/* Geometry → editable anchors                                          */
/* ------------------------------------------------------------------ */

/**
 * Turn parsed subpaths back into an editable anchor list — the INVERSE of
 * `resolveLayerPathD` + `parsePathData`.
 *
 * This is what makes a geometry that is NOT an anchor list editable without
 * moving it: a legacy two-point `bend` arc draws a CIRCLE through its two
 * anchors, so its anchor list sits on the chord while the user sees the arc.
 * Reading the anchors off the drawn cubics makes the canvas, the hit tests and
 * the node editor agree, and the drawing is preserved (a cubic approximates the
 * circular arc to a small fraction of a pixel).
 *
 * Only the FIRST subpath carrying segments is converted: an editable path layer
 * is one contour, and a multi-contour `rawD` is deliberately left as the frozen
 * shape it is instead of being silently split into separate paths.
 *
 * Handles that sit exactly ON their anchor are dropped (`null`) so a straight
 * edge stays a corner in the node overlay's "smooth vs corner" reading.
 */
export function anchorsFromSubPaths(subpaths: SubPath[]): { points: PathPoint[]; closed: boolean } {
  const sub = subpaths.find((item) => item.segments.length > 0);
  if (!sub) return { points: [], closed: false };
  const closed = sub.closed && sub.segments.length > 1;
  const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const handle = (anchor: Pt, control: Pt): Pt | null => (same(anchor, control) ? null : { ...control });

  const points: PathPoint[] = [];
  sub.segments.forEach((segment, index) => {
    if (index === 0) {
      points.push({ x: segment.p0.x, y: segment.p0.y, hIn: null, hOut: handle(segment.p0, segment.c1) });
    }
    // A closed contour's last cubic ends on the FIRST anchor: it must not be
    // pushed twice (the wrap-around handle is attached in the pass below).
    if (closed && index === sub.segments.length - 1) return;
    points.push({ x: segment.p1.x, y: segment.p1.y, hIn: handle(segment.p1, segment.c2), hOut: null });
  });

  // `hOut` of every anchor is the c1 of the cubic that LEAVES it.
  points.forEach((point, index) => {
    const segment = sub.segments[index];
    if (segment) point.hOut = handle(point, segment.c1);
  });
  if (closed && points.length > 1) {
    const wrap = sub.segments[sub.segments.length - 1];
    points[0].hIn = handle(points[0], wrap.c2);
  }
  return { points, closed };
}

/** The anchor geometry a layer's DRAWING actually corresponds to (arc/rawD aware). */
export function layerAnchorsFromGeometry(layer: PathGeometrySource): { points: PathPoint[]; closed: boolean } {
  return anchorsFromSubPaths(resolvePathGeometry(layer));
}

/**
 * The same conversion, but ONLY when the drawing is a single contour.
 *
 * That is the sound precondition for "make the anchors describe what is drawn":
 * a multi-contour `rawD` (an ornament, a boolean result) cannot become ONE anchor
 * list without losing geometry, so callers must leave it as the frozen shape it
 * is. Returns null when the drawing is not representable as one contour.
 */
export function singleContourAnchors(layer: PathGeometrySource): { points: PathPoint[]; closed: boolean } | null {
  const subpaths = resolvePathGeometry(layer).filter((sub) => sub.segments.length > 0);
  if (subpaths.length !== 1) return null;
  return anchorsFromSubPaths(subpaths);
}

/**
 * Nearest point ON the shape a layer actually DRAWS (arc / `rawD` / anchors).
 *
 * `segIndex`/`t` index the flattened segment list, in exactly the order
 * `anchorsFromSubPaths` reconstructs it — so "grab the line here and make it a
 * node here" is one hit test, and the node lands under the pointer instead of on
 * the chord between two anchors.
 */
export function nearestPointOnLayerPath(
  layer: PathGeometrySource,
  target: Pt,
  steps = 24,
): { segIndex: number; t: number; distance: number; point: Pt } | null {
  const segments = resolvePathGeometry(layer).flatMap((sub) => sub.segments);
  if (segments.length === 0) return null;
  return nearestSegmentOnCubics(segments, target, steps);
}

/* ------------------------------------------------------------------ */
/* Flattening                                                          */
/* ------------------------------------------------------------------ */

/**
 * How many straight pieces a cubic needs to stay within `tolerance` px of the
 * true curve. Derived from the control polygon's length (a standard, cheap
 * upper bound) instead of a fixed sample count, so a tiny segment is not
 * over-sampled and a huge swoosh is not under-sampled.
 */
export function cubicFlattenSteps(segment: CubicSegment, tolerance: number): number {
  const { p0, c1, c2, p1 } = segment;
  const polygon =
    Math.hypot(c1.x - p0.x, c1.y - p0.y) +
    Math.hypot(c2.x - c1.x, c2.y - c1.y) +
    Math.hypot(p1.x - c2.x, p1.y - c2.y);
  const safeTolerance = Math.max(0.01, tolerance);
  const steps = Math.ceil(Math.sqrt(polygon / (8 * safeTolerance)));
  return Math.max(2, Math.min(96, steps));
}

function pointOnCubic(segment: CubicSegment, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p1.x,
    y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p1.y,
  };
}

/**
 * True when a cubic is really a straight line — both controls sit on the
 * segment. Straight edges are the overwhelming majority (rectangles, dividers,
 * ornament rules), and emitting a single vertex for them keeps the region
 * graph, hit tests and boolean ops an order of magnitude cheaper.
 */
export function isStraightCubic(segment: CubicSegment, eps = 1e-6): boolean {
  return (
    pointOnSegment(segment.c1, segment.p0, segment.p1, eps) &&
    pointOnSegment(segment.c2, segment.p0, segment.p1, eps)
  );
}

/** Flatten ONE cubic (points after `p0`, ending on `p1`). */
export function flattenCubic(segment: CubicSegment, tolerance = 0.6): Pt[] {
  // A straight segment needs no samples: its polyline IS its two endpoints.
  if (isStraightCubic(segment)) return [{ ...segment.p1 }];
  const steps = cubicFlattenSteps(segment, tolerance);
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i += 1) out.push(pointOnCubic(segment, i / steps));
  return out;
}

/**
 * Flatten a whole subpath to a polyline starting at `start`.
 * Consecutive duplicates are dropped so the result is safe to feed an
 * intersection/graph builder that assumes non-degenerate edges.
 */
export function flattenSubPath(subpath: SubPath, tolerance = 0.6): Pt[] {
  const points: Pt[] = [{ ...subpath.start }];
  for (const segment of subpath.segments) {
    for (const p of flattenCubic(segment, tolerance)) points.push(p);
  }
  if (subpath.closed && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-9) points.pop();
  }
  const cleaned: Pt[] = [];
  for (const p of points) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-9) cleaned.push(p);
  }
  return cleaned;
}

export type FlatPolyline = { points: Pt[]; closed: boolean };

export function flattenSubPaths(subpaths: SubPath[], tolerance = 0.6): FlatPolyline[] {
  return subpaths
    .map((sub) => ({ points: flattenSubPath(sub, tolerance), closed: sub.closed }))
    .filter((poly) => poly.points.length >= 2);
}

/* ------------------------------------------------------------------ */
/* Polygon maths (shared by regions + hit tests)                       */
/* ------------------------------------------------------------------ */

/** Shoelace signed area; positive = counter-clockwise in a y-down screen frame. */
export function polygonSignedArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export type FillRule = "nonzero" | "evenodd";

/**
 * Point-in-polygon for a SET of contours (a path may have several).
 *
 * Uses the SVG fill-rule semantics: `nonzero` counts signed crossings
 * (so a hole drawn in the opposite direction subtracts), `evenodd` counts
 * them all (so any shared area cancels).
 *
 * A point exactly on an edge is implementation-defined by the spec; this
 * returns `true` for a hit within `EPS`, which is what a paint tool wants.
 */
export function pointInContours(point: Pt, contours: Pt[][], rule: FillRule = "nonzero"): boolean {
  let winding = 0;
  let crossings = 0;

  for (const contour of contours) {
    if (contour.length < 3) continue;
    if (pointOnBoundary(point, contour)) return true;

    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (side === 0) continue;
      const crossesDown = a.y <= point.y && b.y > point.y && side > 0;
      const crossesUp = a.y > point.y && b.y <= point.y && side < 0;
      if (crossesDown || crossesUp) {
        winding += side > 0 ? 1 : -1;
        crossings += 1;
      }
    }
  }

  return rule === "evenodd" ? crossings % 2 === 1 : winding !== 0;
}

function pointOnBoundary(point: Pt, contour: Pt[], eps = 1e-6): boolean {
  for (let i = 0; i < contour.length; i += 1) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    if (pointOnSegment(point, a, b, eps)) return true;
  }
  return false;
}

export function pointOnSegment(p: Pt, a: Pt, b: Pt, eps = 1e-6): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > eps) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lenSq + eps;
}
