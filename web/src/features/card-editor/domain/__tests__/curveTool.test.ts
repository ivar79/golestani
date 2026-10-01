import { describe, expect, it } from "vitest";
import { curveProfilePoints, curveLineD } from "../curveLine";

describe("upgraded curve tool", () => {
  it("keeps the legacy arc as a two-point curve", () => {
    const points = curveProfilePoints(500, 120, "arc");
    expect(points).toHaveLength(2);
    expect(curveLineD({ x1: 0, y1: 60, x2: 500, y2: 60, bend: 0.5 })).toContain("A");
  });

  it("creates editable symmetric and asymmetric wave paths", () => {
    const symmetric = curveProfilePoints(600, 180, "sine");
    const asymmetric = curveProfilePoints(600, 180, "sine-asymmetric");
    expect(symmetric.length).toBeGreaterThan(2);
    expect(asymmetric.length).toBeGreaterThan(2);
    expect(symmetric[0].x).toBe(0);
    expect(symmetric.at(-1)?.x).toBe(600);
    expect(asymmetric.map((p) => p.y)).not.toEqual(symmetric.map((p) => p.y));
  });
});
