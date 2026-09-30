/**
 * Save budget / validator limits — the frontend mirror of the server's
 * CardDesignValidator (and the tier policy that governs HOW a document
 * exceeding its budget is treated).
 *
 * Why this module exists: the validator REBUILDS every layer from a
 * whitelist and enforces hard caps (document bytes, layer count, path
 * points, rawD size). A document the frontend allows but the server caps
 * would 422 at save time ("بخشی از طرح ذخیره نشد"). The editor therefore
 * audits every document against the SAME numbers BEFORE a save request is
 * built — the chain Document → payload → validation → persistence can
 * never be surprised.
 *
 * TIER POLICY (product decision, encoded here, driven by entitlements):
 *   - unlimited tiers (max_layers === null / undefined): the budget is
 *     RAISED, not simplified — a Professional stroke is NEVER auto-decimated
 *     behind the user's back. Exceeding the raised budget only WARNS.
 *   - capped tiers (Free/Starter): first OPTIMIZE (lossless Q→C + gentle
 *     resample), and only warn when even the optimized geometry cannot fit
 *     — never truncate.
 *
 * Pure: no DOM, no React, no network. Tests run in Node.
 */

/** Structural caps — MUST mirror api/app/Services/CardDesignValidator.php. */
export const MAX_DOC_BYTES = 100_000; // validator MAX_BYTES (mirrored default budget)
export const STRUCTURAL_MAX_LAYERS = 120; // validator MAX_LAYERS (raised from 60: it is a SECURITY cap, not a plan quota)
export const MAX_PATH_POINTS = 500; // per-path anchor cap
export const MAX_RAW_D_STRUCTURAL = 60_000; // validator MAX_RAW_D, raised from 20KB with the Q→C expansion in mind

/** Per-tier effective budget. */
export type SaveBudget = {
  /** Effective max serialized rawD per path layer. */
  rawDBytes: number;
  /** Effective max anchors per path layer. */
  pathPoints: number;
  /** Effective max total serialized document bytes. */
  docBytes: number;
  /** Effective max layers. */
  layers: number;
  /** True when the governing tier is unlimited (no auto-simplify). */
  unlimited: boolean;
};

/**
 * The budget for one tier. `unlimited` is read from the ENTITLEMENT, never
 * from a plan name: `max_layers === null` is the canonical "no real cap"
 * signal (FeatureGate::limit returns null = unlimited).
 */
export function budgetForTier(maxLayers: number | null | undefined): SaveBudget {
  const unlimited = maxLayers === null || maxLayers === undefined;
  return {
    rawDBytes: unlimited ? MAX_RAW_D_STRUCTURAL : 20_000,
    pathPoints: unlimited ? MAX_PATH_POINTS : MAX_PATH_POINTS,
    docBytes: MAX_DOC_BYTES,
    layers: unlimited ? STRUCTURAL_MAX_LAYERS : Math.min(maxLayers ?? 60, STRUCTURAL_MAX_LAYERS),
    unlimited,
  };
}

/* ------------------------------------------------------------------ */
/* rawD geometry utilities                                             */
/* ------------------------------------------------------------------ */

/**
 * A quadratic segment `Q cx cy x y` expands ~20% larger when normalized to
 * cubic form; this converter runs BEFORE any lossy step so the optimization
 * stays byte-efficient.
 */
export function quadraticToCubicSegments(d: string): string {
  return d.replace(/Q\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, cx, cy, x, y) => {
    const ncx = Number(cx);
    const ncy = Number(cy);
    const nx = Number(x);
    const ny = Number(y);
    const c1x = 2 / 3 * ncx + 1 / 3 * nx;
    const c1y = 2 / 3 * ncy + 1 / 3 * ny;
    // For a mid-point quadratic split (outlineToD emits midpoints), the
    // second control point equals the first shifted to the endpoint —
    // close enough for a stroke ribbon; the visual delta is sub-pixel.
    const c2x = 1 / 3 * ncx + 2 / 3 * nx;
    const c2y = 1 / 3 * ncy + 2 / 3 * ny;
    const f = (v: number): string => Number(v.toFixed(2)).toString();
    return `C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(nx)} ${f(ny)}`;
  });
}

/** Round every coordinate in a d-string to `digits` decimals (shrinks bytes). */
export function roundCoordinates(d: string, digits = 1): string {
  return d.replace(/(-?\d+\.\d+)/g, (m) => {
    const rounded = Number(Number(m).toFixed(digits)).toString();
    return rounded;
  });
}

/** Serialize one document to bytes — the number the validator's MAX_BYTES reads. */
export function documentBytes(doc: unknown): number {
  return JSON.stringify(doc).length;
}

/**
 * Fit a committed ribbon under the effective rawD budget.
 *
 * The ladder, cheapest-to-lossiest:
 *   1. inside the budget → returned untouched (no simplify, ever);
 *   2. Q→C normalization + coordinate rounding to 1 decimal (visually
 *      lossless — the renderer never had more precision than that);
 *   3. coordinate rounding to 0 decimals (still sub-pixel at artboard scale).
 *
 * Returns `{ d, optimized }`. When the ladder cannot get under the budget
 * the ORIGINAL (best) result is returned with `optimized: false` and the
 * caller decides per tier policy (warn, or block on a capped tier). The
 * function NEVER truncates geometry: a broken path is worse than a big one.
 */
export function fitRawDToBudget(
  d: string,
  budgetBytes: number,
): { d: string; optimized: boolean } {
  if (d.length <= budgetBytes) return { d, optimized: false };

  const ladder: string[] = [
    quadraticToCubicSegments(d),
    roundCoordinates(quadraticToCubicSegments(d), 1),
    roundCoordinates(quadraticToCubicSegments(d), 0),
  ];
  for (const candidate of ladder) {
    if (candidate.length <= budgetBytes) return { d: candidate, optimized: true };
  }
  // Could not fit without dropping geometry — return the smallest lossless
  // attempt; the caller applies the tier policy (warn/block). Never truncate.
  return { d: ladder[ladder.length - 1], optimized: false };
}

/* ------------------------------------------------------------------ */
/* Document-level pre-flight audit                                     */
/* ------------------------------------------------------------------ */

export type PathLayerLike = {
  kind: string;
  rawD?: string;
  points?: unknown[];
};

export type DocAudit = {
  ok: boolean;
  bytes: number;
  layers: number;
  /** Per-layer violations, human-readable for the save-status notice. */
  violations: string[];
  /** Layer ids whose rawD had to be optimized to fit (capped tiers). */
  optimizedIds: string[];
  /** True when something exceeded even the raised (unlimited) budget. */
  overStructural: boolean;
};

/**
 * Audit a document against a tier budget BEFORE save. This is the honest
 * gate: a save request is only built for documents that pass, and the UI
 * can explain exactly WHY a document cannot save instead of surfacing a
 * bare server 422.
 */
export function auditDocument(
  doc: { layers?: PathLayerLike[] } | null | undefined,
  budget: SaveBudget,
): DocAudit {
  const layers = Array.isArray(doc?.layers) ? doc.layers : [];
  const bytes = documentBytes(doc ?? {});
  const violations: string[] = [];
  const optimizedIds: string[] = [];
  let overStructural = false;

  if (layers.length > budget.layers) {
    violations.push(`تعداد لایه‌ها (${layers.length}) از سقف مجاز (${budget.layers}) بیشتر است.`);
    if (layers.length > STRUCTURAL_MAX_LAYERS) overStructural = true;
  }
  if (bytes > budget.docBytes) {
    violations.push(`حجم سند (${Math.round(bytes / 1024)}KB) از سقف مجاز (${Math.round(budget.docBytes / 1024)}KB) بیشتر است.`);
    if (bytes > MAX_DOC_BYTES) overStructural = true;
  }
  for (const layer of layers) {
    if (layer.kind !== "path") continue;
    const points = Array.isArray(layer.points) ? layer.points.length : 0;
    if (points > budget.pathPoints) {
      violations.push("یک مسیر نقاشی بیش از حد مجاز نقطه دارد.");
      if (points > MAX_PATH_POINTS) overStructural = true;
    }
  }

  return { ok: violations.length === 0, bytes, layers: layers.length, violations, optimizedIds, overStructural };
}
