/**
 * SVG path data → cubic Bézier geometry.
 *
 * WHY THIS EXISTS
 * ---------------
 * A PathLayer can carry three different geometry spellings: editable `points`
 * (anchors + handles), a legacy two-point `bend` arc, and a raw SVG `d`
 * string (`rawD`) written by the ornament generators and by documents saved
 * before the anchors model existed. `resolveLayerPathD` already collapses all
 * three into ONE `d` string for rendering.
 *
 * Regions/faces, offsetting, boolean ops and outline-based hit tests cannot
 * work on a string, so this module parses that same `d` back into cubic
 * segments. Together they form the canonical geometry layer:
 *
 *     PathLayer ──resolveLayerPathD──▶ d ──parsePathData──▶ CubicSegment[]
 *
 * Every consumer (renderer, region builder, future boolean ops) reads the SAME
 * geometry, and `rawD` stops being a parallel source of truth.
 *
 * Pure: no DOM, no React. Arcs are converted to cubics (≤90° per piece), so
 * downstream code only ever has to handle one segment kind.
 */

export type Pt = { x: number; y: number };

/** A cubic segment resolved into its four control points. */
export type CubicSegment = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

export type SubPath = {
  segments: CubicSegment[];
  closed: boolean;
  /** Where the subpath starts — used for endpoint snapping / gap closure. */
  start: Pt;
};

/** Matches one SVG number (integer, decimal, exponent, leading sign). */
const NUMBER = "-?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?";
/** Numbers must win over command letters or the `e` in `1e5` splits. */
const TOKEN = new RegExp(`${NUMBER}|[a-zA-Z]`, "g");

/** Argument count per command letter. */
const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

export function tokenizePathData(d: string): string[] {
  return d.match(TOKEN) ?? [];
}

/**
 * Endpoint-parameterised SVG arc → cubic segments (SVG 1.1 appendix F.6).
 *
 * Splits the sweep into ≤90° pieces, where the standard cubic approximation
 * is accurate to well under a tenth of a pixel at card scale.
 */
export function arcToCubics(
  x1: number, y1: number,
  rx: number, ry: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number, y2: number,
): CubicSegment[] {
  // Degenerate radii: the spec says treat the arc as a straight line.
  if (rx === 0 || ry === 0) {
    return [{ p0: { x: x1, y: y1 }, c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, p1: { x: x2, y: y2 } }];
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Scale radii up when they cannot span the chord (spec F.6.6).
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  else if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const step = deltaAngle / pieces;
  // Cubic approximation constant for an arc of `step` radians.
  const alpha = (4 / 3) * Math.tan(step / 4);

  const out: CubicSegment[] = [];
  let theta = startAngle;
  let from: Pt = { x: x1, y: y1 };

  for (let i = 0; i < pieces; i += 1) {
    const next = theta + step;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosN = Math.cos(next);
    const sinN = Math.sin(next);

    // Point + derivative on the unit circle, mapped through the ellipse.
    const map = (px: number, py: number): Pt => ({
      x: cx + rx * (cosPhi * px - sinPhi * py),
      y: cy + ry * (sinPhi * px + cosPhi * py),
    });

    const end = map(cosN, sinN);
    const c1 = map(cosT - alpha * sinT, sinT + alpha * cosT);
    const c2 = map(cosN + alpha * sinN, sinN - alpha * cosN);

    out.push({ p0: from, c1, c2, p1: end });
    from = end;
    theta = next;
  }

  // Snap the final point to the requested endpoint (kills float drift).
  if (out.length > 0) out[out.length - 1].p1 = { x: x2, y: y2 };
  return out;
}

function line(from: Pt, to: Pt): CubicSegment {
  return { p0: from, c1: { ...from }, c2: { ...to }, p1: { ...to } };
}

/**
 * Parse a `d` string into subpaths of cubic segments.
 *
 * A straight `L`/`H`/`V` becomes a cubic whose control points sit on its own
 * endpoints — so a "straight" segment flattens to exactly its two anchors and
 * downstream code needs no special case.
 *
 * Unsupported/garbage input degrades to the segments parsed so far rather than
 * throwing: a malformed legacy path must never break the editor.
 */
export function parsePathData(d: string): SubPath[] {
  if (!d) return [];
  const tokens = tokenizePathData(d);
  const subpaths: SubPath[] = [];

  let current: Pt = { x: 0, y: 0 };
  let subpathStart: Pt = { x: 0, y: 0 };
  let active: SubPath | null = null;
  // Reflection state for `S`/`T` (the control point of the previous cubic/quad).
  let lastCubicControl: Pt | null = null;
  let lastQuadControl: Pt | null = null;
  let cmd = "";
  let i = 0;

  const begin = (): SubPath => {
    const created: SubPath = { segments: [], closed: false, start: { ...current } };
    subpaths.push(created);
    active = created;
    return created;
  };

  // Reading through a function keeps TypeScript from narrowing `active` to
  // `null` (it cannot see that `begin()` assigns it), which would otherwise
  // open a fresh subpath on every command.
  const activeSubPath = (): SubPath | null => active;

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-zA-Z]$/.test(token)) {
      cmd = token;
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        const closing = activeSubPath();
        if (closing) {
          const last = closing.segments[closing.segments.length - 1];
          const from = last ? last.p1 : closing.start;
          if (Math.hypot(from.x - closing.start.x, from.y - closing.start.y) > 1e-9) {
            closing.segments.push(line(from, closing.start));
          }
          closing.closed = true;
        }
        current = { ...subpathStart };
        lastCubicControl = null;
        lastQuadControl = null;
        continue;
      }
    } else if (!cmd) {
      // Numbers before any command letter — nothing sensible to do.
      i += 1;
      continue;
    }

    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const arity = ARITY[upper];
    if (arity === undefined || arity === 0) {
      i += 1;
      continue;
    }
    if (i + arity > tokens.length) break;

    const raw = tokens.slice(i, i + arity);
    const nums = raw.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      i += 1;
      continue;
    }
    i += arity;

    const baseX = relative ? current.x : 0;
    const baseY = relative ? current.y : 0;

    switch (upper) {
      case "M": {
        current = { x: nums[0] + baseX, y: nums[1] + baseY };
        subpathStart = { ...current };
        begin();
        lastCubicControl = null;
        lastQuadControl = null;
        // Implicit line-to for the pairs that follow a moveto.
        cmd = relative ? "l" : "L";
        break;
      }
      case "L": {
        const to = { x: nums[0] + baseX, y: nums[1] + baseY };
        (activeSubPath() ?? begin()).segments.push(line(current, to));
        current = to;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case "H": {
        const to = { x: nums[0] + baseX, y: current.y };
        (activeSubPath() ?? begin()).segments.push(line(current, to));
        current = to;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case "V": {
        const to = { x: current.x, y: nums[0] + baseY };
        (activeSubPath() ?? begin()).segments.push(line(current, to));
        current = to;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case "C": {
        const c1 = { x: nums[0] + baseX, y: nums[1] + baseY };
        const c2 = { x: nums[2] + baseX, y: nums[3] + baseY };
        const p1 = { x: nums[4] + baseX, y: nums[5] + baseY };
        (activeSubPath() ?? begin()).segments.push({ p0: { ...current }, c1, c2, p1 });
        current = p1;
        lastCubicControl = c2;
        lastQuadControl = null;
        break;
      }
      case "S": {
        const reflect = lastCubicControl
          ? { x: current.x * 2 - lastCubicControl.x, y: current.y * 2 - lastCubicControl.y }
          : { ...current };
        const c2 = { x: nums[0] + baseX, y: nums[1] + baseY };
        const p1 = { x: nums[2] + baseX, y: nums[3] + baseY };
        (activeSubPath() ?? begin()).segments.push({ p0: { ...current }, c1: reflect, c2, p1 });
        current = p1;
        lastCubicControl = c2;
        lastQuadControl = null;
        break;
      }
      case "Q": {
        const q: Pt = { x: nums[0] + baseX, y: nums[1] + baseY };
        const p1 = { x: nums[2] + baseX, y: nums[3] + baseY };
        // Exact quadratic → cubic elevation.
        const c1 = { x: current.x + (2 / 3) * (q.x - current.x), y: current.y + (2 / 3) * (q.y - current.y) };
        const c2 = { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) };
        (activeSubPath() ?? begin()).segments.push({ p0: { ...current }, c1, c2, p1 });
        current = p1;
        lastQuadControl = q;
        lastCubicControl = null;
        break;
      }
      case "T": {
        const q: Pt = lastQuadControl
          ? { x: current.x * 2 - lastQuadControl.x, y: current.y * 2 - lastQuadControl.y }
          : { ...current };
        const p1 = { x: nums[0] + baseX, y: nums[1] + baseY };
        const c1 = { x: current.x + (2 / 3) * (q.x - current.x), y: current.y + (2 / 3) * (q.y - current.y) };
        const c2 = { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) };
        (activeSubPath() ?? begin()).segments.push({ p0: { ...current }, c1, c2, p1 });
        current = p1;
        lastQuadControl = q;
        lastCubicControl = null;
        break;
      }
      case "A": {
        const p1 = { x: nums[5] + baseX, y: nums[6] + baseY };
        const pieces = arcToCubics(
          current.x, current.y,
          nums[0], nums[1],
          nums[2],
          nums[3] !== 0,
          nums[4] !== 0,
          p1.x, p1.y,
        );
        const target = activeSubPath() ?? begin();
        for (const piece of pieces) target.segments.push(piece);
        current = p1;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      default:
        break;
    }
  }

  return subpaths;
}
