import { describe, expect, it } from "vitest";
import { smoothFreehandSample, type FreehandPoint } from "../freehand";

function simulateLinearStroke(hz: number): FreehandPoint {
  const dt = 1000 / hz;
  let point: FreehandPoint = { x: 0, y: 0, p: 0.5 };
  for (let t = dt; t <= 100 + 1e-8; t += dt) {
    point = smoothFreehandSample(point, { x: t, y: t * 0.5, p: 0.5 }, dt);
  }
  return point;
}

describe("time-based freehand smoothing", () => {
  it("is nearly independent of 60Hz, 120Hz, and 240Hz event frequency", () => {
    const at60 = simulateLinearStroke(60);
    const at120 = simulateLinearStroke(120);
    const at240 = simulateLinearStroke(240);
    expect(Math.abs(at60.x - at120.x)).toBeLessThan(1.5);
    expect(Math.abs(at120.x - at240.x)).toBeLessThan(1.5);
    expect(Math.abs(at60.y - at240.y)).toBeLessThan(0.75);
  });

  it("does not move the point when no time has elapsed", () => {
    expect(smoothFreehandSample(
      { x: 10, y: 20, p: 0.4 },
      { x: 100, y: 200, p: 0.8 },
      0,
    )).toEqual({ x: 10, y: 20, p: 0.8 });
  });

  it("uses target pressure immediately while smoothing position", () => {
    expect(smoothFreehandSample(
      { x: 0, y: 0, p: 0.2 },
      { x: 10, y: 10, p: 0.9 },
      20,
    ).p).toBe(0.9);
  });
});
