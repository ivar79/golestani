import { describe, expect, it } from "vitest";
import { curveLineD, curveBendHandlePos, bendFromPointer } from "../curveLine";
import {
  CURVE_KINDS,
  CURVE_PROFILES,
  CURVE_NODE_COUNTS,
  LEGACY_CURVE_PROFILE_KINDS,
  curveAnchors,
  normalizeNodeCount,
} from "../curveGeometry";

/**
 * `curveLine.ts` is now ONLY the legacy sagitta arc model (`bend`) that 2-point
 * arcs use. The four curve PROFILES live in `curveGeometry.ts` — the duplicate
 * generator (`curveProfilePoints`) that used to sit in this module is gone, and
 * these tests pin both halves of that split.
 */
describe("sagitta arc model (the only thing curveLine.ts still owns)", () => {
  it("draws a true circular arc for a non-zero bend", () => {
    expect(curveLineD({ x1: 0, y1: 60, x2: 500, y2: 60, bend: 0.5 })).toContain(" A ");
  });

  it("collapses to a straight line when the sagitta is negligible", () => {
    expect(curveLineD({ x1: 0, y1: 60, x2: 500, y2: 60, bend: 0 })).not.toContain(" A ");
  });

  it("puts the bend handle on the arc, and reads a bend back from a pointer", () => {
    const spec = { x1: 0, y1: 0, x2: 100, y2: 0, bend: 0.5 };
    const handle = curveBendHandlePos(spec);
    // bend 0.5 on a 100px chord = a 25px sagitta along the chord normal.
    expect(handle.x).toBeCloseTo(50, 6);
    expect(Math.abs(handle.y)).toBeCloseTo(25, 6);
    expect(bendFromPointer(spec, { x: 50, y: 25 })).toBeCloseTo(0.5, 2);
    // A pointer within the snap radius of the chord means "straight".
    expect(bendFromPointer(spec, { x: 50, y: 2 })).toBe(0);
  });
});

describe("canonical curve profile vocabulary", () => {
  it("exposes exactly the four UI profiles, all of them valid curve kinds", () => {
    expect(CURVE_PROFILES.map((profile) => profile.kind)).toEqual([
      "arc",
      "sine",
      "sine-asymmetric",
      "s",
    ]);
    for (const profile of CURVE_PROFILES) {
      expect(CURVE_KINDS).toContain(profile.kind);
      expect(profile.label.length).toBeGreaterThan(0);
    }
  });

  it("maps every legacy curveProfile value, and never claims a redraw", () => {
    expect(LEGACY_CURVE_PROFILE_KINDS.arc).toBe("arc");
    expect(LEGACY_CURVE_PROFILE_KINDS.sine).toBe("sine");
    expect(LEGACY_CURVE_PROFILE_KINDS.s).toBe("s");
    // The legacy harmonic blend is NOT the parametric sine — declaring it one
    // would silently redraw a saved curve, so it becomes custom geometry.
    expect(LEGACY_CURVE_PROFILE_KINDS["sine-asymmetric"]).toBe("custom");
  });

  it("generates editable nodes for every profile, at the requested count", () => {
    for (const profile of CURVE_PROFILES) {
      for (const nodes of CURVE_NODE_COUNTS) {
        const points = curveAnchors({ kind: profile.kind, nodes });
        expect(points.length).toBe(nodes);
        expect(points[0].hIn).toBeNull();
        expect(points[points.length - 1].hOut).toBeNull();
      }
    }
  });

  it("snaps a node count onto the supported ladder", () => {
    expect(normalizeNodeCount(4)).toBe(3);
    expect(normalizeNodeCount(6)).toBe(5);
    expect(normalizeNodeCount(100)).toBe(16);
    expect(normalizeNodeCount(Number.NaN)).toBe(9);
  });
});
