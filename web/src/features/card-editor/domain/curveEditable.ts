/**
 * curveEditable — the bridge between a parametric `CurveSpec` and the editable
 * Bézier anchors it was generated into.
 *
 * THE CANONICAL RULE THIS MODULE IMPLEMENTS
 * -----------------------------------------
 * A curve layer holds exactly ONE geometry: `layer.points`. The `curve` spec is
 * a RECORD that EXPLAINS those anchors while they still match it. The moment a
 * direct edit makes them disagree, the spec stops being a truthful description
 * and the engine FREEZES it away (drops the field) — so the document can never
 * claim "amplitude 80" while the curve on screen says something else.
 *
 * That gives exactly two modes, and no third:
 *   - PARAMETRIC: anchors still match the spec → inspector edits re-derive them.
 *   - EDITABLE:   anchors are the geometry   → spec frozen, nodes/handles are
 *                 the source of truth (and the inspector can re-parametrize by
 *                 choosing a profile again, which creates a fresh spec).
 *
 * Two operations support that, and only two:
 *   1. `resampleCurveNodes`      — change the EDITABLE NODE COUNT by
 *                                  redistributing nodes along the existing
 *                                  drawn geometry (arc length, not index).
 *   2. `curveSpecMatchesGeometry` — the coherence test that decides the mode.
 *
 * Pure: no DOM, no React, no engine import.
 */

import {
  curveAnchors,
  curveWave,
  normalizeCurveSpec,
  normalizeNodeCount,
  type CurveSpec,
  type CurveSpecInput,
} from "./curveGeometry";
import { cubicAt, segmentCubics } from "./path";
import type { PathPoint } from "./document";

/** Samples per generated segment used by the arc-length table. */
const SEGMENT_SAMPLES = 16;
/** Design-px drift allowed before the anchors stop matching the spec. */
const ANCHOR_EPSILON = 0.01;
/** Handle drift allowed — a free-end tangent edit legitimately moves handles. */
const HANDLE_EPSILON = 0.05;

type Pt = { x: number; y: number };

/* ------------------------------------------------------------------ */
/* Mode detection                                                      */
/* ------------------------------------------------------------------ */

/**
 * Is `points` still exactly the geometry this spec generates?
 *
 * True  → parametric mode: parameter edits re-derive the anchors.
 * False → editable mode: the anchors ARE the geometry.
 *
 * The comparison is up to a TRANSLATION on purpose. A stored layer's anchors
 * are re-origined by `normalizePathLayer` (the box starts at its stroke padding)
 * while the generator always starts the chord at local (0,0). The shape is what
 * the spec describes, not where the box happens to sit — so moving or resizing
 * the layer must NOT be mistaken for a geometry edit, while dragging a single
 * node (which changes relative geometry) must be.
 *
 * The node count is part of the test: a 5-node arc is NOT the 3-node arc the
 * spec would regenerate, so a later parameter edit would silently throw the
 * user's extra nodes away. Requiring a match is what makes that impossible.
 */
export function curveSpecMatchesGeometry(specInput: CurveSpecInput, points: PathPoint[]): boolean {
  const spec = normalizeCurveSpec(specInput);
  if (spec.kind === "custom") return false;
  const expected = curveAnchors(spec);
  if (expected.length !== points.length || points.length === 0) return false;

  const dx = points[0].x - expected[0].x;
  const dy = points[0].y - expected[0].y;
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i];
    const have = points[i];
    if (Math.abs(want.x + dx - have.x) > ANCHOR_EPSILON || Math.abs(want.y + dy - have.y) > ANCHOR_EPSILON) return false;
    if (!handlesMatch(shift(want.hIn, dx, dy), have.hIn)) return false;
    if (!handlesMatch(shift(want.hOut, dx, dy), have.hOut)) return false;
  }
  return true;
}

function shift(point: { x: number; y: number } | null | undefined, dx: number, dy: number) {
  if (!point) return null;
  return { x: point.x + dx, y: point.y + dy };
}

function handlesMatch(
  a: { x: number; y: number } | null | undefined,
  b: { x: number; y: number } | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= HANDLE_EPSILON;
}

/* ------------------------------------------------------------------ */
/* Arc-length machinery                                                */
/* ------------------------------------------------------------------ */

type Sample = Pt & { d: number };

/** Dense samples along the drawn curve with a running arc length. */
function lengthSamples(points: PathPoint[], closed: boolean): Sample[] {
  const first = points[0];
  if (!first) return [];
  const samples: Sample[] = [{ x: first.x, y: first.y, d: 0 }];
  if (points.length === 1) return samples;

  let travelled = 0;
  let previous: Pt = { x: first.x, y: first.y };
  for (const segment of segmentCubics(points, closed)) {
    for (let step = 1; step <= SEGMENT_SAMPLES; step += 1) {
      const at = cubicAt(segment.p0, segment.c1, segment.c2, segment.p1, step / SEGMENT_SAMPLES);
      travelled += Math.hypot(at.x - previous.x, at.y - previous.y);
      previous = at;
      samples.push({ x: at.x, y: at.y, d: travelled });
    }
  }
  return samples;
}

/** Total arc length of the drawn curve. */
export function curveArcLength(points: PathPoint[], closed = false): number {
  const samples = lengthSamples(points, closed);
  return samples.length > 0 ? samples[samples.length - 1].d : 0;
}

/** The point at a given arc length. */
function pointAtLength(samples: Sample[], target: number): Pt {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (target <= 0) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (target >= last.d) return { x: last.x, y: last.y };
  for (let i = 1; i < samples.length; i += 1) {
    const after = samples[i];
    if (after.d >= target) {
      const before = samples[i - 1];
      const span = after.d - before.d;
      const t = span > 0 ? (target - before.d) / span : 0;
      return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
    }
  }
  return { x: last.x, y: last.y };
}

/* ------------------------------------------------------------------ */
/* Editable node count                                                 */
/* ------------------------------------------------------------------ */

/**
 * REDISTRIBUTE the editable nodes along the existing curve.
 *
 * This is the operation behind "Node Count", and it is deliberately a pure
 * GEOMETRY operation: it never reads the spec's parameters, so it cannot reset
 * amplitude, frequency, phase or symmetry — the caller keeps the spec and only
 * swaps `spec.nodes`.
 *
 * Why it feels like a vector editor rather than a filter:
 *   - the FIRST and LAST anchors are copied verbatim, so endpoints never move;
 *   - interior nodes sit at equal ARC-LENGTH intervals, so a wave with steep
 *     flanks does not bunch its nodes in the flat parts;
 *   - each new node gets Catmull-Rom handles from the LOCAL tangent, scaled to
 *     the local spacing, so raising the count refines the SAME shape instead of
 *     producing a lumpy approximation of it;
 *   - a degenerate (duplicate) sample leaves a corner rather than inventing a
 *     direction the curve does not have.
 *
 * Open and closed paths are both supported; `count` is clamped to the drawable
 * minimum so a resample can never produce an uneditable layer.
 */
export function resampleCurveNodes(points: PathPoint[], count: number, closed = false): PathPoint[] {
  const target = Math.max(closed ? 3 : 2, Math.round(count));
  if (points.length < 2 || target < 2) return points.map((point) => ({ ...point, hIn: point.hIn ? { ...point.hIn } : point.hIn ?? null, hOut: point.hOut ? { ...point.hOut } : point.hOut ?? null }));

  const samples = lengthSamples(points, closed);
  const total = samples.length > 0 ? samples[samples.length - 1].d : 0;
  if (!(total > 0)) return points.map((point) => ({ ...point }));

  // Positions on the curve: a closed path walks the whole loop (t = i/count),
  // an open one keeps both endpoints (t = i/(count-1)).
  const positions: Pt[] = [];
  for (let i = 0; i < target; i += 1) {
    const t = closed ? i / target : i / (target - 1);
    positions.push(pointAtLength(samples, total * t));
  }

  const spacing = total / (closed ? target : Math.max(1, target - 1));
  const delta = Math.max(0.5, spacing * 0.5);
  const reach = spacing / 3;

  const anchors: PathPoint[] = positions.map((position, index) => {
    const here = closed ? total * (index / target) : total * (index / (target - 1));
    const before = pointAtLength(samples, here - delta);
    const after = pointAtLength(samples, here + delta);
    const tangent = { x: after.x - before.x, y: after.y - before.y };
    const magnitude = Math.hypot(tangent.x, tangent.y);
    const hasIn = closed || index > 0;
    const hasOut = closed || index < target - 1;
    if (!(magnitude > 1e-6)) {
      // Degenerate tangent — keep an honest corner instead of a fake direction.
      return { x: position.x, y: position.y, hIn: null, hOut: null };
    }
    const unit = { x: tangent.x / magnitude, y: tangent.y / magnitude };
    return {
      x: position.x,
      y: position.y,
      hIn: hasIn ? { x: position.x - unit.x * reach, y: position.y - unit.y * reach } : null,
      hOut: hasOut ? { x: position.x + unit.x * reach, y: position.y + unit.y * reach } : null,
    };
  });

  // Endpoints are the contract: copy them verbatim from the source geometry.
  if (!closed && anchors.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    anchors[0] = { ...anchors[0], x: first.x, y: first.y };
    anchors[anchors.length - 1] = { ...anchors[anchors.length - 1], x: last.x, y: last.y };
  }
  return anchors;
}

/**
 * Place freshly generated anchors into a layer's OWN local frame.
 *
 * The generator always starts the chord at local (0,0), but a stored layer's
 * geometry is re-origined by `normalizePathLayer` (its box starts at the stroke
 * padding), so the chord start sits somewhere like (5, 111.7). Regenerating
 * without this step teleports the whole curve — measured, it walked 5px per
 * change and left the artboard after a few node-count clicks.
 *
 * Translating the new geometry so its chord start lands on `origin` keeps the
 * curve exactly where the user had it, and lets `normalizePathLayer` do its real
 * job (re-derive the box) without moving anything in world space.
 */
export function placeCurveAnchors(anchors: PathPoint[], origin: Pt): PathPoint[] {
  const first = anchors[0];
  if (!first) return anchors;
  const dx = origin.x - first.x;
  const dy = origin.y - first.y;
  if (dx === 0 && dy === 0) return anchors;
  return anchors.map((point) => ({
    x: point.x + dx,
    y: point.y + dy,
    hIn: point.hIn ? { x: point.hIn.x + dx, y: point.hIn.y + dy } : null,
    hOut: point.hOut ? { x: point.hOut.x + dx, y: point.hOut.y + dy } : null,
  }));
}

/**
 * Regenerate a parametric curve's anchors WITHOUT moving it: the generated
 * geometry is placed at the current chord start, so a parameter or node-count
 * change only changes the shape, never the position.
 */
export function regenerateCurveAnchors(specInput: CurveSpecInput, currentPoints: PathPoint[]): PathPoint[] {
  const anchors = curveAnchors(specInput);
  const origin = currentPoints[0];
  if (!origin) return anchors;
  return placeCurveAnchors(anchors, { x: origin.x, y: origin.y });
}

/**
 * Apply a node-count change to a PARAMETRIC curve and report the anchors+spec to
 * store together.
 *
 * Two paths, chosen for correctness rather than convenience:
 *   - anchors still match the spec (the normal case: only the inspector was
 *     used) → REGENERATE from the same parameters at the new density. Exact, and
 *     every parameter is preserved by construction.
 *   - anchors no longer match (a node was already dragged) → the spec has been
 *     frozen by the engine, so the caller uses `resampleCurveNodes` directly.
 *     This branch is a safety net for a stale spec.
 */
export function applyNodeCount(
  specInput: CurveSpecInput,
  points: PathPoint[],
  requested: number,
  closed = false,
): { spec: CurveSpec; points: PathPoint[] } {
  const spec = normalizeCurveSpec(specInput);
  const nodes = normalizeNodeCount(requested);
  const next: CurveSpec = { ...spec, nodes };
  if (spec.kind === "custom" || !curveSpecMatchesGeometry(spec, points)) {
    return { spec: next, points: resampleCurveNodes(points, nodes, closed) };
  }
  return { spec: next, points: regenerateCurveAnchors(next, points) };
}

/* ------------------------------------------------------------------ */
/* Parametric endpoint drag                                            */
/* ------------------------------------------------------------------ */

/**
 * Move ONE endpoint of a parametric curve.
 *
 * Dragging the first or last anchor is a geometric edit the parametric model can
 * actually express: the CHORD moved. The honest translation is a new chord
 * length PLUS a new chord direction (`spec.chordAngle`) — every other parameter
 * (amplitude, frequency, phase, symmetry, tangents) survives untouched, and the
 * curve keeps its own shape while following the dragged endpoint.
 *
 * Because the direction lives in the spec, `curveSpecMatchesGeometry` stays TRUE
 * after the drag: the anchors on screen are still exactly what the spec
 * generates, so the inspector parameters remain live. That is the whole point of
 * putting the chord angle in the model instead of folding it into the layer
 * angle (which would have fought the overlay's own rotation math and left the
 * dragged node drifting away from the pointer).
 *
 * Interior nodes and handles have no parametric equivalent, so they return
 * `null` and the caller freezes the spec (editable mode).
 */
export function curveEndpointEdit(
  specInput: CurveSpecInput,
  points: PathPoint[],
  index: number,
  position: Pt,
): { spec: CurveSpec; points: PathPoint[] } | null {
  if (points.length < 2) return null;
  if (index !== 0 && index !== points.length - 1) return null;
  const spec = normalizeCurveSpec(specInput);
  if (spec.kind === "custom") return null;

  const start = index === 0 ? position : points[0];
  const end = index === points.length - 1 ? position : points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const targetLength = Math.hypot(dx, dy);
  if (!(targetLength > 1)) return null;

  // Where the waveform actually puts its two END anchors. For `sine`, `arc` and
  // `wave` they sit on the baseline (offset 0) and this is a plain chord edit.
  // For the S-wave they are +amp / −amp, so the line between the two visible
  // endpoints is NOT the chord — and rotating about the local origin would leave
  // the dragged node short of the pointer by exactly that offset. Solving for
  // the rotation that maps the offset onto the pointer is what makes the drag
  // land on the cursor for EVERY profile.
  const offset = curveEndOffset(spec);
  // The chord length absorbs the rest of the pointer distance: the end anchor
  // ends up exactly `targetLength` away from the start. Solved in one step, so
  // there is no iteration and no drift.
  const length = Math.sqrt(Math.max(1, targetLength * targetLength - offset.y * offset.y));
  // The offset angle is measured against the NEW length — using the previous
  // length here left the S-wave short of the pointer by a few pixels.
  const offsetAngle = Math.atan2(offset.y, length);
  const chordAngle = ((Math.atan2(dy, dx) - offsetAngle) * 180) / Math.PI;
  const next: CurveSpec = { ...spec, length, chordAngle };
  // The chord start the user is working with becomes the origin of the
  // regenerated geometry, so the curve follows the dragged endpoint instead of
  // teleporting back to local (0,0).
  return { spec: next, points: placeCurveAnchors(curveAnchors(next), start) };
}

/**
 * The vertical distance between the two END anchors of a waveform, in local
 * units. Zero for the profiles that start and end on the baseline; ±2·amplitude
 * for the S-wave (which enters low and leaves high by definition).
 */
function curveEndOffset(spec: CurveSpec): { x: number; y: number } {
  const first = curveWave(spec, spec.reversed ? 1 : 0);
  const last = curveWave(spec, spec.reversed ? 0 : 1);
  return { x: spec.length, y: last - first };
}

/** The end-anchor offset of a spec, exposed for tests and callers that need it. */
export function curveEndAnchorOffset(specInput: CurveSpecInput): number {
  return curveEndOffset(normalizeCurveSpec(specInput)).y;
}
