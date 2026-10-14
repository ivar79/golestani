/**
 * Rulers, user guides and the angle-assist ("set-square") grid.
 *
 * VIEW STATE ONLY — this module exists so the three design aids have a single
 * pure home, exactly like `snapping.ts` does for smart guides:
 *
 *   - RULER TICKS: a coordinate scale the user can read off the board.
 *   - USER GUIDES: persistent lines the user placed. A guide is a LINE AT ANY
 *     ANGLE (horizontal, vertical or diagonal) through a point — the first
 *     version only allowed the two axes, which made "align along the diagonal"
 *     impossible. They snap like Illustrator guides and are NEVER part of the
 *     document, the save payload, the export or the public card view.
 *   - ANGLE ASSIST: the "set-square" — an explicit angular grid. It locks the
 *     pen while drawing (see domain/penGesture.ts) and locks a guide's angle
 *     while rotating it (see `snapAngle`).
 *
 * Convention: `angle` is in DEGREES, measured like the screen: 0 = a horizontal
 * line (east–west), 90 = a vertical line (north–south), 45 = the down-right
 * diagonal. `(x, y)` is a point the line passes through, in artboard units.
 *
 * Pure: no DOM, no React, no timers.
 */

import type { SnapAxis } from "./snapping";

/** Kept for callers that speak in axes; a vertical guide is a 90° line. */
export type GuideAxis = SnapAxis;

/** One user guide: an infinite line through `(x, y)` at `angle` degrees. */
export type UserGuide = { id: string; angle: number; x: number; y: number; locked?: boolean };

/** Hard cap: a board full of guides is a board nobody can read. */
export const MAX_GUIDES = 24;
/** Ruler strip thickness in SCREEN px (it does not scale with zoom). */
export const RULER_THICKNESS = 18;
/** Two same-axis guides closer than this are treated as the same guide. */
export const GUIDE_DEDUPE_PX = 0.5;

/**
 * Angular grids offered by the "set-square". 45° is the default because it is
 * the increment Illustrator and Photoshop document on the Pen tool, and it
 * already contains the horizontal, vertical and diagonal directions.
 */
export const ANGLE_ASSIST_PRESETS = [45, 30, 15, 90] as const;
export const ANGLE_ASSIST_DEFAULT = 45;

export function roundGuide(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Wrap any angle into [0, 180): a line and its reverse are the same line. */
export function normalizeAngle(degrees: number, fallback = 0): number {
  if (!Number.isFinite(degrees)) return fallback;
  const wrapped = ((degrees % 180) + 180) % 180;
  return Math.round(wrapped * 100) / 100;
}

/** True for the two axis-aligned directions (0 = horizontal, 90 = vertical). */
export function isAxisAligned(angle: number): boolean {
  const normalized = normalizeAngle(angle);
  return Math.abs(normalized) < 1e-6 || Math.abs(normalized - 90) < 1e-6;
}

/** The angle a guide created from a ruler strip gets. */
export function guideAngleForAxis(axis: GuideAxis): number {
  return axis === "x" ? 90 : 0;
}

/** Which ruler strip owns a guide: vertical lines come from the TOP strip. */
export function axisForAngle(angle: number): GuideAxis {
  return Math.abs(normalizeAngle(angle) - 90) < Math.abs(normalizeAngle(angle)) ? "x" : "y";
}

export function direction(angle: number): { dx: number; dy: number } {
  const radians = (normalizeAngle(angle) * Math.PI) / 180;
  return { dx: Math.cos(radians), dy: Math.sin(radians) };
}

/** Unit normal (perpendicular) of the line — the direction a snap moves along. */
export function normal(angle: number): { nx: number; ny: number } {
  const { dx, dy } = direction(angle);
  return { nx: -dy, ny: dx };
}

/** Clamp a point onto the board. Non-finite input falls back to the middle. */
export function clampPoint(
  point: { x: number; y: number },
  artboard: { width: number; height: number },
): { x: number; y: number } {
  const width = Number.isFinite(artboard.width) && artboard.width > 0 ? artboard.width : 0;
  const height = Number.isFinite(artboard.height) && artboard.height > 0 ? artboard.height : 0;
  return {
    x: clampAxis(point?.x, width, width / 2),
    y: clampAxis(point?.y, height, height / 2),
  };
}

/**
 * Clamp one coordinate. An INFINITE coordinate is a direction, not a broken
 * number, so it clamps to the matching edge; a NaN coordinate has no direction,
 * so it falls back.
 */
export function clampAxis(value: number, max: number, fallback = 0): number {
  const limit = Number.isFinite(max) && max > 0 ? max : 0;
  if (Number.isNaN(value)) return Math.min(Math.max(0, fallback), limit);
  if (value === Number.POSITIVE_INFINITY) return limit;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (typeof value !== "number") return Math.min(Math.max(0, fallback), limit);
  return Math.min(Math.max(0, roundGuide(value)), limit);
}

/** Kept for callers that clamp an axis-aligned guide coordinate. */
export function clampGuide(value: number, max: number, fallback = 0): number {
  return clampAxis(value, max, fallback);
}

export function extentFor(axis: GuideAxis, artboard: { width: number; height: number }): number {
  return axis === "x" ? artboard.width : artboard.height;
}

/** Perpendicular distance from a point to a guide's infinite line. */
export function distanceToGuide(guide: UserGuide, point: { x: number; y: number }): number {
  const { nx, ny } = normal(guide.angle);
  return Math.abs((point.x - guide.x) * nx + (point.y - guide.y) * ny);
}

/** The point on the line closest to `point` — where a snap would land. */
export function projectOnGuide(guide: UserGuide, point: { x: number; y: number }): { x: number; y: number } {
  const { nx, ny } = normal(guide.angle);
  const signed = (point.x - guide.x) * nx + (point.y - guide.y) * ny;
  return { x: roundGuide(point.x - signed * nx), y: roundGuide(point.y - signed * ny) };
}

/** Two guides are "the same" when their lines nearly coincide. */
function nearlySame(a: UserGuide, b: UserGuide): boolean {
  if (Math.abs(normalizeAngle(a.angle) - normalizeAngle(b.angle)) > 0.25) {
    // A 180°-flipped line is the same line: compare wrapped difference too.
    const diff = Math.abs(normalizeAngle(a.angle - b.angle));
    if (Math.min(diff, 180 - diff) > 0.25) return false;
  }
  return distanceToGuide(a, { x: b.x, y: b.y }) < GUIDE_DEDUPE_PX;
}

/**
 * The only constructor for guide state: drops broken entries, clamps every point
 * onto the board, collapses coincident lines and caps the list. Ids are
 * preserved so a drag keeps pointing at the same guide.
 */
export function normalizeGuides(
  list: readonly UserGuide[],
  artboard: { width: number; height: number },
): UserGuide[] {
  const out: UserGuide[] = [];
  for (const guide of list ?? []) {
    if (!guide) continue;
    const angle = normalizeAngle(guide.angle);
    const point = clampPoint({ x: guide.x, y: guide.y }, artboard);
    const candidate: UserGuide = {
      id: typeof guide.id === "string" && guide.id.length > 0 ? guide.id : guideId(angle, point, out),
      angle,
      x: point.x,
      y: point.y,
      locked: guide.locked === true,
    };
    if (out.some((other) => nearlySame(other, candidate))) continue;
    out.push(candidate);
    if (out.length >= MAX_GUIDES) break;
  }
  return out;
}

/** Deterministic, collision-free id — stable enough to assert in tests. */
export function guideId(
  angle: number,
  point: { x: number; y: number },
  taken: readonly UserGuide[] = [],
): string {
  const base = `guide-${normalizeAngle(angle)}-${String(roundGuide(point.x)).replace(".", "_")}-${String(
    roundGuide(point.y),
  ).replace(".", "_")}`;
  const used = new Set(taken.map((guide) => guide.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Create a guide from a ruler strip: vertical for `x`, horizontal for `y`. */
export function addGuide(
  list: readonly UserGuide[],
  axis: GuideAxis,
  at: number,
  artboard: { width: number; height: number },
): UserGuide[] {
  const angle = guideAngleForAxis(axis);
  const value = clampAxis(at, extentFor(axis, artboard));
  const point =
    axis === "x"
      ? { x: value, y: artboard.height / 2 }
      : { x: artboard.width / 2, y: value };
  return addAngledGuide(list, { angle, ...point }, artboard);
}

/**
 * Create a guide at ANY angle (the diagonal case the axis-only model could not
 * express). Coincident lines collapse instead of stacking invisibly.
 */
export function addAngledGuide(
  list: readonly UserGuide[],
  input: { angle: number; x: number; y: number },
  artboard: { width: number; height: number },
): UserGuide[] {
  const current = normalizeGuides(list, artboard);
  const angle = normalizeAngle(input.angle);
  const point = clampPoint({ x: input.x, y: input.y }, artboard);
  const candidate: UserGuide = { id: guideId(angle, point, current), angle, x: point.x, y: point.y, locked: false };
  const existing = current.find((guide) => nearlySame(guide, candidate));
  if (existing) {
    // Placing a line onto an existing one MOVES it: the user asked for a line at
    // a position, not for two lines at the same position.
    return current.map((guide) =>
      guide.id === existing.id && !guide.locked ? { ...guide, angle, x: point.x, y: point.y } : guide,
    );
  }
  if (current.length >= MAX_GUIDES) return current;
  return [...current, candidate];
}

/** Rotate a guide about its own anchor point. */
export function rotateGuide(
  list: readonly UserGuide[],
  id: string,
  angle: number,
  artboard: { width: number; height: number },
): UserGuide[] {
  const current = normalizeGuides(list, artboard);
  const target = current.find((guide) => guide.id === id);
  if (!target) return current;
  const next = normalizeAngle(angle, target.angle);
  const candidate: UserGuide = { ...target, angle: next };
  const collision = current.find((guide) => guide.id !== id && nearlySame(guide, candidate));
  // Rotating onto another guide merges them, exactly like moving does.
  if (collision) return current.filter((guide) => guide.id !== id);
  return current.map((guide) => (guide.id === id ? candidate : guide));
}

export function moveGuide(
  list: readonly UserGuide[],
  id: string,
  point: { x: number; y: number },
  artboard: { width: number; height: number },
): UserGuide[] {
  const current = normalizeGuides(list, artboard);
  const target = current.find((guide) => guide.id === id);
  if (!target || target.locked) return current;
  const clamped = clampPoint(point, artboard);
  const candidate: UserGuide = { ...target, ...clamped };
  const collision = current.find((guide) => guide.id !== id && nearlySame(guide, candidate));
  if (collision) return current.filter((guide) => guide.id !== id);
  return current.map((guide) => (guide.id === id ? candidate : guide));
}

export function toggleGuideLock(list: readonly UserGuide[], id: string): UserGuide[] {
  return list.map((guide) => guide.id === id ? { ...guide, locked: !guide.locked } : guide);
}

export function removeGuide(list: readonly UserGuide[], id: string): UserGuide[] {
  return list.filter((guide) => guide.id !== id || guide.locked === true);
}

/** The guide whose line passes nearest a point, using perpendicular distance. */
export function nearestGuide(
  list: readonly UserGuide[],
  point: { x: number; y: number },
  tolerance: number,
): UserGuide | null {
  const limit = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
  let best: UserGuide | null = null;
  let bestDistance = limit;
  for (const guide of list) {
    const distance = distanceToGuide(guide, point);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = guide;
    }
  }
  return best;
}

/**
 * Angle for a rotate gesture: the direction of the drag measured from the
 * guide's anchor, optionally locked onto the set-square grid. The lock is
 * FORCEFUL (every angle lands on the grid) because the toggle is an explicit
 * command, and it keeps the line's length/anchor untouched.
 */
export function angleFromDrag(
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  increments: readonly number[] = [],
): number {
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const usable = increments.filter((inc) => Number.isFinite(inc) && inc > 0);
  if (usable.length === 0) return normalizeAngle(raw);
  const step = Math.min(...usable);
  return normalizeAngle(Math.round(raw / step) * step);
}

/** Snap an angle onto the set-square grid (used when the toggle is on). */
export function snapAngle(angle: number, increments: readonly number[] = []): number {
  const usable = increments.filter((inc) => Number.isFinite(inc) && inc > 0);
  if (usable.length === 0) return normalizeAngle(angle);
  const step = Math.min(...usable);
  return normalizeAngle(Math.round(angle / step) * step);
}

/** Axis-aligned guides as snap LINES (the classic x/y alignment index). */
export function axisAlignedGuideLines(
  list: readonly UserGuide[],
  artboard: { width: number; height: number },
): { axis: GuideAxis; at: number }[] {
  return normalizeGuides(list, artboard)
    .filter((guide) => isAxisAligned(guide.angle))
    .map((guide) => ({
      axis: (normalizeAngle(guide.angle) === 90 ? "x" : "y") as GuideAxis,
      at: normalizeAngle(guide.angle) === 90 ? guide.x : guide.y,
    }));
}

/** Every guide as a line, for the snapping engine's angled pass. */
export function angledGuideLines(
  list: readonly UserGuide[],
  artboard: { width: number; height: number },
): { x: number; y: number; angle: number }[] {
  return normalizeGuides(list, artboard)
    .filter((guide) => !isAxisAligned(guide.angle))
    .map((guide) => ({ x: guide.x, y: guide.y, angle: guide.angle }));
}

/** Length that guarantees a line crosses the whole board at any angle. */
export function boardDiagonal(artboard: { width: number; height: number }): number {
  const width = Number.isFinite(artboard.width) ? Math.abs(artboard.width) : 0;
  const height = Number.isFinite(artboard.height) ? Math.abs(artboard.height) : 0;
  return Math.hypot(width, height);
}

/** Keep only the angle-assist increments this editor actually offers. */
export function normalizeAngleAssist(value: number | undefined): number {
  if (typeof value === "number" && (ANGLE_ASSIST_PRESETS as readonly number[]).includes(value)) {
    return value;
  }
  return ANGLE_ASSIST_DEFAULT;
}

export type RulerTick = {
  /** Coordinate in ARTBOARD units. */
  value: number;
  /** Screen offset from the ruler origin, in screen px. */
  offset: number;
  /** `major` ticks are labelled, `minor` ticks subdivide them. */
  major: boolean;
  label: string;
};

/** Candidate label spacings, coarsest last. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/**
 * Ticks for a ruler covering [from, to] artboard units at `zoom`.
 *
 * This is what makes a strip read as a RULER rather than a plain line: a chosen
 * label step (so two numbers are never closer than `minLabelGap` screen px) plus
 * minor subdivisions inside each step, with everything scaled by `zoom` so the
 * scale matches the board exactly.
 */
export function rulerTicks(
  from: number,
  to: number,
  zoom: number,
  options: { minLabelGap?: number; maxTicks?: number } = {},
): RulerTick[] {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const minLabelGap = options.minLabelGap ?? 56;
  const maxTicks = options.maxTicks ?? 600;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const step =
    TICK_STEPS.find((candidate) => candidate * scale >= minLabelGap) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const minorPerStep = step % 10 === 0 ? 10 : step % 5 === 0 ? 5 : 1;
  const minor = step / minorPerStep;
  const first = Math.floor(start / minor) * minor;
  const ticks: RulerTick[] = [];
  for (let value = first; value <= end + minor / 2; value += minor) {
    if (ticks.length >= maxTicks) break;
    const rounded = Math.round(value * 1000) / 1000;
    const major = Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6;
    ticks.push({
      value: rounded,
      offset: (rounded - start) * scale,
      major,
      label: major ? String(Math.round(rounded)) : "",
    });
  }
  return ticks;
}

/**
 * Which guide a ruler drag creates: the TOP ruler (horizontal strip) produces a
 * vertical (90°) guide, the LEFT ruler a horizontal (0°) one. Diagonals are made
 * by rotating a guide, not by dragging out of a strip — there is no axis a strip
 * could infer for them.
 */
export function guideAxisForRuler(side: "top" | "left"): GuideAxis {
  return side === "top" ? "x" : "y";
}
