/**
 * Parametric Curve tool (§4) — a curve is a *record of parameters*, not a frozen
 * shape. Every parameter stays editable after creation, which is the whole point
 * of the tool: a two-point arc cannot express a 2-cycle sine at 12.5°, and a
 * baked path cannot remember that it was one.
 *
 * Contract (the acceptance criteria in §22 depend on these three rules):
 *   1. `length` is the LOCAL chord span. Changing amplitude / frequency / phase /
 *      symmetry / rotation never touches it.
 *   2. Rotation lives on the LAYER (`layer.angle`) and is a rigid transform, so
 *      rotating a curve cannot change its length either.
 *   3. Everything is generated in the layer's own local space (x from 0 to
 *      `length`), so the result is ordinary editable Bezier anchors — the Pen
 *      tool, the node editor, resize, region detection and export all work on it
 *      with no special casing.
 *
 * Pure: no DOM, no React. Structurally typed against `PathPoint` (declared
 * locally to keep this module import-free and cycle-free).
 */

/**
 * Anything that can be normalized into a spec. `nodes` is widened to `number`
 * here so callers can pass a raw slider/button value without casting it onto
 * the ladder first — `normalizeCurveSpec` snaps it onto a valid rung.
 */
export type CurveSpecInput = Partial<CurveSpec> & { nodes?: number };

/** A cubic anchor. Structurally identical to `domain/path.ts` PathPoint. */
export type CurveAnchor = {
  x: number;
  y: number;
  hIn: { x: number; y: number } | null;
  hOut: { x: number; y: number } | null;
};

/**
 * Curve families. `custom` means "no parametric waveform — the anchors are the
 * geometry" (what `Convert to Path` produces, and what an imported Bezier is).
 */
export type CurveKind = "arc" | "sine" | "sine-asymmetric" | "s" | "wave" | "custom";

export const CURVE_KIND_LABELS: Record<CurveKind, string> = {
  arc: "کمان",
  sine: "سینوسی",
  "sine-asymmetric": "سینوسی نامتقارن",
  s: "موج S",
  wave: "موج",
  custom: "بِزیه آزاد",
};

export type CurveSpec = {
  kind: CurveKind;
  /** Chord span in design px. INVARIANT under every other parameter. */
  length: number;
  /** Peak offset from the chord in design px (>= 0). */
  amplitude: number;
  /** Wave cycles across the length. */
  frequency: number;
  /** Phase in degrees. */
  phase: number;
  /** Monotone time remap: 0.5 = symmetric; < 0.5 moves the peaks earlier. */
  symmetry: number;
  /** Free-end tangent in degrees measured from the chord; null = natural. */
  startTangent: number | null;
  /** Same, at the far end. */
  endTangent: number | null;
  /**
   * DIRECTION OF THE CHORD in layer-local space, in degrees. 0 = the classic
   * horizontal curve.
   *
   * This is what makes "drag an endpoint anywhere" a PARAMETRIC edit instead of
   * a destructive one: moving an endpoint changes the chord (length + direction),
   * so both are recorded here and the waveform is regenerated along the new
   * chord — amplitude, frequency, phase, symmetry and tangents all survive, and
   * the spec still describes the anchors that are on screen.
   *
   * It is deliberately separate from `layer.angle`: the layer angle is a rigid
   * transform applied by the renderer, while the chord angle is a property of
   * the curve's own geometry (and therefore of the node coordinates the user
   * drags).
   */
  chordAngle: number;
  /** Mirror the waveform along the chord (the Reverse action). */
  reversed: boolean;
  /**
   * EDITABLE NODE COUNT. How many anchors the waveform is generated into — i.e.
   * how many nodes the user can select, drag, delete, smooth/corner.
   *
   * This is the ONLY knob that changes anchor density. There is no separate
   * "render samples" field in the document on purpose: geometry and editing are
   * the same list of anchors, so they can never disagree.
   */
  nodes: CurveNodeCount;
};

export const CURVE_LIMITS = {
  length: { min: 10, max: 20000 },
  amplitude: { min: 0, max: 5000 },
  frequency: { min: 0.25, max: 24 },
  phase: { min: -360, max: 360 },
  symmetry: { min: 0.05, max: 0.95 },
  tangent: { min: -360, max: 360 },
  chordAngle: { min: -360, max: 360 },
} as const;

/**
 * EDITABLE NODE COUNT — how many nodes the user sees and drags.
 *
 * Deliberately a small, discrete ladder: these are the granularities a designer
 * actually asks for, and a discrete list keeps the inspector a row of buttons
 * instead of a slider with a meaningless in-between (4.5 nodes?).
 *
 * The cap is 16, far below MAX_PATH_POINTS (500), so a node-count change can
 * never push a layer over the server's per-path anchor limit.
 */
export const CURVE_NODE_COUNTS = [3, 5, 7, 9, 12, 16] as const;
export type CurveNodeCount = (typeof CURVE_NODE_COUNTS)[number];
export const CURVE_NODE_COUNT_DEFAULT: CurveNodeCount = 9;
export const CURVE_NODE_COUNT_MIN = 3;
export const CURVE_NODE_COUNT_MAX = 16;

export const DEFAULT_CURVE_SPEC: CurveSpec = {
  kind: "sine",
  length: 600,
  amplitude: 80,
  frequency: 1,
  phase: 0,
  symmetry: 0.5,
  startTangent: null,
  endTangent: null,
  chordAngle: 0,
  reversed: false,
  nodes: CURVE_NODE_COUNT_DEFAULT,
};

/**
 * Default node count for a freshly created profile. Arc starts coarse (it is a
 * single arch — three nodes is the honest description of it) and the waves
 * start at the ladder's middle rung.
 */
export function defaultNodeCountFor(kind: CurveKind): CurveNodeCount {
  return kind === "arc" ? 3 : CURVE_NODE_COUNT_DEFAULT;
}

/**
 * Anchors generated per curve. Bounded well under MAX_PATH_POINTS (500).
 *
 * NOTE: this is the RENDER/SAMPLE resolution — the density at which a waveform
 * is evaluated. It is NOT the number of nodes the user edits; that is
 * `spec.nodes` (see CURVE_NODE_COUNTS below). Conflating the two is exactly the
 * bug this module now guards against: changing render quality must never change
 * the editing model, and changing the node count must never be invisible.
 */
export const CURVE_SAMPLE_COUNT = 17;

/**
 * Clamp any requested node count onto the supported ladder. Snapping to the
 * nearest rung (rather than rejecting) means a stored 6 becomes 5 or 7 instead
 * of breaking the layer.
 */
export function normalizeNodeCount(value: unknown): CurveNodeCount {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : CURVE_NODE_COUNT_DEFAULT;
  let best: CurveNodeCount = CURVE_NODE_COUNTS[0];
  let bestDelta = Infinity;
  for (const candidate of CURVE_NODE_COUNTS) {
    const delta = Math.abs(candidate - n);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

/**
 * Node count that fits a node-count CHANGE: if the user asked for the same
 * value twice in a row (or a value that snaps back onto the current one) the
 * request is a no-op, which callers can detect with a strict equality check.
 */
export function resolveNodeCount(current: unknown, requested: unknown): CurveNodeCount {
  const next = normalizeNodeCount(requested);
  const now = normalizeNodeCount(current);
  return next === now ? now : next;
}

export const CURVE_KINDS: CurveKind[] = ["arc", "sine", "sine-asymmetric", "s", "wave", "custom"];

/**
 * The four curve families the UI exposes, in canonical order, with their
 * Persian labels. ONE table — the toolbox picker and the profile grid both read
 * it, so a new family can never be added to one and forgotten in the other.
 */
export const CURVE_PROFILES: { kind: CurveKind; label: string; glyph: string }[] = [
  { kind: "arc", label: "قوس", glyph: "⌒" },
  { kind: "sine", label: "سینوسی متقارن", glyph: "〰" },
  { kind: "sine-asymmetric", label: "سینوسی نامتقارن", glyph: "∿" },
  { kind: "s", label: "موج S", glyph: "S" },
];

/**
 * The LEGACY `curveProfile` values of documents saved by older builds, mapped
 * onto the canonical `CurveKind`. Migration happens once, at load
 * (`factory.parseDocument`), and the legacy field is then dropped — so there is
 * exactly one profile vocabulary in the live document.
 *
 * `custom` is the honest target for `sine-asymmetric`: that legacy profile was
 * generated by a harmonic blend the parametric model does not reproduce, so
 * declaring it "sine" would silently REDRAW the user's saved curve.
 */
export const LEGACY_CURVE_PROFILE_KINDS: Record<string, CurveKind> = {
  arc: "arc",
  sine: "sine",
  "sine-asymmetric": "custom",
  s: "s",
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Coerce any (possibly stored/legacy/partial) object into a valid spec. */
export function normalizeCurveSpec(input: CurveSpecInput | null | undefined): CurveSpec {
  const raw = input ?? {};
  const kind: CurveKind = CURVE_KINDS.includes(raw.kind as CurveKind)
    ? (raw.kind as CurveKind)
    : DEFAULT_CURVE_SPEC.kind;
  const tangent = (value: unknown): number | null =>
    value === null || value === undefined || !Number.isFinite(value as number)
      ? null
      : clamp(
          value as number,
          CURVE_LIMITS.tangent.min,
          CURVE_LIMITS.tangent.max,
          0,
        );
  return {
    kind,
    length: clamp(finiteOr(raw.length, DEFAULT_CURVE_SPEC.length), CURVE_LIMITS.length.min, CURVE_LIMITS.length.max, DEFAULT_CURVE_SPEC.length),
    amplitude: clamp(finiteOr(raw.amplitude, DEFAULT_CURVE_SPEC.amplitude), CURVE_LIMITS.amplitude.min, CURVE_LIMITS.amplitude.max, DEFAULT_CURVE_SPEC.amplitude),
    frequency: clamp(finiteOr(raw.frequency, DEFAULT_CURVE_SPEC.frequency), CURVE_LIMITS.frequency.min, CURVE_LIMITS.frequency.max, DEFAULT_CURVE_SPEC.frequency),
    phase: clamp(finiteOr(raw.phase, DEFAULT_CURVE_SPEC.phase), CURVE_LIMITS.phase.min, CURVE_LIMITS.phase.max, DEFAULT_CURVE_SPEC.phase),
    symmetry: clamp(finiteOr(raw.symmetry, DEFAULT_CURVE_SPEC.symmetry), CURVE_LIMITS.symmetry.min, CURVE_LIMITS.symmetry.max, DEFAULT_CURVE_SPEC.symmetry),
    startTangent: tangent(raw.startTangent),
    endTangent: tangent(raw.endTangent),
    chordAngle: clamp(
      finiteOr(raw.chordAngle, DEFAULT_CURVE_SPEC.chordAngle),
      CURVE_LIMITS.chordAngle.min,
      CURVE_LIMITS.chordAngle.max,
      DEFAULT_CURVE_SPEC.chordAngle,
    ),
    reversed: raw.reversed === true,
    nodes: normalizeNodeCount(raw.nodes),
  };
}

/**
 * The symmetry control as a monotone time remap. k = 1 at symmetry 0.5 (identity
 * → a symmetric wave), k > 1 compresses the early part (peaks move later).
 * `t^k` keeps 0 → 0 and 1 → 1, so the chord endpoints never move.
 */
export function curveTimeRemap(symmetry: number): number {
  const k = Math.pow(2, (0.5 - clamp(finiteOr(symmetry, 0.5), 0, 1, 0.5)) * 2);
  return clamp(k, 0.25, 4, 1);
}

/**
 * The waveform as a local Y offset (SVG y-down: negative = visually up).
 * `t` is the NORMALIZED position along the chord (already remapped/reversed).
 */
export function curveWave(spec: CurveSpec, t: number): number {
  const amp = Math.max(0, spec.amplitude);
  const f = Math.max(CURVE_LIMITS.frequency.min, spec.frequency);
  const ph = (spec.phase * Math.PI) / 180;
  switch (spec.kind) {
    case "arc":
      // A single arch, level at both ends.
      return -amp * Math.sin(Math.PI * t);
    case "s":
      // A true S: enters and leaves the baseline horizontally, one inflection.
      return -amp * Math.cos(Math.PI * t);
    case "wave":
      // Repeated arches on ONE side (scalloped decorative wave).
      return -amp * Math.abs(Math.sin(Math.PI * f * t + ph / 2));
    case "sine-asymmetric":
      // Harmonic blend: the rise profile is deliberately not mirrored.
      return (
        -amp *
        (0.72 * Math.sin(2 * Math.PI * f * t + ph) + 0.28 * Math.sin(4 * Math.PI * f * t + 2 * ph + 0.65))
      );
    case "sine":
    case "custom":
    default:
      return -amp * Math.sin(2 * Math.PI * f * t + ph);
  }
}

/** Local position of the curve at `t` ∈ [0, 1] (before handle fitting). */
export function curvePointAt(spec: CurveSpec, t: number): { x: number; y: number } {
  const clamped = clamp(t, 0, 1, 0);
  const u = spec.reversed ? 1 - clamped : clamped;
  const remapped = Math.pow(u, curveTimeRemap(spec.symmetry));
  return { x: clamped * spec.length, y: curveWave(spec, remapped) };
}

/** Unit vector for an angle in degrees (local space, y-down like the artboard). */
function dirFromAngle(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/**
 * Generate the editable anchors for a spec.
 *
 * Handles come from a Catmull-Rom tangent fit, then the requested free-end
 * tangent angles (if any) override the two outer handles. That keeps the middle
 * of the wave parametric while still exposing a real, honest tangent control.
 *
 * `custom` has no waveform — it returns an empty list, and the layer's own
 * anchors are the geometry.
 */
export function curveAnchors(specInput: CurveSpecInput, sampleCount?: number): CurveAnchor[] {
  const spec = normalizeCurveSpec(specInput);
  if (spec.kind === "custom") return [];

  // Explicit sampleCount = the render-resolution path (callers that need a
  // specific density, e.g. export). Otherwise the geometry IS the editable node
  // list, so `spec.nodes` is the density — one list, no shadow copy.
  const count = Math.max(3, Math.min(64, Math.round(sampleCount ?? spec.nodes)));
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    raw.push(curvePointAt(spec, i / (count - 1)));
  }

  const points: CurveAnchor[] = raw.map((p) => ({ x: p.x, y: p.y, hIn: null, hOut: null }));

  // Catmull-Rom tangents (one-sided at the ends) → cubic handles.
  const tension = 1 / 3;
  for (let i = 0; i < points.length; i += 1) {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const tx = (next.x - prev.x) / 2;
    const ty = (next.y - prev.y) / 2;
    const tan = { x: tx * tension, y: ty * tension };
    if (i > 0) points[i].hIn = { x: raw[i].x - tan.x, y: raw[i].y - tan.y };
    if (i < raw.length - 1) points[i].hOut = { x: raw[i].x + tan.x, y: raw[i].y + tan.y };
  }

  // Free-end tangent angles. The handle keeps the natural length so the change
  // is a pure direction edit — it can never explode the geometry.
  const applyEnd = (index: number, handle: "hOut" | "hIn", deg: number | null) => {
    if (deg === null) return;
    const anchor = points[index];
    const neighbour = index === 0 ? points[1] : points[points.length - 2];
    const span = Math.hypot(neighbour.x - anchor.x, neighbour.y - anchor.y) || spec.length / (count - 1);
    const length = Math.max(1, span * tension * 2);
    const dir = dirFromAngle(deg);
    const target = { x: anchor.x + dir.x * length, y: anchor.y + dir.y * length };
    anchor[handle] = handle === "hOut" ? target : { x: 2 * anchor.x - target.x, y: 2 * anchor.y - target.y };
  };
  // NOTE: the two tangent parameters are ABSOLUTE properties of the drawn curve
  // ("the tangent at the start", "the tangent at the end"), so reversing the
  // curve swaps which one applies where — see `reverseCurveSpec`. No extra
  // mirroring is needed here, and the parameters can never disagree with the
  // geometry the user sees.
  if (points.length >= 2) {
    applyEnd(0, "hOut", spec.startTangent);
    applyEnd(points.length - 1, "hIn", spec.endTangent);
  }

  return rotateAnchors(points, spec.chordAngle);
}

/**
 * Rotate a generated curve onto its chord direction. Rotation is about the
 * chord START, which is the origin of the generator's local space — so the
 * first anchor is a fixed point and the far end swings to `chordAngle`.
 */
function rotateAnchors(points: CurveAnchor[], degrees: number): CurveAnchor[] {
  if (!Number.isFinite(degrees) || degrees === 0) return points;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const turn = (p: { x: number; y: number }) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  return points.map((point) => {
    const anchor = turn(point);
    return {
      x: anchor.x,
      y: anchor.y,
      hIn: point.hIn ? turn(point.hIn) : null,
      hOut: point.hOut ? turn(point.hOut) : null,
    };
  });
}

/** Total length of the polyline through the anchors (measures the drawn curve). */
export function polylineLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * The chord as measured from generated geometry: FIRST anchor → LAST anchor.
 * This is the number the "Length" inspector shows, and it must stay at
 * `spec.length` for every waveform whose ends sit on the baseline.
 */
export function curveChordLength(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y);
}

/** Horizontal span of the generated curve — equals `spec.length` by construction. */
export function curveSpanX(points: { x: number; y: number }[]): number {
  if (points.length === 0) return 0;
  const xs = points.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

/** Local bounding box of the generated curve (anchors + handles). */
export function curveBounds(points: CurveAnchor[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    for (const candidate of [point, point.hIn, point.hOut]) {
      if (!candidate) continue;
      if (candidate.x < minX) minX = candidate.x;
      if (candidate.x > maxX) maxX = candidate.x;
      if (candidate.y < minY) minY = candidate.y;
      if (candidate.y > maxY) maxY = candidate.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Reverse. Flipping the parameter along the chord is a pure spec operation, so
 * the curve keeps every other parameter — and reversing twice is the identity.
 * The free-end tangents swap ends and rotate by 180°, because the direction of
 * travel at that end is now the opposite one.
 */
export function reverseCurveSpec(specInput: CurveSpecInput): CurveSpec {
  const spec = normalizeCurveSpec(specInput);
  return {
    ...spec,
    reversed: !spec.reversed,
    startTangent: spec.endTangent === null ? null : normalizeAngle(endTangentAfterReverse(spec.endTangent)),
    endTangent: spec.startTangent === null ? null : normalizeAngle(endTangentAfterReverse(spec.startTangent)),
  };
}

/** A tangent measured while travelling the other way is the same line, +180°. */
function endTangentAfterReverse(deg: number): number {
  return deg + 180;
}

function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  // `Object.is` is the only way to spot a NEGATIVE zero (a === 0 matches both).
  return Object.is(a, -0) ? 0 : a;
}

/**
 * Convert to Path (§4): freeze the parameters and hand back plain anchors.
 * The result is ordinary Bezier geometry — no spec, no special rendering path.
 */
export function bakeCurve(specInput: CurveSpecInput, sampleCount?: number): CurveAnchor[] {
  return curveAnchors(specInput, sampleCount).map((point) => ({
    x: point.x,
    y: point.y,
    hIn: point.hIn ? { x: point.hIn.x, y: point.hIn.y } : null,
    hOut: point.hOut ? { x: point.hOut.x, y: point.hOut.y } : null,
  }));
}
