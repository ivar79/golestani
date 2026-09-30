/**
 * SaveLimits contract tests — the frontend mirror of the server validator.
 *
 * Pinning here what Phase 3's save-integrity work promises:
 *   - fitRawDToBudget NEVER truncates geometry and never touches a path
 *     that is already inside the budget;
 *   - the tier policy distinguishes unlimited (budget = structural cap,
 *     no auto-simplify pressure) from capped tiers (optimize first);
 *   - wrapAngle keeps stored rotations inside the validator's ±360 clamp;
 *   - auditDocument names the exact violation instead of a bare server 422.
 */
import { describe, expect, it } from "vitest";
import {
  auditDocument,
  budgetForTier,
  fitRawDToBudget,
  MAX_DOC_BYTES,
  MAX_PATH_POINTS,
  MAX_RAW_D_STRUCTURAL,
  STRUCTURAL_MAX_LAYERS,
} from "../saveLimits";
import { wrapAngle } from "../../engine/EditorEngine";

/** A quadratic ribbon of `n` segments, like outlineToD produces. */
function quadraticRibbon(n: number): string {
  let d = "M 10.5 20.5 Q";
  for (let i = 0; i < n; i++) {
    const x = 10 + i * 7.25;
    const y = 20 + Math.sin(i) * 13.75;
    const mx = x + 3.125;
    const my = y + 1.875;
    d += ` ${x.toFixed(2)} ${y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  return `${d} Z`;
}

describe("fitRawDToBudget", () => {
  it("returns a path inside the budget untouched (no lossy step)", () => {
    const d = quadraticRibbon(40);
    const { d: out, optimized } = fitRawDToBudget(d, 100_000);
    expect(optimized).toBe(false);
    expect(out).toBe(d);
  });

  it("fits an oversized ribbon via the lossless ladder without truncating", () => {
    // ~24.5KB raw: over the capped 20KB budget, but the ladder (round to
    // integer coordinates) brings it to ~13.8KB — measured, not guessed.
    const big = quadraticRibbon(900);
    expect(big.length).toBeGreaterThan(20_000);

    const { d: out, optimized } = fitRawDToBudget(big, 20_000);
    expect(optimized).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20_000);
    // Geometry preserved: still one subpath, still closes, same command count.
    expect(out.startsWith("M")).toBe(true);
    expect(out.endsWith("Z")).toBe(true);
    expect((out.match(/C /g) ?? []).length).toBe((big.match(/Q/g) ?? []).length);
  });

  it("returns the best lossless candidate when even the ladder cannot fit (never truncates)", () => {
    const huge = quadraticRibbon(60_000); // hundreds of KB
    const { d: out, optimized } = fitRawDToBudget(huge, 20_000);
    expect(optimized).toBe(false);
    // No truncation: every quadratic segment survived as a cubic.
    expect((out.match(/C /g) ?? []).length).toBe((huge.match(/Q/g) ?? []).length);
    expect(out.endsWith("Z")).toBe(true);
  });

  it("unlimited tier budget equals the structural cap (no silent decimation pressure)", () => {
    expect(budgetForTier(null).rawDBytes).toBe(MAX_RAW_D_STRUCTURAL);
    expect(budgetForTier(null).unlimited).toBe(true);
    expect(budgetForTier(30).unlimited).toBe(false);
    expect(budgetForTier(30).rawDBytes).toBe(20_000);
  });
});

describe("wrapAngle", () => {
  it("keeps repeated group rotations inside (−180, 180]", () => {
    expect(wrapAngle(370)).toBe(10);
    expect(wrapAngle(-370)).toBe(-10);
    expect(wrapAngle(180)).toBe(180);
    expect(wrapAngle(181)).toBe(-179);
    expect(wrapAngle(-180)).toBe(180); // (−180, 180] — −180 normalizes up
    expect(wrapAngle(720 * 3 + 45)).toBe(45);
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(NaN)).toBe(0);
  });
});

describe("auditDocument", () => {
  it("passes a document inside every cap and reports the numbers", () => {
    const doc = { layers: [{ kind: "text" }, { kind: "shape" }] };
    const audit = auditDocument(doc, budgetForTier(60));
    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(audit.layers).toBe(2);
    expect(audit.bytes).toBeLessThan(MAX_DOC_BYTES);
  });

  it("names a layer-cap violation for a capped tier but not for unlimited", () => {
    const layers = Array.from({ length: STRUCTURAL_MAX_LAYERS }, (_, i) => ({ kind: "text", id: `t${i}` }));
    const doc = { layers };
    expect(auditDocument(doc, budgetForTier(60)).ok).toBe(false);
    expect(auditDocument(doc, budgetForTier(null)).ok).toBe(true); // unlimited up to the structural cap
  });

  it("flags a path over the anchor cap as over-structural", () => {
    const doc = {
      layers: [{ kind: "path", points: Array.from({ length: MAX_PATH_POINTS + 1 }, () => ({ x: 0, y: 0 })) }],
    };
    const audit = auditDocument(doc, budgetForTier(60));
    expect(audit.ok).toBe(false);
    expect(audit.overStructural).toBe(true);
    expect(audit.violations[0]).toContain("نقطه");
  });

  it("flags an oversized document as over-structural", () => {
    const filler = "x".repeat(MAX_DOC_BYTES);
    const doc = { layers: [{ kind: "text", text: filler }] };
    const audit = auditDocument(doc, budgetForTier(null));
    expect(audit.ok).toBe(false);
    expect(audit.overStructural).toBe(true);
  });
});
