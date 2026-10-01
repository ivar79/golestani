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


export type CurveProfile = "arc" | "sine" | "sine-asymmetric" | "s";

/**
 * Generate editable cubic anchors for the dedicated Curve tool.
 *
 * Unlike the legacy two-point arc, these profiles are real multi-anchor
 * Bezier paths. That means the user can resize them, edit individual anchors,
 * and create symmetric or intentionally asymmetric waves without changing the
 * editor engine/document contract.
 */
export function curveProfilePoints(
  width: number,
  height: number,
  profile: CurveProfile,
  amplitude = 0.38,
  cycles = 1,
) {
  const count = profile === "arc" ? 2 : 9;
  const mid = height / 2;
  const amp = Math.max(8, Math.min(height * 0.48, height * amplitude));
  const points: { x: number; y: number; hIn: { x: number; y: number } | null; hOut: { x: number; y: number } | null }[] = [];

  if (profile === "arc") {
    return [
      { x: 0, y: mid, hIn: null, hOut: null },
      { x: width, y: mid, hIn: null, hOut: null },
    ];
  }

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    let wave = 0;
    if (profile === "sine") {
      wave = Math.sin(t * Math.PI * 2 * Math.max(0.5, cycles));
    } else if (profile === "sine-asymmetric") {
      // A harmonic blend keeps the wave continuous but deliberately changes
      // the rise/fall profile so it is not just a mirrored sine.
      wave =
        Math.sin(t * Math.PI * 2 * Math.max(0.5, cycles)) * 0.72 +
        Math.sin(t * Math.PI * 4 * Math.max(0.5, cycles) + 0.65) * 0.28;
    } else {
      wave = Math.sin(t * Math.PI * 2) * (0.72 + 0.28 * t);
    }
    points.push({
      x: width * t,
      y: mid - wave * amp,
      hIn: null,
      hOut: null,
    });
  }

  // Catmull-Rom-like tangent handles. Kept local to avoid a domain import cycle.
  for (let i = 0; i < points.length; i += 1) {
    const curr = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const inHandle = i > 0 ? { x: curr.x - dx * 0.16, y: curr.y - dy * 0.16 } : null;
    const outHandle = i < points.length - 1 ? { x: curr.x + dx * 0.16, y: curr.y + dy * 0.16 } : null;
    curr.hIn = inHandle;
    curr.hOut = outHandle;
  }

  return points;
}
