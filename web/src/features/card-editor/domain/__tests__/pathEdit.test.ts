import { describe, expect, it } from "vitest";
import {
  cubicAt,
  insertAnchor,
  moveAnchor,
  moveHandle,
  normalizePathLayer,
  pathBBoxExact,
  removeAnchor,
  segmentCubics,
  splitCubic,
  type PathPoint,
} from "../path";

const straight: PathPoint[] = [
  { x: 0, y: 0, hIn: null, hOut: null },
  { x: 100, y: 0, hIn: null, hOut: null },
];

/** Uniformly sample a path across its segments (used for loss-less checks). */
function sampleAt(points: PathPoint[], closed: boolean, t: number) {
  const segments = segmentCubics(points, closed);
  const scaled = t * segments.length;
  const index = Math.min(segments.length - 1, Math.floor(scaled));
  const segment = segments[index];
  return cubicAt(segment.p0, segment.c1, segment.c2, segment.p1, scaled - index);
}

describe("segmentCubics", () => {
  it("gives an open path one segment per pair of anchors", () => {
    expect(segmentCubics([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toHaveLength(2);
  });

  it("gives a closed path the extra closing segment", () => {
    expect(segmentCubics([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], true)).toHaveLength(3);
  });

  it("collapses a missing handle onto its own anchor", () => {
    expect(segmentCubics(straight)[0]).toEqual({
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 0 },
      c2: { x: 100, y: 0 },
      p1: { x: 100, y: 0 },
    });
  });
});

describe("splitCubic", () => {
  it("keeps the endpoints and meets exactly at the curve point", () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 0, y: 100 };
    const c2 = { x: 100, y: 100 };
    const p1 = { x: 100, y: 0 };
    const { left, right, point } = splitCubic(p0, c1, c2, p1, 0.5);
    expect(left.p0).toEqual(p0);
    expect(right.p1).toEqual(p1);
    expect(left.p1).toEqual(point);
    expect(right.p0).toEqual(point);
    expect(point).toEqual(cubicAt(p0, c1, c2, p1, 0.5));
  });

  it("collapses to the endpoints at t=0 and t=1", () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 10, y: 0 };
    const c2 = { x: 20, y: 0 };
    const p1 = { x: 30, y: 0 };
    expect(splitCubic(p0, c1, c2, p1, 0).point).toEqual(p0);
    expect(splitCubic(p0, c1, c2, p1, 1).point).toEqual(p1);
  });
});

describe("insertAnchor", () => {
  const curved: PathPoint[] = [
    { x: 0, y: 0, hOut: { x: 0, y: 50 } },
    { x: 100, y: 0, hIn: { x: 100, y: 50 } },
  ];

  it("adds an anchor WITHOUT changing the drawn curve", () => {
    const after = insertAnchor(curved, false, 0, 0.5);
    expect(after).toHaveLength(3);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const before = sampleAt(curved, false, t);
      const now = sampleAt(after, false, t);
      expect(now.x).toBeCloseTo(before.x, 6);
      expect(now.y).toBeCloseTo(before.y, 6);
    }
  });

  it("keeps a straight segment straight (control points land on the endpoints)", () => {
    const after = insertAnchor(straight, false, 0, 0.5);
    expect(after).toHaveLength(3);
    expect(after[1]).toMatchObject({ x: 50, y: 0 });
    for (const t of [0.2, 0.5, 0.8]) {
      expect(sampleAt(after, false, t).y).toBeCloseTo(0, 6);
    }
  });

  it("can insert on the CLOSING segment of a closed path", () => {
    const triangle: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const after = insertAnchor(triangle, true, 2, 0.5);
    expect(after).toHaveLength(4);
    // The new anchor lands on the closing edge, halfway between the last and first.
    expect(after[3].x).toBeCloseTo(25, 6);
    expect(after[3].y).toBeCloseTo(50, 6);
  });

  it("ignores a segment index that does not exist", () => {
    expect(insertAnchor(straight, false, 9, 0.5)).toBe(straight);
  });
});

describe("removeAnchor", () => {
  it("respects the minimum point count for open and closed paths", () => {
    expect(removeAnchor(straight, false, 0)).toHaveLength(2);
    const triangle: PathPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    expect(removeAnchor(triangle, true, 0)).toHaveLength(3);
    expect(removeAnchor([...triangle, { x: 0, y: 100 }], true, 0)).toHaveLength(3);
  });

  it("drops the requested anchor when there is room", () => {
    const square: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const after = removeAnchor(square, true, 1);
    expect(after).toHaveLength(3);
    expect(after.some((p) => p.x === 100 && p.y === 0)).toBe(false);
  });
});

describe("moveAnchor", () => {
  it("carries the handles along so the local curve shape is preserved", () => {
    const points: PathPoint[] = [{ x: 10, y: 10, hIn: { x: 0, y: 10 }, hOut: { x: 20, y: 10 } }];
    expect(moveAnchor(points, 0, { x: 30, y: 40 })[0]).toEqual({
      x: 30,
      y: 40,
      hIn: { x: 20, y: 40 },
      hOut: { x: 40, y: 40 },
    });
  });

  it("leaves a handle-less anchor handle-less", () => {
    const after = moveAnchor(straight, 1, { x: 50, y: 50 });
    expect(after[1]).toMatchObject({ x: 50, y: 50, hIn: null, hOut: null });
  });

  it("ignores an out-of-range index", () => {
    expect(moveAnchor(straight, 7, { x: 1, y: 1 })).toBe(straight);
  });
});

describe("moveHandle", () => {
  const anchor: PathPoint[] = [{ x: 100, y: 100, hIn: { x: 50, y: 100 }, hOut: { x: 150, y: 100 } }];

  it("mirrors the opposite handle about the anchor by default (smooth curve)", () => {
    expect(moveHandle(anchor, 0, "hOut", { x: 180, y: 100 })[0].hIn).toEqual({ x: 20, y: 100 });
    expect(moveHandle(anchor, 0, "hIn", { x: 20, y: 100 })[0].hOut).toEqual({ x: 180, y: 100 });
  });

  it("breaks symmetry when asked (Alt/Option drag)", () => {
    expect(moveHandle(anchor, 0, "hOut", { x: 180, y: 100 }, false)[0].hIn).toEqual({ x: 50, y: 100 });
  });
});

describe("pathBBoxExact", () => {
  it("hugs the INK, not the control-handle hull", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, hOut: { x: 0, y: 400 } },
      { x: 100, y: 0, hIn: { x: 100, y: 400 } },
    ];
    const box = pathBBoxExact(points);
    // Handles reach y=400 but the curve itself only reaches y=300.
    expect(box.y + box.height).toBeLessThan(400);
    expect(box.y + box.height).toBeCloseTo(300, 0);
  });

  it("covers a curve that bulges past its anchors", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, hIn: null, hOut: { x: 0, y: 200 } },
      { x: 100, y: 0, hIn: { x: 100, y: 200 }, hOut: null },
    ];
    const box = pathBBoxExact(points);
    expect(box.x).toBe(0);
    expect(box.x + box.width).toBe(100);
    expect(box.height).toBeGreaterThan(100);
  });

  it("falls back to a zero box with no points", () => {
    expect(pathBBoxExact([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("normalizePathLayer", () => {
  it("re-origins the box while preserving every point's WORLD position", () => {
    const layer = {
      x: 10,
      y: 20,
      width: 5,
      height: 5,
      closed: false,
      points: [
        { x: 40, y: 50, hIn: null, hOut: null },
        { x: 140, y: 250, hIn: null, hOut: null },
      ] as PathPoint[],
    };
    const out = normalizePathLayer(layer, 4);

    expect(out.x + out.points[0].x).toBeCloseTo(10 + 40, 6);
    expect(out.y + out.points[0].y).toBeCloseTo(20 + 50, 6);
    expect(out.x + out.points[1].x).toBeCloseTo(10 + 140, 6);
    expect(out.y + out.points[1].y).toBeCloseTo(20 + 250, 6);

    expect(out.points[0].x).toBeCloseTo(4, 6);
    expect(out.points[0].y).toBeCloseTo(4, 6);
    expect(out.width).toBeCloseTo(100 + 8, 6);
    expect(out.height).toBeCloseTo(200 + 8, 6);
  });

  it("shifts handles with their anchor", () => {
    const layer = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      closed: false,
      points: [{ x: 10, y: 10, hIn: { x: 5, y: 10 }, hOut: { x: 15, y: 10 } }] as PathPoint[],
    };
    const out = normalizePathLayer(layer, 2);
    const anchor = out.points[0];
    expect(anchor.hIn).toEqual({ x: anchor.x - 5, y: anchor.y });
    expect(anchor.hOut).toEqual({ x: anchor.x + 5, y: anchor.y });
  });

  it("never produces a degenerate box for a single point", () => {
    const single = { x: 0, y: 0, width: 1, height: 1, closed: false, points: [{ x: 5, y: 5 }] as PathPoint[] };
    const out = normalizePathLayer(single, 3);
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});
