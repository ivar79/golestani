/**
 * Exact rotation, straight-line length/angle, and handle (tangent) angles.
 *
 * WHY THIS EXISTS
 * ---------------
 * Rotation used to be a visual-only affordance: the resize handle produced an
 * `angle` with whatever precision a pointer delta happened to carry, and a
 * "line" had no first-class notion of its length or direction, so the two were
 * coupled — nudging the angle stretched the line.
 *
 * These helpers make the geometry itself the contract:
 *   - `setLineAngle` rotates a straight line and PRESERVES its length;
 *   - `setLineLength` scales it and PRESERVES its angle;
 *   - any decimal angle is accepted (0.1°, 0.25°, 0.37°, negatives …);
 *   - `snapAngle` implements the configurable keyboard/arrow increment
 *     (Shift = 15°, Alt = 0.1°) without hard-coding UI policy here.
 *
 * Everything is a pure transform on real control points, so a rotated path is
 * rotated geometry — not a CSS illusion that export and hit-testing ignore.
 *
 * Pure: no DOM, no React.
 */

import type { PathPoint } from "./document";
import { normalizePathLayer, pathPadding } from "./path";

export type Pt = { x: number; y: number };

/** The angles a rotate control should offer as one-click presets. */
export const ANGLE_PRESETS = [0, 0.1, 0.25, 0.5, 1, 2, 5, 15, 45, 90, 180] as const;

/** Arrow-key increment, and the modifiers that refine it. */
export const DEFAULT_ANGLE_STEP = 1;
export const FINE_ANGLE_STEP = 0.1;
export const COARSE_ANGLE_STEP = 15;

export const DEG = Math.PI / 180;

/** Wrap into (-180, 180] — the range the server validator clamps to. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let value = deg % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  // Kill float dust so 0.1 + 0.2 style drift never reaches the document.
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Snap to a step. `0.1` really produces 0.1 (not 0.09999999999999999) because
 * the result is rounded at the grid's own precision.
 */
export function snapAngle(deg: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return normalizeAngle(deg);
  // normalizeAngle rounds to 1e-6, which is what keeps `0.1 * 123` from
  // leaking 12.299999999999999 into the document.
  return normalizeAngle(Math.round(deg / step) * step);
}

/** How many decimal places a step needs, for the numeric angle input. */
export function angleStepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
}

/** The increment for a keyboard event, given the editor's configured step. */
export function angleStepForEvent(step: number, modifiers: { shift?: boolean; alt?: boolean } = {}): number {
  if (modifiers.alt) return FINE_ANGLE_STEP;
  if (modifiers.shift) return COARSE_ANGLE_STEP;
  return step > 0 ? step : DEFAULT_ANGLE_STEP;
}

export function rotatePoint(point: Pt, origin: Pt, degrees: number): Pt {
  const rad = degrees * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/**
 * Rotate anchors about `origin`. Handles rotate with their anchor, so the curve
 * is rotated rigidly — tangent angles are preserved, which is what makes this a
 * real geometry transform rather than a re-shaping.
 */
export function rotatePoints(points: PathPoint[], origin: Pt, degrees: number): PathPoint[] {
  return points.map((point) => ({
    ...point,
    ...rotatePoint(point, origin, degrees),
    hIn: point.hIn ? rotatePoint(point.hIn, origin, degrees) : point.hIn ?? null,
    hOut: point.hOut ? rotatePoint(point.hOut, origin, degrees) : point.hOut ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/* Straight-line length / angle (decoupled)                            */
/* ------------------------------------------------------------------ */

export type LineMetrics = {
  length: number;
  /** Degrees, in (-180, 180]. */
  angleDeg: number;
  center: Pt;
  start: Pt;
  end: Pt;
};

/** Length, direction and centre of a two-point line. */
export function lineMetrics(points: PathPoint[]): LineMetrics | null {
  if (points.length < 2) return null;
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    length: Math.hypot(dx, dy),
    angleDeg: normalizeAngle(Math.atan2(dy, dx) / DEG),
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    start: { x: a.x, y: a.y },
    end: { x: b.x, y: b.y },
  };
}

/**
 * Re-aim a straight line to `degrees` about its own centre.
 *
 * The length is read from the CURRENT geometry and re-applied exactly, so
 * changing the angle can never change the length — the §22 requirement. Any
 * decimal precision is kept.
 */
export function setLineAngle(points: PathPoint[], degrees: number): PathPoint[] {
  if (points.length < 2) return points;
  const metrics = lineMetrics(points);
  if (!metrics || metrics.length === 0) return points;
  const half = metrics.length / 2;
  const rad = degrees * DEG;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const next = points.slice();
  next[0] = { ...next[0], x: metrics.center.x - dx, y: metrics.center.y - dy };
  next[1] = { ...next[1], x: metrics.center.x + dx, y: metrics.center.y + dy };
  return next;
}

/**
 * Rescale a straight line to `length` while keeping its direction exactly.
 * Endpoints move symmetrically about the centre.
 */
export function setLineLength(points: PathPoint[], length: number): PathPoint[] {
  if (points.length < 2 || !Number.isFinite(length) || length <= 0) return points;
  const metrics = lineMetrics(points);
  if (!metrics || metrics.length === 0) return points;
  const rad = metrics.angleDeg * DEG;
  const half = length / 2;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const next = points.slice();
  next[0] = { ...next[0], x: metrics.center.x - dx, y: metrics.center.y - dy };
  next[1] = { ...next[1], x: metrics.center.x + dx, y: metrics.center.y + dy };
  return next;
}

/* ------------------------------------------------------------------ */
/* Handle / tangent angles                                             */
/* ------------------------------------------------------------------ */

export type HandleVector = { angleDeg: number; length: number };

/** Angle + length of one handle. Null when the anchor has no such handle. */
export function handleVector(points: PathPoint[], index: number, which: "hIn" | "hOut"): HandleVector | null {
  const point = points[index];
  const handle = point?.[which];
  if (!point || !handle) return null;
  const dx = handle.x - point.x;
  const dy = handle.y - point.y;
  return { angleDeg: normalizeAngle(Math.atan2(dy, dx) / DEG), length: Math.hypot(dx, dy) };
}

/**
 * Re-aim one handle to an absolute angle, keeping its length (so the curve's
 * "pull" is unchanged and only the tangent rotates). `mirror` keeps the anchor
 * smooth by flipping the opposite handle to `angle + 180`.
 */
export function setHandleAngle(
  points: PathPoint[],
  index: number,
  which: "hIn" | "hOut",
  degrees: number,
  mirror = false,
): PathPoint[] {
  const point = points[index];
  const vector = handleVector(points, index, which);
  if (!point || !vector) return points;
  const rad = degrees * DEG;
  const next = points.slice();
  const handle = { x: point.x + Math.cos(rad) * vector.length, y: point.y + Math.sin(rad) * vector.length };
  const updated: PathPoint = { ...point, [which]: handle };
  if (mirror) {
    const other: "hIn" | "hOut" = which === "hIn" ? "hOut" : "hIn";
    const otherVector = handleVector(points, index, other);
    if (otherVector) {
      const opposite = (degrees + 180) * DEG;
      updated[other] = {
        x: point.x + Math.cos(opposite) * otherVector.length,
        y: point.y + Math.sin(opposite) * otherVector.length,
      };
    }
  }
  next[index] = updated;
  return next;
}

/** Re-length one handle, keeping its direction (the Width-tool-like control). */
export function setHandleLength(
  points: PathPoint[],
  index: number,
  which: "hIn" | "hOut",
  length: number,
  mirror = false,
): PathPoint[] {
  const point = points[index];
  const vector = handleVector(points, index, which);
  if (!point || !vector || !Number.isFinite(length) || length < 0) return points;
  const rad = vector.angleDeg * DEG;
  const next = points.slice();
  const updated: PathPoint = { ...point, [which]: { x: point.x + Math.cos(rad) * length, y: point.y + Math.sin(rad) * length } };
  if (mirror) {
    const other: "hIn" | "hOut" = which === "hIn" ? "hOut" : "hIn";
    const otherVector = handleVector(points, index, other);
    if (otherVector) {
      const opposite = (vector.angleDeg + 180) * DEG;
      updated[other] = {
        x: point.x + Math.cos(opposite) * otherVector.length,
        y: point.y + Math.sin(opposite) * otherVector.length,
      };
    }
  }
  next[index] = updated;
  return next;
}

/**
 * Bake a rotation INTO the anchors instead of leaving it on the layer, then
 * re-origin the box so the drawing does not move on screen.
 *
 * Use when a rotation must become real geometry (export, boolean ops, region
 * topology, or "reset rotation" that keeps the visual result).
 */
export function bakePathRotation<
  T extends { x: number; y: number; width: number; height: number; points: PathPoint[]; closed: boolean; strokeWidth?: number },
>(layer: T, degrees: number): T {
  if (degrees === 0) return layer;
  const center = { x: layer.width / 2, y: layer.height / 2 };
  const rotated = rotatePoints(layer.points, center, degrees);
  return normalizePathLayer({ ...layer, points: rotated }, pathPadding(layer.strokeWidth ?? 0));
}
