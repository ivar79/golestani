/**
 * Sagitta-based Circle Arc Curves (Canva & Professional CAD Standard).
 *
 * A curved line is defined by two endpoints (x1, y1) -> (x2, y2) and a single
 * normalized signed ratio `bend`:
 *   - bend = 0    -> straight line (L x2 y2)
 *   - bend = 1.0  -> exact semicircle (s = c/2)
 *   - bend = -1.0 -> inverted semicircle
 *   - bend in [-1.5, 1.5]
 *
 * Mathematically produces true circular arcs (SVG 'A' command) instead of
 * distorted Bezier approximations, guaranteeing uniform curvature everywhere.
 */

export type CurveLineSpec = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bend: number; // Signed sagitta ratio
};

export function curveLineFrame(l: CurveLineSpec) {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const c = Math.hypot(dx, dy) || 1;
  // Unit normal perpendicular to the chord (pointing left/up in standard orientation)
  const nx = -dy / c;
  const ny = dx / c;
  const mx = (l.x1 + l.x2) / 2;
  const my = (l.y1 + l.y2) / 2;
  return { c, mx, my, nx, ny, dx, dy };
}

/**
 * Generate true SVG Arc path command 'A r r 0 large sweep x2 y2'
 */
export function curveLineD(l: CurveLineSpec): string {
  const { c } = curveLineFrame(l);
  const s = l.bend * (c / 2); // Signed sagitta (height of the arch)

  // Near-zero sagitta collapses to a straight line
  if (Math.abs(s) < 0.5) {
    return `M ${l.x1} ${l.y1} L ${l.x2} ${l.y2}`;
  }

  // Radius of the circle containing the chord and sagitta: r = (c^2 / 4 + s^2) / (2 * |s|)
  const r = (c * c / 4 + s * s) / (2 * Math.abs(s));
  const large = Math.abs(s) > c / 2 ? 1 : 0;
  // In screen space (Y down), s > 0 bends towards normal (-dy, dx)
  const sweep = s > 0 ? 0 : 1;

  return `M ${l.x1} ${l.y1} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${l.x2} ${l.y2}`;
}

/**
 * Position of the live on-canvas bend handle (middle of the arc).
 */
export function curveBendHandlePos(l: CurveLineSpec): { x: number; y: number } {
  const { c, mx, my, nx, ny } = curveLineFrame(l);
  const s = l.bend * (c / 2);
  return {
    x: mx + nx * s,
    y: my + ny * s,
  };
}

/**
 * Compute new bend ratio from pointer coordinates projected onto chord bisector.
 */
export function bendFromPointer(
  l: CurveLineSpec,
  p: { x: number; y: number },
  zoom = 1
): number {
  const { c, mx, my, nx, ny } = curveLineFrame(l);
  let s = (p.x - mx) * nx + (p.y - my) * ny;

  // Snap to straight line if within 6 screen pixels of chord
  if (Math.abs(s) * zoom < 6) {
    s = 0;
  }

  const ratio = s / (c / 2);
  return Math.max(-1.5, Math.min(1.5, Math.round(ratio * 100) / 100));
}
