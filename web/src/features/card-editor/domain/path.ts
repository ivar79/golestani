import { curveLineD } from "./curveLine";

export type PathPoint = {
  x: number;
  y: number;
  hIn?: { x: number; y: number } | null;
  hOut?: { x: number; y: number } | null;
};

/**
 * Auto-smooth an entire path by computing smooth continuous Bézier handles
 * for every anchor using Catmull-Rom spline interpolation (Adobe Illustrator Curvature Tool standard).
 */
export function autoSmoothPoints(points: PathPoint[], closed = false, tension = 0.28): PathPoint[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const n = points.length;
  const result: PathPoint[] = [];

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    let prev: PathPoint;
    let next: PathPoint;

    if (closed) {
      prev = points[(i - 1 + n) % n];
      next = points[(i + 1) % n];
    } else {
      prev = i === 0 ? curr : points[i - 1];
      next = i === n - 1 ? curr : points[i + 1];
    }

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    // Distances
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    const dTotal = dPrev + dNext || 1;

    // Scale handles proportionally
    const hInLen = (dPrev / dTotal) * tension * 2;
    const hOutLen = (dNext / dTotal) * tension * 2;

    const hIn =
      closed || i > 0
        ? { x: curr.x - dx * hInLen, y: curr.y - dy * hInLen }
        : null;

    const hOut =
      closed || i < n - 1
        ? { x: curr.x + dx * hOutLen, y: curr.y + dy * hOutLen }
        : null;

    result.push({
      x: curr.x,
      y: curr.y,
      hIn,
      hOut,
    });
  }

  return result;
}

/**
 * Straighten all anchors (remove all handles, converting to sharp corner points).
 */
export function straightenAllPoints(points: PathPoint[]): PathPoint[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    hIn: null,
    hOut: null,
  }));
}

/**
 * Turn an individual anchor into a smooth continuous point by calculating
 * tangent handles based on its previous and next anchors.
 */
export function smoothAnchorAt(points: PathPoint[], index: number, closed = false, tension = 0.28): PathPoint[] {
  if (index < 0 || index >= points.length) return points;
  const n = points.length;
  const curr = points[index];
  let prev: PathPoint;
  let next: PathPoint;

  if (closed) {
    prev = points[(index - 1 + n) % n];
    next = points[(index + 1) % n];
  } else {
    prev = index === 0 ? curr : points[index - 1];
    next = index === n - 1 ? curr : points[index + 1];
  }

  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
  const dTotal = dPrev + dNext || 1;

  const hInLen = (dPrev / dTotal) * tension * 2;
  const hOutLen = (dNext / dTotal) * tension * 2;

  const nextPoints = points.slice();
  nextPoints[index] = {
    ...curr,
    hIn: closed || index > 0 ? { x: curr.x - dx * hInLen, y: curr.y - dy * hInLen } : null,
    hOut: closed || index < n - 1 ? { x: curr.x + dx * hOutLen, y: curr.y + dy * hOutLen } : null,
  };
  return nextPoints;
}

/**
 * Turn an individual anchor into a sharp corner (straight segment endpoint)
 * by removing its incoming and outgoing control handles.
 */
export function cornerAnchorAt(points: PathPoint[], index: number): PathPoint[] {
  if (index < 0 || index >= points.length) return points;
  const nextPoints = points.slice();
  nextPoints[index] = {
    ...points[index],
    hIn: null,
    hOut: null,
  };
  return nextPoints;
}

/**
 * Toggle an anchor between Smooth (Curved with handles) and Corner (Straight sharp point).
 */
export function toggleAnchorAt(points: PathPoint[], index: number, closed = false): PathPoint[] {
  if (index < 0 || index >= points.length) return points;
  const pt = points[index];
  const isSmooth = Boolean(pt.hIn || pt.hOut);
  if (isSmooth) {
    return cornerAnchorAt(points, index);
  }
  return smoothAnchorAt(points, index, closed);
}

/**
 * Ramer-Douglas-Peucker algorithm to simplify noisy/jittery hand-drawn points.
 */
function perpendicularDistance(p: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const norm = Math.hypot(dx, dy);
  if (norm === 0) return Math.hypot(p.x - p1.x, p.y - p1.y);
  return Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / norm;
}

export function ramerDouglasPeucker(points: { x: number; y: number }[], epsilon = 3): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  let dmax = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

/** Distance formula */
const dist = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
  Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

/**
 * Decimate and smooth a raw pointer stroke with anti-jitter RDP filtering
 * and Catmull-Rom to Bezier conversion (Procreate/Illustrator quality).
 */
export function createFreehandPath(
  rawPoints: { x: number; y: number }[],
  options: { tension?: number; minDist?: number; simplifyEpsilon?: number } = {}
): PathPoint[] {
  const { tension = 0.25, minDist = 3, simplifyEpsilon = 2.5 } = options;
  if (rawPoints.length === 0) return [];

  // Decimate basic spacing
  const ptsRaw = [rawPoints[0]];
  for (let i = 1; i < rawPoints.length; i++) {
    if (dist(ptsRaw[ptsRaw.length - 1], rawPoints[i]) >= minDist) {
      ptsRaw.push(rawPoints[i]);
    }
  }

  // Apply anti-jitter curve simplification (reduces 21 shaky points to 4-5 clean key points)
  const pts = ptsRaw.length > 3 ? ramerDouglasPeucker(ptsRaw, simplifyEpsilon) : ptsRaw;

  // If only 1 point, make it a dot by duplicating
  if (pts.length === 1) {
    pts.push({ x: pts[0].x + 0.1, y: pts[0].y + 0.1 });
  }

  // Convert to bezier handles (Catmull-Rom)
  const path: PathPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i === pts.length - 1 ? i : i + 1];

    const hIn = {
      x: p1.x - (p2.x - p0.x) * tension,
      y: p1.y - (p2.y - p0.y) * tension,
    };
    const hOut = {
      x: p1.x + (p2.x - p0.x) * tension,
      y: p1.y + (p2.y - p0.y) * tension,
    };

    // First and last points don't need one of the handles, but it's safe to compute
    path.push({
      x: p1.x,
      y: p1.y,
      hIn: i > 0 ? hIn : null,
      hOut: i < pts.length - 1 ? hOut : null,
    });
  }
  return path;
}

/**
 * Generate SVG d-string from PathPoints
 */
export function pathD(points: PathPoint[], closed = false): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const c1 = prev.hOut ?? { x: prev.x, y: prev.y };
    const c2 = curr.hIn ?? { x: curr.x, y: curr.y };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${curr.x} ${curr.y}`;
  }
  if (closed && points.length > 2) {
    const prev = points[points.length - 1];
    const curr = points[0];
    const c1 = prev.hOut ?? { x: prev.x, y: prev.y };
    const c2 = curr.hIn ?? { x: curr.x, y: curr.y };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${curr.x} ${curr.y} Z`;
  }
  return d;
}

/**
 * THE path resolver — the single place a PathLayer's geometry becomes an SVG
 * `d` string. Every consumer (canvas preview, SVG/PDF export, public card) must
 * call this, never `pathD` directly, or the three can drift.
 *
 * Priority (one geometry, one contract):
 *   1. EDITABLE CURVED LINE — a 2-point line carrying a `bend` sagitta ratio.
 *      Geometry is built from `points + bend` as a true circular arc, so
 *      dragging the bend handle changes the drawing. `bend` is deliberately
 *      checked BEFORE `rawD`: an editable curve must never be shadowed by a
 *      stale pre-computed path.
 *   2. RAW PATH (`rawD`) — geometry authored directly as SVG path data:
 *      committed freehand ribbons (perfect-freehand outlines) and the
 *      ornament generators used by the heritage templates. Kept verbatim so it
 *      round-trips untouched (it is not anchor-editable).
 *   3. BEZIER ANCHORS (`points`) — the pen tool / point editor model.
 */
export function resolveLayerPathD(layer: {
  points: PathPoint[];
  closed?: boolean;
  rawD?: string;
  bend?: number;
}): string {
  if (layer.bend !== undefined && layer.points && layer.points.length === 2) {
    return curveLineD({
      x1: layer.points[0].x,
      y1: layer.points[0].y,
      x2: layer.points[1].x,
      y2: layer.points[1].y,
      bend: layer.bend,
    });
  }
  if (layer.rawD) return layer.rawD;
  return pathD(layer.points || [], layer.closed ?? false);
}

/**
 * Compute the bounding box of a path, considering anchors and handles.
 * (For exact bezier bounds this is an approximation, but it's fast and sufficient).
 */
export function pathBBox(points: PathPoint[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    for (const pt of [p, p.hIn, p.hOut]) {
      if (pt) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }

  // Fallback if no points
  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/* ------------------------------------------------------------------------- */
/* Bezier editing model — the math behind the Pen tool.                       */
/*                                                                            */
/* Everything here is pure and independently testable, so the interactive     */
/* overlays stay thin and the exported SVG uses the very same curves.         */
/* ------------------------------------------------------------------------- */

export type Pt = { x: number; y: number };

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A cubic segment resolved into its four control points. */
export type CubicSegment = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

function pt(source: { x: number; y: number }): Pt {
  return { x: source.x, y: source.y };
}

/** One cubic between two anchors (a missing handle collapses onto its anchor). */
function cubicBetween(from: PathPoint, to: PathPoint): CubicSegment {
  return {
    p0: pt(from),
    c1: from.hOut ? pt(from.hOut) : pt(from),
    c2: to.hIn ? pt(to.hIn) : pt(to),
    p1: pt(to),
  };
}

/**
 * Every drawn segment of a path. A closed path gains one extra segment running
 * from the last anchor back to the first — the same control rule `pathD` uses,
 * so geometry and rendering can never disagree.
 */
export function segmentCubics(points: PathPoint[], closed = false): CubicSegment[] {
  const segments: CubicSegment[] = [];
  for (let i = 1; i < points.length; i += 1) segments.push(cubicBetween(points[i - 1], points[i]));
  if (closed && points.length > 2) segments.push(cubicBetween(points[points.length - 1], points[0]));
  return segments;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A point on the cubic at parameter t (0..1). */
export function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

/**
 * de Casteljau split: the exact two cubics that together draw the original one.
 *
 * This is what makes "click a segment to add a point" LOSSLESS — the curve does
 * not move, it simply gains an anchor.
 */
export function splitCubic(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p1: Pt,
  t: number,
): { left: CubicSegment; right: CubicSegment; point: Pt } {
  const l1 = lerp(p0, c1, t);
  const mid = lerp(c1, c2, t);
  const r2 = lerp(c2, p1, t);
  const l2 = lerp(l1, mid, t);
  const r1 = lerp(mid, r2, t);
  const point = lerp(l2, r1, t);
  return {
    left: { p0, c1: l1, c2: l2, p1: point },
    right: { p0: point, c1: r1, c2: r2, p1 },
    point,
  };
}

/**
 * Insert an anchor on segment `segIndex` at parameter `t`, preserving the drawn
 * curve exactly. Handles are materialised on the neighbouring anchors when the
 * segment had none — a straight segment stays straight, because its control
 * points sit on its own endpoints.
 */
export function insertAnchor(points: PathPoint[], closed: boolean, segIndex: number, t: number): PathPoint[] {
  const segment = segmentCubics(points, closed)[segIndex];
  if (!segment) return points;

  const clampedT = Math.min(0.999, Math.max(0.001, t));
  const fromIndex = segIndex;
  const toIndex = segIndex + 1 >= points.length ? 0 : segIndex + 1;
  const { left, right, point } = splitCubic(segment.p0, segment.c1, segment.c2, segment.p1, clampedT);

  const next = points.map((p) => ({ ...p }));
  next[fromIndex] = { ...next[fromIndex], hOut: { ...left.c1 } };
  next[toIndex] = { ...next[toIndex], hIn: { ...right.c2 } };
  next.splice(segIndex + 1, 0, { x: point.x, y: point.y, hIn: { ...left.c2 }, hOut: { ...right.c1 } });
  return next;
}

/** Remove an anchor. Refuses to drop below the minimum drawable point count. */
export function removeAnchor(points: PathPoint[], closed: boolean, index: number): PathPoint[] {
  const minimum = closed ? 3 : 2;
  if (points.length <= minimum || index < 0 || index >= points.length) return points;
  return points.filter((_, i) => i !== index);
}

/** Move an anchor; its handles travel with it so the local curve is preserved. */
export function moveAnchor(points: PathPoint[], index: number, position: Pt): PathPoint[] {
  const current = points[index];
  if (!current) return points;
  const dx = position.x - current.x;
  const dy = position.y - current.y;
  const next = points.slice();
  next[index] = {
    ...current,
    x: position.x,
    y: position.y,
    hIn: current.hIn ? { x: current.hIn.x + dx, y: current.hIn.y + dy } : current.hIn ?? null,
    hOut: current.hOut ? { x: current.hOut.x + dx, y: current.hOut.y + dy } : current.hOut ?? null,
  };
  return next;
}

/**
 * Move one handle.
 *
 * `symmetric` (the default — holding Alt/Option turns it off) mirrors the
 * opposite handle about the anchor, which keeps the curve C1-continuous (smooth)
 * through that point: the Figma/Illustrator contract.
 */
export function moveHandle(
  points: PathPoint[],
  index: number,
  which: "hIn" | "hOut",
  position: Pt,
  symmetric = true,
): PathPoint[] {
  const current = points[index];
  if (!current) return points;
  const other: "hIn" | "hOut" = which === "hIn" ? "hOut" : "hIn";
  const next = points.slice();
  const updated: PathPoint = { ...current, [which]: { x: position.x, y: position.y } };
  if (symmetric) {
    updated[other] = { x: current.x * 2 - position.x, y: current.y * 2 - position.y };
  }
  next[index] = updated;
  return next;
}

/**
 * The bounding box of the INK: every anchor plus samples of every cubic.
 *
 * Control handles are deliberately NOT included: the layer box must hug what is
 * actually drawn (Figma does the same), while handles may sit outside it — the
 * edit overlay draws them in its own layer with `overflow: visible`, so nothing
 * is clipped. Sampling the cubics is what keeps a bulging curve from being cut
 * off, and it also covers the closing segment of a closed path.
 */
export function pathBBoxExact(points: PathPoint[], closed = false): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const track = (p: Pt | null | undefined): void => {
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };

  for (const point of points) track(point);
  const STEPS = 24;
  for (const segment of segmentCubics(points, closed)) {
    for (let step = 0; step <= STEPS; step += 1) {
      track(cubicAt(segment.p0, segment.c1, segment.c2, segment.p1, step / STEPS));
    }
  }

  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  // Rounded to 1e-6 so re-normalising is IDEMPOTENT: without this, cubic
  // sampling writes float noise like 5.000000000000028 into the box, and every
  // extra normalise pass would shift the layer a hair (and dirty the document).
  return {
    x: round6(minX),
    y: round6(minY),
    width: round6(maxX - minX),
    height: round6(maxY - minY),
  };
}

/**
 * The segment and parameter CLOSEST to a point — the hit test behind "click a
 * segment to insert an anchor" and "hover to highlight a segment".
 *
 * Sampling rather than solving the cubic: this drives a pointer affordance, and
 * ~24 samples per segment are indistinguishable from exact within a few tenths
 * of a pixel while staying trivially testable.
 */
export function nearestSegmentParam(
  points: PathPoint[],
  closed: boolean,
  target: Pt,
  steps = 24,
): { segIndex: number; t: number; distance: number } | null {
  const segments = segmentCubics(points, closed);
  if (segments.length === 0) return null;

  let best: { segIndex: number; t: number; distance: number } | null = null;
  for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
    const segment = segments[segIndex];
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = cubicAt(segment.p0, segment.c1, segment.c2, segment.p1, t);
      const distance = Math.hypot(point.x - target.x, point.y - target.y);
      if (best === null || distance < best.distance) {
        best = { segIndex, t, distance };
      }
    }
  }
  return best;
}

/** Padding a path layer needs so its own stroke never clips at the box edge. */
export function pathPadding(strokeWidth: number): number {
  const half = Math.max(0, Number.isFinite(strokeWidth) ? strokeWidth : 0) / 2;
  return half + 2;
}

/**
 * Re-origin a path layer after an edit: recompute the box from the geometry and
 * shift the points so the box starts at `pad`.
 *
 * The WORLD position of every point is preserved EXACTLY — only where the
 * layer's own origin sits changes — so re-normalising mid-edit can never make
 * the drawing jump.
 */
export function normalizePathLayer<
  T extends { x: number; y: number; width: number; height: number; points: PathPoint[]; closed: boolean },
>(layer: T, pad: number): T {
  if (layer.points.length === 0) return layer;
  const box = pathBBoxExact(layer.points, layer.closed);
  const shiftX = pad - box.x;
  const shiftY = pad - box.y;
  const points = layer.points.map((point) => ({
    x: point.x + shiftX,
    y: point.y + shiftY,
    hIn: point.hIn ? { x: point.hIn.x + shiftX, y: point.hIn.y + shiftY } : point.hIn ?? null,
    hOut: point.hOut ? { x: point.hOut.x + shiftX, y: point.hOut.y + shiftY } : point.hOut ?? null,
  }));
  return {
    ...layer,
    x: layer.x + box.x - pad,
    y: layer.y + box.y - pad,
    width: Math.max(1, box.width + pad * 2),
    height: Math.max(1, box.height + pad * 2),
    points,
  };
}
