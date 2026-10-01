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
  /** Mirror the waveform along the chord (the Reverse action). */
  reversed: boolean;
};

export const CURVE_LIMITS = {
  length: { min: 10, max: 20000 },
  amplitude: { min: 0, max: 5000 },
  frequency: { min: 0.25, max: 24 },
  phase: { min: -360, max: 360 },
  symmetry: { min: 0.05, max: 0.95 },
  tangent: { min: -360, max: 360 },
} as const;

export const DEFAULT_CURVE_SPEC: CurveSpec = {
  kind: "sine",
  length: 600,
  amplitude: 80,
  frequency: 1,
  phase: 0,
  symmetry: 0.5,
  startTangent: null,
  endTangent: null,
  reversed: false,
};

/** Anchors generated per curve. Bounded well under MAX_PATH_POINTS (500). */
export const CURVE_SAMPLE_COUNT = 17;

export const CURVE_KINDS: CurveKind[] = ["arc", "sine", "sine-asymmetric", "s", "wave", "custom"];

function clamp(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Coerce any (possibly stored/legacy/partial) object into a valid spec. */
export function normalizeCurveSpec(input: Partial<CurveSpec> | null | undefined): CurveSpec {
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
    reversed: raw.reversed === true,
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
export function curveAnchors(specInput: Partial<CurveSpec>, sampleCount = CURVE_SAMPLE_COUNT): CurveAnchor[] {
  const spec = normalizeCurveSpec(specInput);
  if (spec.kind === "custom") return [];

  const count = Math.max(3, Math.min(64, Math.round(sampleCount)));
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

  return points;
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
export function reverseCurveSpec(specInput: Partial<CurveSpec>): CurveSpec {
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
export function bakeCurve(specInput: Partial<CurveSpec>, sampleCount = CURVE_SAMPLE_COUNT): CurveAnchor[] {
  return curveAnchors(specInput, sampleCount).map((point) => ({
    x: point.x,
    y: point.y,
    hIn: point.hIn ? { x: point.hIn.x, y: point.hIn.y } : null,
    hOut: point.hOut ? { x: point.hOut.x, y: point.hOut.y } : null,
  }));
}
