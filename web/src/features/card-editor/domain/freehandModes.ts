/**
 * Freehand pipeline (§6) — the pencil is a FITTING pipeline, not a smoothing
 * filter. Perfect-freehand already draws a nice ribbon, but a ribbon is a dead
 * blob: it cannot be node-edited, snapped or measured. This module turns raw
 * pointer samples into genuine editable Bezier anchors:
 *
 *   raw samples
 *      ↓ smoothing      (streamline: averages pointer jitter)
 *      ↓ fidelity       (how much detail is allowed to survive)
 *      ↓ simplification (RDP)
 *      ↓ curve fitting  (corner detection → Catmull-Rom handles)
 *      ↓ editable Bezier PathPoint[]
 *
 * Modes:
 *   free        — faithful fitting of whatever was drawn
 *   straight    — exactly two anchors: an accurate straight line
 *   constrained — segments snapped to configured angle increments / axes
 *
 * Pure: no DOM, no React, no timers.
 */

import { autoSmoothPoints, createFreehandPath, ramerDouglasPeucker, type PathPoint } from "./path";
import { CLOSE_TOLERANCE_DEFAULT, constrainToAngle } from "./pathOps";

export type FreehandMode = "free" | "straight" | "constrained";

export const FREEHAND_MODE_LABELS: Record<FreehandMode, string> = {
  free: "آزاد",
  straight: "خط صاف",
  constrained: "مقید (زاویه‌دار)",
};

/** The snapping grid offered by the constrained mode (spec: 0/45/90/135…). */
export const ANGLE_SNAP_PRESETS = [15, 30, 45, 90] as const;
export const ANGLE_SNAP_DEFAULT = 45;

export type FreehandOptions = {
  mode: FreehandMode;
  /** 0..1 — streamline amount applied to the raw samples. */
  smoothing: number;
  /** 0..1 — 1 keeps every corner, 0 accepts a very round, very cheap path. */
  fidelity: number;
  /** Angle increments in degrees for the constrained mode. */
  angleIncrements: number[];
  /** Degrees of tolerance around each increment. */
  angleTolerance: number;
  /** Horizontal/vertical lock while drawing. */
  axisLock: boolean;
  /** Auto-close the path when its ends are this close (design px). */
  closeTolerance: number;
  /** Hard cap on generated anchors (validator MAX_PATH_POINTS). */
  maxPoints: number;
};

export const DEFAULT_FREEHAND_OPTIONS: FreehandOptions = {
  mode: "free",
  smoothing: 0.45,
  fidelity: 0.75,
  angleIncrements: [ANGLE_SNAP_DEFAULT],
  angleTolerance: 5,
  axisLock: true,
  closeTolerance: CLOSE_TOLERANCE_DEFAULT,
  maxPoints: 72,
};

function clamp01(value: number, fallback: number): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

export function normalizeFreehandOptions(input: Partial<FreehandOptions> = {}): FreehandOptions {
  const mode: FreehandMode =
    input.mode === "straight" || input.mode === "constrained" ? input.mode : "free";
  const increments = (input.angleIncrements ?? DEFAULT_FREEHAND_OPTIONS.angleIncrements)
    .map((inc) => Math.abs(inc))
    .filter((inc) => Number.isFinite(inc) && inc > 0 && inc <= 180)
    .slice(0, 8);
  return {
    mode,
    smoothing: clamp01(input.smoothing ?? DEFAULT_FREEHAND_OPTIONS.smoothing, 0.45),
    fidelity: clamp01(input.fidelity ?? DEFAULT_FREEHAND_OPTIONS.fidelity, 0.75),
    angleIncrements: increments.length > 0 ? increments : [ANGLE_SNAP_DEFAULT],
    angleTolerance: Math.min(45, Math.max(0.5, input.angleTolerance ?? DEFAULT_FREEHAND_OPTIONS.angleTolerance)),
    axisLock: input.axisLock ?? DEFAULT_FREEHAND_OPTIONS.axisLock,
    closeTolerance: Math.max(0, input.closeTolerance ?? DEFAULT_FREEHAND_OPTIONS.closeTolerance),
    maxPoints: Math.max(2, Math.round(input.maxPoints ?? DEFAULT_FREEHAND_OPTIONS.maxPoints)),
  };
}

/**
 * Streamline: average each interior sample towards its neighbours. This is the
 * classic one-euro/streamline behaviour — the ENDS never move (a stroke must
 * start and end exactly where the finger did).
 */
export function smoothSamples(
  samples: { x: number; y: number }[],
  amount: number,
  passes = 2,
): { x: number; y: number }[] {
  const strength = clamp01(amount, 0);
  if (strength <= 0 || samples.length < 3) return samples.map((p) => ({ x: p.x, y: p.y }));
  let current = samples.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < Math.max(1, passes); pass += 1) {
    const next = current.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < current.length - 1; i += 1) {
      const avgX = (current[i - 1].x + current[i + 1].x) / 2;
      const avgY = (current[i - 1].y + current[i + 1].y) / 2;
      next[i] = {
        x: current[i].x + (avgX - current[i].x) * strength,
        y: current[i].y + (avgY - current[i].y) * strength,
      };
    }
    current = next;
  }
  return current;
}

/**
 * Fidelity → simplification tolerance, measured in design px.
 *
 * Multiplicative around the historical 2.5px default (which is what the pencil
 * used before this pipeline existed, so the default output is unchanged):
 * fidelity 0.75 → 2.5px, 1.0 → 1.67px (every corner survives), 0 → 8.4px.
 */
export function simplifyEpsilonFor(fidelity: number): number {
  const f = clamp01(fidelity, DEFAULT_FREEHAND_OPTIONS.fidelity);
  return Math.max(0.8, 2.5 * Math.pow(5, 0.75 - f));
}

/** Fidelity also limits the smoothing, so "keep my corners" actually does. */
export function effectiveSmoothing(smoothing: number, fidelity: number): number {
  const s = clamp01(smoothing, 0.45);
  const f = clamp01(fidelity, 0.75);
  return Math.min(s, 1 - f * 0.6);
}

/**
 * Snap every segment of a polyline onto the configured angle increments.
 *
 * Each segment is snapped about the PREVIOUS (already snapped) anchor, so a
 * constrained freehand stroke is a chain of accurate lines — a 45° segment is
 * exactly 45°, and an axis-aligned one is exactly horizontal/vertical.
 */
export function snapSegmentsToIncrements(
  points: PathPoint[],
  increments: number[],
  tolerance: number,
  axisLock = true,
): PathPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const out: PathPoint[] = [{ ...points[0], hIn: null, hOut: null }];
  for (let i = 1; i < points.length; i += 1) {
    const from = out[i - 1];
    const to = points[i];
    const constrained = constrainToAngle(from, to, { increments, tolerance, axisLock });
    out.push({ x: constrained.x, y: constrained.y, hIn: null, hOut: null });
  }
  return out;
}

/** Two anchors: an accurate straight line between the first and last sample. */
export function straightModePath(
  samples: { x: number; y: number }[],
  options: FreehandOptions,
): PathPoint[] {
  if (samples.length < 2) return samples.map((p) => ({ x: p.x, y: p.y, hIn: null, hOut: null }));
  const first = samples[0];
  const last = samples[samples.length - 1];
  const constrained = constrainToAngle(first, last, {
    increments: options.angleIncrements,
    tolerance: options.angleTolerance,
    axisLock: options.axisLock,
  });
  return [
    { x: first.x, y: first.y, hIn: null, hOut: null },
    { x: constrained.x, y: constrained.y, hIn: null, hOut: null },
  ];
}

export type FreehandFit = {
  points: PathPoint[];
  /** The path closed itself (its ends were within the tolerance). */
  closed: boolean;
  /** Anchors dropped by simplification — useful telemetry for the UI. */
  simplifiedFrom: number;
  /** True when the stroke collapsed to nothing (the caller should drop it). */
  degenerate: boolean;
};

/**
 * The whole pipeline. `samples` are artboard-space pointer samples (already
 * de-duplicated by the caller); mode/tuning come from the freehand options.
 */
export function freehandPipeline(
  samples: { x: number; y: number }[],
  optionsInput: Partial<FreehandOptions> = {},
): FreehandFit {
  const options = normalizeFreehandOptions(optionsInput);
  if (samples.length < 2) {
    return { points: [], closed: false, simplifiedFrom: 0, degenerate: true };
  }

  const straightened = straightModePath(samples, options);
  if (options.mode === "straight") {
    const length = Math.hypot(
      straightened[straightened.length - 1].x - straightened[0].x,
      straightened[straightened.length - 1].y - straightened[0].y,
    );
    return { points: straightened, closed: false, simplifiedFrom: samples.length, degenerate: length < 1.5 };
  }

  const smoothed = smoothSamples(samples, effectiveSmoothing(options.smoothing, options.fidelity));
  let epsilon = simplifyEpsilonFor(options.fidelity);

  // Free + constrained share the same fitting core (spacing decimation → RDP →
  // Catmull-Rom handles) so a free stroke and a constrained one cannot drift
  // apart in style.
  let fitted = createFreehandPath(smoothed, { simplifyEpsilon: epsilon });

  // Anchor cap: re FIT the same samples with a coarser tolerance instead of
  // truncating, so the path still starts and ends where the finger did.
  for (let pass = 0; pass < 8 && fitted.length > options.maxPoints; pass += 1) {
    epsilon = Math.min(40, epsilon * 1.5);
    const next = createFreehandPath(smoothed, { simplifyEpsilon: epsilon });
    if (next.length >= fitted.length) break;
    fitted = next;
  }

  if (options.mode === "constrained") {
    // Constrained re-walks the fitted anchors and snaps each segment onto the
    // configured increments / axes — the stroke becomes measurable geometry.
    const anchors = fitted.map((point) => ({ x: point.x, y: point.y, hIn: null, hOut: null }));
    const snapped = snapSegmentsToIncrements(
      anchors,
      options.angleIncrements,
      options.angleTolerance,
      options.axisLock,
    );
    fitted = autoSmoothPoints(snapped, false, 0);
  }

  // Auto-close only when the drawn stroke really did come back to its start.
  const first = fitted[0];
  const last = fitted[fitted.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const closed = options.closeTolerance > 0 && fitted.length > 3 && gap <= options.closeTolerance;
  const points = closed ? fitted.slice(0, -1) : fitted;

  return {
    points,
    closed,
    simplifiedFrom: samples.length,
    degenerate: points.length < 2,
  };
}

/** Standalone Simplify Path action (§6/§15) for an existing anchor list. */
export function simplifyAnchors(
  points: PathPoint[],
  fidelity = DEFAULT_FREEHAND_OPTIONS.fidelity,
  maxPoints = DEFAULT_FREEHAND_OPTIONS.maxPoints,
): PathPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const epsilon = simplifyEpsilonFor(fidelity);
  const reduced = ramerDouglasPeucker(points, epsilon).slice(0, maxPoints);
  return autoSmoothPoints(
    reduced.map((point) => ({ x: point.x, y: point.y, hIn: null, hOut: null })),
    false,
    0.28,
  );
}
