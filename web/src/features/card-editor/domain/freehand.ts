/**
 * Professional Freehand Brush Engine (perfect-freehand + rAF + Streamline).
 *
 * Eliminates pointer lag, eliminates 120Hz React state re-renders,
 * and produces silky, variable-pressure vector ribbons like Procreate.
 */

import { getStroke } from "perfect-freehand";
import { autoSmoothPoints, ramerDouglasPeucker, type PathPoint } from "./path";

export type FreehandPoint = {
  x: number;
  y: number;
  p: number; // Pressure in [0, 1]
};

/**
 * Time-based exponential smoothing for pointer samples.
 *
 * A time constant of 20.8ms reproduces roughly the previous 0.55 position
 * weight at 60Hz, while scaling correctly at higher/lower event frequencies.
 */
export function smoothFreehandSample(
  previous: FreehandPoint,
  target: FreehandPoint,
  elapsedMs: number,
  timeConstantMs = 20.8,
): FreehandPoint {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { ...previous, p: target.p };
  }
  const tau = Number.isFinite(timeConstantMs) && timeConstantMs > 0
    ? timeConstantMs
    : 20.8;
  const alpha = 1 - Math.exp(-elapsedMs / tau);
  return {
    x: previous.x + (target.x - previous.x) * alpha,
    y: previous.y + (target.y - previous.y) * alpha,
    p: target.p,
  };
}

export type FreehandBrushOptions = {
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
  last?: boolean;
};

export function getBrushStrokeOutline(
  points: FreehandPoint[],
  options: FreehandBrushOptions = {}
): number[][] {
  const {
    size = 14,
    thinning = 0.55,
    smoothing = 0.6,
    streamline = 0.35,
    simulatePressure = true,
    last = false,
  } = options;

  return getStroke(
    points.map((pt) => [pt.x, pt.y, pt.p]),
    {
      size,
      thinning,
      smoothing,
      streamline,
      simulatePressure,
      last,
    }
  );
}

/**
 * Convert stroke polygon outline points into smooth SVG Path 'd' with quadratic Bezier midpoints.
 */
export function outlineToD(pts: number[][]): string {
  if (!pts || pts.length < 4) return "";
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} Q`;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    d += ` ${x0.toFixed(1)} ${y0.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * Frame a COMMITTED brush stroke as a self-contained layer: the outline is
 * re-originated into the layer's own box, so a stroke behaves like every other
 * layer (a tight selection frame, real move/resize/rotate) instead of claiming
 * the whole artboard as its bounds.
 *
 * Returns null for a degenerate outline (the caller drops the stroke).
 */
export function brushStrokeLayerGeometry(
  outline: number[][],
  pad = 2,
): { d: string; x: number; y: number; width: number; height: number } | null {
  if (!outline || outline.length < 4) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const local = outline.map(([x, y]) => [x - minX + pad, y - minY + pad]);
  const d = outlineToD(local);
  if (!d) return null;

  return {
    d,
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}


/**
 * Convert the perfect-freehand outline into editable cubic anchors.
 *
 * Older documents may still contain `rawD`; new strokes use this editable
 * representation so resizing and point editing work exactly like Pen paths.
 */
export function outlineToEditablePath(
  outline: number[][],
  pad = 2,
  maxPoints = 72,
): { points: PathPoint[]; x: number; y: number; width: number; height: number } | null {
  if (!outline || outline.length < 4) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  const local = outline.map(([x, y]) => ({ x: x - minX + pad, y: y - minY + pad }));
  const epsilonStart = Math.max(0.35, (1 - Math.max(0, Math.min(1, fidelity))) * 4);
  let simplified = ramerDouglasPeucker(local, epsilonStart);
  let epsilon = epsilonStart;
  for (let pass = 0; pass < 8 && simplified.length > maxPoints; pass += 1) {
    epsilon = Math.min(14, epsilon * 1.55);
    const next = ramerDouglasPeucker(local, epsilon);
    if (next.length >= simplified.length) break;
    simplified = next;
  }
  if (simplified.length < 4) simplified = local.slice(0, Math.min(local.length, 4));

  const points = autoSmoothPoints(
    simplified.map((p) => ({ x: p.x, y: p.y, hIn: null, hOut: null })),
    true,
    Math.max(0, Math.min(0.45, handleSmoothing)),
  );

  return {
    points,
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}
