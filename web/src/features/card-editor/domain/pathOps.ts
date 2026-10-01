/**
 * Path surgery (§5) — the operations a professional Pen/Node tool needs:
 * join, break, close, continue, reverse, snapping, extend, reshape, simplify,
 * plus the MULTI-NODE operations (move / delete / convert a whole selection of
 * anchors at once) that make node editing feel like a real editor instead of
 * one-anchor-at-a-time surgery.
 *
 * These are pure list operations over `PathPoint[]`. They never touch the
 * document, history or the DOM, which is why the interactive overlays stay thin
 * and every rule below is unit-testable on its own.
 *
 * Contract: handles travel WITH their anchor. Reversing, joining or breaking a
 * path therefore preserves the exact curve shape — it re-orders the geometry,
 * it never re-fits it. The same rule makes a group drag rigid: every moved
 * anchor carries its own handles, so the local curve is untouched.
 */

import {
  autoSmoothPoints,
  cornerAnchorAt,
  pathBBoxExact,
  ramerDouglasPeucker,
  smoothAnchorAt,
  type PathPoint,
} from "./path";

export type Pt = { x: number; y: number };

/** Default screen/artboard tolerance for "these two ends are the same point". */
export const JOIN_TOLERANCE_DEFAULT = 8;
export const CLOSE_TOLERANCE_DEFAULT = 6;
export const SNAP_TOLERANCE_DEFAULT = 6;

function pt(p: Pt): Pt {
  return { x: p.x, y: p.y };
}

function clonePoint(point: PathPoint): PathPoint {
  return {
    x: point.x,
    y: point.y,
    hIn: point.hIn ? pt(point.hIn) : null,
    hOut: point.hOut ? pt(point.hOut) : null,
  };
}

/**
 * Reverse the direction of travel. The incoming handle of each anchor becomes
 * its outgoing handle (and vice versa) — the drawn curve is IDENTICAL, only the
 * parameter direction flips.
 */
export function reversePoints(points: PathPoint[]): PathPoint[] {
  return points
    .slice()
    .reverse()
    .map((point) => ({
      x: point.x,
      y: point.y,
      hIn: point.hOut ? pt(point.hOut) : null,
      hOut: point.hIn ? pt(point.hIn) : null,
    }));
}

/** The two free ends of an OPEN path (for continue/join/snap affordances). */
export function pathEndpoints(points: PathPoint[]): { start: Pt; end: Pt } | null {
  if (points.length === 0) return null;
  return { start: pt(points[0]), end: pt(points[points.length - 1]) };
}

/** Distance between two points. */
export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointsEqual(a: Pt, b: Pt, tolerance = 0.5): boolean {
  return distance(a, b) <= tolerance;
}

export type JoinResult = {
  points: PathPoint[];
  /** How far apart the two ends were before joining (design px). */
  gap: number;
  /** Which physical ends were connected, for UI feedback. */
  connection: "a-end→b-start" | "a-end→b-end" | "a-start→b-start" | "a-start→b-end";
};

/**
 * Join two open paths end-to-end.
 *
 * All four end combinations are considered and the CLOSEST one wins (Illustrator
 * does the same: you never have to think about which end you clicked first).
 * When the closest pair is still farther apart than `tolerance`, nothing is
 * joined — silently welding two distant paths would destroy the drawing.
 */
export function joinPointLists(
  a: PathPoint[],
  b: PathPoint[],
  tolerance = JOIN_TOLERANCE_DEFAULT,
): JoinResult | null {
  if (a.length === 0 || b.length === 0) return null;

  const candidates: { points: PathPoint[]; gap: number; connection: JoinResult["connection"] }[] = [];

  const push = (
    first: PathPoint[],
    second: PathPoint[],
    connection: JoinResult["connection"],
  ) => {
    const gap = distance(first[first.length - 1], second[0]);
    const merged = [...first.map(clonePoint), ...second.map(clonePoint)];
    // The weld point is ONE anchor: drop the duplicated node so the path has no
    // zero-length segment (which would make the node editor show two anchors on
    // top of each other).
    if (gap <= tolerance && merged.length > 2) merged.splice(first.length, 1);
    candidates.push({ points: merged, gap, connection });
  };

  push(a, b, "a-end→b-start");
  push(a, reversePoints(b), "a-end→b-end");
  push(reversePoints(a), b, "a-start→b-start");
  push(reversePoints(a), reversePoints(b), "a-start→b-end");

  const best = candidates.reduce((winner, candidate) =>
    candidate.gap < winner.gap ? candidate : winner,
  );
  if (best.gap > tolerance) return null;
  return { points: best.points, gap: best.gap, connection: best.connection };
}

export type BreakResult = { first: PathPoint[]; second: PathPoint[] } | null;

/**
 * Break a path at an anchor.
 *
 * - OPEN path, index in the interior → TWO paths, each ending at the break node.
 * - OPEN path, index at either end → nothing to break (null).
 * - CLOSED path → ONE open path whose two ends are the (duplicated) break node.
 *   The caller decides to store it as a single open layer.
 */
export function breakPathAt(
  points: PathPoint[],
  closed: boolean,
  index: number,
): BreakResult | null {
  if (points.length < 2 || index < 0 || index >= points.length) return null;

  if (closed) {
    const rotated = [...points.slice(index), ...points.slice(0, index)];
    // Opening a closed path duplicates the break node so the shape is preserved
    // exactly: the single shared handle pair is split between the new start
    // (which keeps the outgoing handle) and the new end (which keeps the
    // incoming one, because the closing segment now arrives there).
    const head = clonePoint(rotated[0]);
    head.hIn = null;
    const tail = clonePoint(rotated[0]);
    tail.hOut = null;
    return {
      first: [head, ...rotated.slice(1).map(clonePoint), tail],
      second: [],
    };
  }

  if (index === 0 || index === points.length - 1) return null;
  return {
    first: points.slice(0, index + 1).map(clonePoint),
    second: points.slice(index).map(clonePoint),
  };
}

/**
 * Auto-close: connect the two ends when they are already visually touching.
 * Returns null when the gap is too large to be an intentional closure.
 */
export function autoCloseWithinTolerance(
  points: PathPoint[],
  tolerance = CLOSE_TOLERANCE_DEFAULT,
): PathPoint[] | null {
  if (points.length < 3) return null;
  if (distance(points[0], points[points.length - 1]) > tolerance) return null;
  return points.slice(0, -1).map(clonePoint);
}

/** Nearest anchor to a pointer, for node snapping. */
export function nearestAnchor(
  points: PathPoint[],
  pointer: Pt,
  maxDistance = SNAP_TOLERANCE_DEFAULT,
): { index: number; distance: number; point: Pt } | null {
  let bestIndex = -1;
  let bestDistance = maxDistance;
  for (let index = 0; index < points.length; index += 1) {
    const d = distance(points[index], pointer);
    if (d <= bestDistance) {
      bestDistance = d;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return null;
  return { index: bestIndex, distance: bestDistance, point: pt(points[bestIndex]) };
}

export type SnapTarget = { x: number; y: number; id?: string; kind?: "anchor" | "endpoint" };

/**
 * Snap a candidate point onto the nearest anchor/endpoint of a set of paths
 * (§5 "snapping to existing nodes/endpoints"). Returns the original point when
 * nothing is close enough — snapping must never invent a position.
 */
export function snapToTargets(
  candidate: Pt,
  targets: SnapTarget[],
  maxDistance = SNAP_TOLERANCE_DEFAULT,
): { point: Pt; snapped: boolean; target: SnapTarget | null } {
  let best: SnapTarget | null = null;
  let bestDistance = maxDistance;
  for (const target of targets) {
    const d = distance(candidate, target);
    if (d < bestDistance) {
      bestDistance = d;
      best = target;
    }
  }
  return best
    ? { point: { x: best.x, y: best.y }, snapped: true, target: best }
    : { point: pt(candidate), snapped: false, target: null };
}

/** Every anchor of a path as a snap target (used while drawing). */
export function anchorSnapTargets(points: PathPoint[], id?: string): SnapTarget[] {
  return points.map((point, index) => ({ x: point.x, y: point.y, id: id ? `${id}#${index}` : undefined, kind: "anchor" as const }));
}

/**
 * Constrain a segment to a set of angles (§6 "Straight / Constrained" mode and
 * §5 straight-line drawing).
 *
 * `axisLock` wins over angle snapping: if the pointer is within `axisTolerance`
 * of the horizontal or vertical through `from`, the exact axis is used, because
 * that is the constraint the user is actually expressing.
 */
export function constrainToAngle(
  from: Pt,
  to: Pt,
  options: {
    /** Angle increments in degrees (e.g. [45] or [15, 30, 45]). */
    increments?: number[];
    /** How close (degrees) the raw angle must be to a multiple to snap. */
    tolerance?: number;
    axisLock?: boolean;
    /** Distance (px) within which the axis lock engages. */
    axisTolerance?: number;
  } = {},
): { x: number; y: number; angle: number; snapped: boolean; axis: "x" | "y" | null } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const length = Math.hypot(dx, dy);
  const axisTolerance = options.axisTolerance ?? 6;

  if (options.axisLock !== false) {
    if (Math.abs(dy) <= axisTolerance) {
      // Locked onto the horizontal through `from`: the reported angle is the
      // direction actually used, not the raw pointer angle.
      return { x: to.x, y: from.y, angle: dx >= 0 ? 0 : 180, snapped: true, axis: "x" };
    }
    if (Math.abs(dx) <= axisTolerance) {
      return { x: from.x, y: to.y, angle: dy >= 0 ? 90 : -90, snapped: true, axis: "y" };
    }
  }

  const increments = (options.increments ?? []).filter((inc) => Number.isFinite(inc) && inc > 0);
  const tolerance = options.tolerance ?? 4;
  if (increments.length === 0 || length === 0) {
    return { x: to.x, y: to.y, angle: rawAngle, snapped: false, axis: null };
  }

  let bestDelta = Infinity;
  let bestAngle = rawAngle;
  for (const increment of increments) {
    const steps = Math.round(rawAngle / increment);
    const candidate = steps * increment;
    const delta = Math.abs(candidate - rawAngle);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestAngle = candidate;
    }
  }
  if (bestDelta > tolerance) {
    return { x: to.x, y: to.y, angle: rawAngle, snapped: false, axis: null };
  }
  const rad = (bestAngle * Math.PI) / 180;
  return {
    x: from.x + Math.cos(rad) * length,
    y: from.y + Math.sin(rad) * length,
    angle: bestAngle,
    snapped: true,
    axis: null,
  };
}

/**
 * Simplify a path's anchors (RDP) while keeping the shape. Handles are dropped
 * on the surviving anchors and re-fitted, because a simplified anchor set with
 * the old handles would bulge away from the original curve.
 */
export function simplifyPath(points: PathPoint[], epsilon = 6, smooth = true): PathPoint[] {
  if (points.length <= 2) return points.map(clonePoint);
  const reduced = ramerDouglasPeucker(points.map(pt), epsilon);
  const anchors = reduced.map((point) => ({ x: point.x, y: point.y, hIn: null, hOut: null }));
  return smooth ? autoSmoothPoints(anchors, false, 0.28) : anchors;
}

/**
 * Extend an open path with new fitted samples.
 *
 * The samples are attached to whichever END is closer (and reversed when that
 * end is the start), so "continue drawing from the end of this path" works from
 * either side. Returns null when the new samples are not near either end — the
 * caller should then create a separate path instead of teleporting the stroke.
 */
export function extendPath(
  points: PathPoint[],
  samples: PathPoint[],
  tolerance = JOIN_TOLERANCE_DEFAULT,
): PathPoint[] | null {
  if (points.length === 0) return samples.map(clonePoint);
  if (samples.length === 0) return points.map(clonePoint);

  const start = points[0];
  const end = points[points.length - 1];
  const startGap = Math.min(distance(start, samples[0]), distance(start, samples[samples.length - 1]));
  const endGap = Math.min(distance(end, samples[0]), distance(end, samples[samples.length - 1]));

  if (Math.min(startGap, endGap) > tolerance) return null;

  if (endGap <= startGap && distance(end, samples[0]) <= distance(end, samples[samples.length - 1])) {
    return [...points.map(clonePoint), ...samples.slice(1).map(clonePoint)];
  }
  if (endGap <= startGap) {
    return [...points.map(clonePoint), ...reversePoints(samples).slice(1)];
  }
  if (distance(start, samples[samples.length - 1]) <= distance(start, samples[0])) {
    return [...samples.slice(0, -1).map(clonePoint), ...points.map(clonePoint)];
  }
  return [...reversePoints(samples).slice(0, -1), ...points.map(clonePoint)];
}

/**
 * Reshape: replace the anchors between two indices with a fitted sample run.
 * Used by "reshape existing path" (§6) — the untouched part of the path keeps
 * its exact anchors and handles.
 */
export function reshapePath(
  points: PathPoint[],
  fromIndex: number,
  toIndex: number,
  replacement: PathPoint[],
): PathPoint[] | null {
  const lo = Math.max(0, Math.min(fromIndex, toIndex));
  const hi = Math.min(points.length - 1, Math.max(fromIndex, toIndex));
  if (hi <= lo) return null;
  if (replacement.length < 2) return null;
  return [
    ...points.slice(0, lo).map(clonePoint),
    ...replacement.map(clonePoint),
    ...points.slice(hi + 1).map(clonePoint),
  ];
}

/* ------------------------------------------------------------------ */
/* Multi-node editing                                                  */
/* ------------------------------------------------------------------ */

/** Axis-aligned rect in the same space as the points (marquee, drag box). */
export type Rect = { x: number; y: number; width: number; height: number };

/** How many anchors a path must keep to stay drawable (open = line, closed = area). */
export function minimumAnchorCount(closed: boolean): number {
  return closed ? 3 : 2;
}

/**
 * Clean a selection before acting on it: unique, sorted, in range.
 *
 * Every group operation below starts here so a caller can pass whatever the UI
 * collected (duplicate shift-clicks, a stale index after a delete) without the
 * geometry code having to be defensive in five places.
 */
export function normalizeAnchorIndices(count: number, indices: number[]): number[] {
  const seen = new Set<number>();
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Move a GROUP of anchors by one delta.
 *
 * Handles travel with their anchor (the same contract as `moveAnchor`), so a
 * group drag is rigid: the curve *shape* between the moved nodes is preserved
 * and only the nodes' positions change. Anchors outside the group do not move,
 * which is exactly what "stretch this run" means in Figma/Illustrator.
 */
export function moveAnchorsBy(
  points: PathPoint[],
  indices: number[],
  dx: number,
  dy: number,
): PathPoint[] {
  const selected = new Set(normalizeAnchorIndices(points.length, indices));
  if (selected.size === 0 || (dx === 0 && dy === 0)) return points.map(clonePoint);
  return points.map((point, index) => {
    if (!selected.has(index)) return clonePoint(point);
    return {
      x: point.x + dx,
      y: point.y + dy,
      hIn: point.hIn ? { x: point.hIn.x + dx, y: point.hIn.y + dy } : point.hIn ?? null,
      hOut: point.hOut ? { x: point.hOut.x + dx, y: point.hOut.y + dy } : point.hOut ?? null,
    };
  });
}

/**
 * Delete a GROUP of anchors in one pass.
 *
 * Returns `null` when the path would stop being drawable (an open path needs 2
 * anchors, a closed one needs 3) — the caller then leaves the document alone
 * instead of silently destroying the shape. Deleting a node does NOT refit its
 * neighbours: the surviving handles are kept exactly as they were, so removing
 * one node cannot reshape the rest of the path.
 */
export function deleteAnchors(
  points: PathPoint[],
  closed: boolean,
  indices: number[],
): PathPoint[] | null {
  const selected = new Set(normalizeAnchorIndices(points.length, indices));
  if (selected.size === 0) return null;
  if (points.length - selected.size < minimumAnchorCount(closed)) return null;
  return points.filter((_, index) => !selected.has(index)).map(clonePoint);
}

/**
 * Anchor indices whose position falls inside a marquee rect.
 *
 * `tolerance` grows the rect outwards, which is how "touch to select" behaves
 * (a hit target, not a hairline test).
 */
export function anchorsInRect(points: PathPoint[], rect: Rect, tolerance = 0): number[] {
  const left = Math.min(rect.x, rect.x + rect.width) - tolerance;
  const right = Math.max(rect.x, rect.x + rect.width) + tolerance;
  const top = Math.min(rect.y, rect.y + rect.height) - tolerance;
  const bottom = Math.max(rect.y, rect.y + rect.height) + tolerance;
  const found: number[] = [];
  points.forEach((point, index) => {
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return;
    found.push(index);
  });
  return found;
}

/** The marquee rect between two drag corners (works in any drag direction). */
export function rectFromPoints(a: Pt, b: Pt): Rect {
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/**
 * Convert a GROUP of anchors at once (§5 "smooth / corner", Figma's node
 * toolbar). `smooth` derives handles from the neighbours, `corner` drops them.
 *
 * Applied in ascending index order: neither conversion changes the anchor
 * COUNT, so an index stays valid across the whole run.
 */
export function setAnchorTypes(
  points: PathPoint[],
  closed: boolean,
  indices: number[],
  type: "smooth" | "corner",
  tension = 0.28,
): PathPoint[] {
  const selected = normalizeAnchorIndices(points.length, indices);
  if (selected.length === 0) return points.map(clonePoint);
  let next = points.map(clonePoint);
  for (const index of selected) {
    next = type === "smooth"
      ? smoothAnchorAt(next, index, closed, tension)
      : cornerAnchorAt(next, index);
  }
  return next;
}

/** Exact bounding box of a path (re-exported so callers need one import). */
export function pathBounds(points: PathPoint[], closed = false) {
  return pathBBoxExact(points, closed);
}
