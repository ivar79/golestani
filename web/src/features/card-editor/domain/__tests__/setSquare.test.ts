import { describe, expect, it } from "vitest";
import { closestPointOnSegment, createSetSquare, nearestSetSquareEdge, normalizeSetSquare, setSquareVertices, toggleSetSquareKind } from "../setSquare";

describe("physical set-square geometry", () => {
  it("creates centered triangle geometry with three vertices", () => {
    const square = createSetSquare("sq1", { x: 400, y: 300 });
    const vertices = setSquareVertices(square);
    expect(vertices).toHaveLength(3);
    expect(vertices.reduce((sum, p) => sum + p.x, 0) / 3).toBeCloseTo(400);
    expect(vertices.reduce((sum, p) => sum + p.y, 0) / 3).toBeCloseTo(300);
  });

  it("switches between the two physical triangle types", () => {
    const square = createSetSquare("sq1", { x: 0, y: 0 });
    expect(toggleSetSquareKind(square).kind).toBe("30-60-90");
    expect(toggleSetSquareKind(toggleSetSquareKind(square)).kind).toBe("45-45-90");
  });

  it("clamps size to the documented 40–1200 design-pixel range", () => {
    expect(normalizeSetSquare({ ...createSetSquare("sq1", { x: 0, y: 0 }), size: 1 }).size).toBe(40);
    expect(normalizeSetSquare({ ...createSetSquare("sq1", { x: 0, y: 0 }), size: 5000 }).size).toBe(1200);
  });

  it("projects onto a finite segment and does not extend its line infinitely", () => {
    const result = closestPointOnSegment({ x: 30, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(result.point).toEqual({ x: 10, y: 0 });
    expect(result.distance).toBeCloseTo(Math.hypot(20, 10));
  });

  it("offers locked edges only for snapping", () => {
    const square = createSetSquare("sq1", { x: 100, y: 100 });
    expect(nearestSetSquareEdge(square, { x: 100, y: 100 })).toBeNull();
    expect(nearestSetSquareEdge({ ...square, locked: true }, { x: 100, y: 100 })).not.toBeNull();
  });
});
