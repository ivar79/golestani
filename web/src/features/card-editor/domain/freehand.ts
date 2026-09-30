/**
 * Professional Freehand Brush Engine (perfect-freehand + rAF + Streamline).
 *
 * Eliminates pointer lag, eliminates 120Hz React state re-renders,
 * and produces silky, variable-pressure vector ribbons like Procreate.
 */

import { getStroke } from "perfect-freehand";

export type FreehandPoint = {
  x: number;
  y: number;
  p: number; // Pressure in [0, 1]
};

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
