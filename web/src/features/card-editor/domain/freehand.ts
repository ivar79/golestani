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
