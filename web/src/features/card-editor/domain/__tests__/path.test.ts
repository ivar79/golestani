import { describe, expect, it } from "vitest";
import { createFreehandPath, pathBBox, pathD, type PathPoint } from "../path";

describe("createFreehandPath", () => {
  it("returns an empty array for no input", () => {
    expect(createFreehandPath([])).toEqual([]);
  });

  it("decimates points closer than minDist", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 50, y: 50 },
    ];
    const path = createFreehandPath(raw, { minDist: 2 });
    expect(path.length).toBe(2);
    expect(path[0]).toMatchObject({ x: 0, y: 0 });
    expect(path[1]).toMatchObject({ x: 50, y: 50 });
  });

  it("turns a single sample into a drawable dot", () => {
    const path = createFreehandPath([{ x: 10, y: 10 }]);
    expect(path.length).toBe(2);
    expect(path[1].x).toBeGreaterThan(10);
  });

  it("smooths interior anchors with Bezier handles", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const path = createFreehandPath(raw, { tension: 0.2 });
    // Endpoints carry no handle toward the outside; the middle anchor gets both.
    expect(path[0].hIn).toBeNull();
    expect(path[path.length - 1].hOut).toBeNull();
    const middle = path[1];
    expect(middle.hIn).not.toBeNull();
    expect(middle.hOut).not.toBeNull();
    // Handles sit on opposite sides of the anchor along the tangent.
    expect(middle.hIn!.x).toBeLessThan(middle.x);
    expect(middle.hOut!.x).toBeGreaterThan(middle.x);
  });

  it("higher tension pushes handles further out", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const loose = createFreehandPath(raw, { tension: 0.1 });
    const tight = createFreehandPath(raw, { tension: 0.5 });
    expect(Math.abs(tight[1].hOut!.x - 50)).toBeGreaterThan(Math.abs(loose[1].hOut!.x - 50));
  });
});

describe("pathD", () => {
  it("emits an empty string for no points", () => {
    expect(pathD([])).toBe("");
  });

  it("moves to the first anchor and curves through the rest", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0, hIn: { x: 25, y: 0 } },
      { x: 100, y: 0 },
    ];
    const d = pathD(points);
    expect(d).toBe("M 0 0 C 0 0, 25 0, 50 0 C 50 0, 100 0, 100 0");
  });

  it("closes the loop back to the first anchor", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, hOut: { x: 10, y: 0 } },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    const d = pathD(points, true);
    expect(d).toContain(" Z");
    // 2 open segments + 1 closing segment = 3 curve commands.
    expect((d.match(/ C /g) ?? []).length).toBe(3);
  });

  it("does not close a degenerate two-point path", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(pathD(points, true)).not.toContain("Z");
  });
});

describe("pathBBox", () => {
  it("covers anchors and their handles", () => {
    const points: PathPoint[] = [
      { x: 10, y: 10 },
      { x: 100, y: 10, hIn: { x: 60, y: -40 }, hOut: { x: 140, y: 60 } },
    ];
    expect(pathBBox(points)).toEqual({ x: 10, y: -40, width: 130, height: 100 });
  });

  it("falls back to a zero box for no points", () => {
    expect(pathBBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
