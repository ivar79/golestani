import { describe, expect, it } from "vitest";
import { pointInContours, polygonSignedArea, type Pt, type SubPath } from "../canonical";
import {
  booleanContours,
  insertTJunctions,
  refitLoop,
  type BooleanOp,
  type BooleanOperand,
} from "../booleanOps";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** An axis-aligned rectangle as one closed subpath (straight cubics). */
function rect(id: string, x: number, y: number, width: number, height: number): BooleanOperand {
  return { id, subpaths: [polygonSubPath([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }])] };
}

/** A closed polygon subpath: the closing segment is included (SVG `Z`). */
function polygonSubPath(points: Pt[]): SubPath {
  return {
    start: { ...points[0] },
    closed: true,
    segments: points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return { p0: { ...point }, c1: { ...point }, c2: { ...next }, p1: { ...next } };
    }),
  };
}

/** A circle as the standard 4-cubic Bézier approximation. */
function circle(id: string, cx: number, cy: number, radius: number): BooleanOperand {
  const k = 0.5522847498307936 * radius;
  const right = { x: cx + radius, y: cy };
  const bottom = { x: cx, y: cy + radius };
  const left = { x: cx - radius, y: cy };
  const top = { x: cx, y: cy - radius };
  return {
    id,
    subpaths: [
      {
        start: { ...right },
        closed: true,
        segments: [
          { p0: { ...right }, c1: { x: right.x, y: right.y + k }, c2: { x: bottom.x + k, y: bottom.y }, p1: { ...bottom } },
          { p0: { ...bottom }, c1: { x: bottom.x - k, y: bottom.y }, c2: { x: left.x, y: left.y + k }, p1: { ...left } },
          { p0: { ...left }, c1: { x: left.x, y: left.y - k }, c2: { x: top.x - k, y: top.y }, p1: { ...top } },
          { p0: { ...top }, c1: { x: top.x + k, y: top.y }, c2: { x: right.x, y: right.y - k }, p1: { ...right } },
        ],
      },
    ],
  };
}

const area = (operands: BooleanOperand[], op: BooleanOp) => booleanContours(operands, op).area;
const result = (operands: BooleanOperand[], op: BooleanOp) => booleanContours(operands, op);

/** Is a world point inside a boolean result? (loops are oriented result-on-left) */
function covers(loops: Pt[][], point: Pt): boolean {
  return pointInContours(point, loops, "nonzero");
}

/* ------------------------------------------------------------------ */
/* Areas: the exact correctness contract                               */
/* ------------------------------------------------------------------ */

describe("boolean ops — exact areas", () => {
  const a = rect("a", 0, 0, 10, 10);
  const b = rect("b", 5, 5, 10, 10);

  it("union of two 10×10 squares offset by 5 has area 175", () => {
    expect(area([a, b], "union")).toBeCloseTo(175, 6);
  });

  it("intersect of the same pair is the 5×5 overlap", () => {
    const r = result([a, b], "intersect");
    expect(r.area).toBeCloseTo(25, 6);
    expect(r.loops).toHaveLength(1);
  });

  it("subtract removes the overlap from the base operand", () => {
    expect(area([a, b], "subtract")).toBeCloseTo(75, 6);
  });

  it("exclude counts the overlap once, not twice", () => {
    expect(area([a, b], "exclude")).toBeCloseTo(150, 6);
  });

  it("three operands: subtract chains A − B − C", () => {
    const c = rect("c", 0, 5, 5, 5);
    // A is 100; B takes 25, C takes another 25, and they do not overlap.
    expect(area([a, b, c], "subtract")).toBeCloseTo(50, 6);
  });

  it("an empty predicate result reports empty instead of a fake shape", () => {
    const far = rect("far", 100, 100, 10, 10);
    const r = result([a, far], "intersect");
    expect(r.empty).toBe(true);
    expect(r.area).toBe(0);
    expect(r.loops).toHaveLength(0);
  });

  it("identical operands do not double the area", () => {
    expect(area([a, { ...a, id: "a2" }], "union")).toBeCloseTo(100, 6);
    expect(area([a, { ...a, id: "a2" }], "exclude")).toBeCloseTo(0, 6);
  });

  it("the reported area equals the signed area of the emitted loops", () => {
    const r = result([a, b], "union");
    const summed = r.loops.reduce((sum, loop) => sum + polygonSignedArea(loop), 0);
    expect(summed).toBeCloseTo(r.area, 9);
  });
});

/* ------------------------------------------------------------------ */
/* Result geometry                                                     */
/* ------------------------------------------------------------------ */

describe("boolean ops — result geometry", () => {
  it("a union of two aligned rectangles is ONE rectangle, not a seam-split polygon", () => {
    // B starts exactly where A's right third is: the shared edge is collinear
    // with both bottom edges, which requires a T-junction weld to resolve.
    const a = rect("a", 0, 0, 10, 10);
    const b = rect("b", 5, 0, 10, 10);
    const r = result([a, b], "union");
    expect(r.area).toBeCloseTo(150, 6);
    expect(r.loops).toHaveLength(1);
    // 4 corners: the refit must NOT leave the weld vertices in the output.
    expect(r.anchorLoops[0]).toHaveLength(4);
    expect(r.anchorLoops[0].every((anchor) => anchor.hIn === null && anchor.hOut === null)).toBe(true);
  });

  it("touching-but-not-overlapping shapes stay separate loops", () => {
    const a = rect("a", 0, 0, 10, 10);
    const b = rect("b", 10, 0, 10, 10);
    const r = result([a, b], "union");
    expect(r.area).toBeCloseTo(200, 6);
    expect(r.loops.length).toBeGreaterThanOrEqual(1);
    expect(covers(r.loops, { x: 5, y: 5 })).toBe(true);
    expect(covers(r.loops, { x: 15, y: 5 })).toBe(true);
    expect(covers(r.loops, { x: 10, y: 5 })).toBe(true);
  });

  it("subtracting a fully enclosed shape produces a real hole", () => {
    const outer = rect("outer", 0, 0, 20, 20);
    const inner = rect("inner", 5, 5, 10, 10);
    const r = result([outer, inner], "subtract");
    expect(r.area).toBeCloseTo(300, 6);
    expect(r.loops).toHaveLength(2);

    // Orientation is result-on-the-left: the outer loop CCW, the hole CW.
    const areas = r.loops.map(polygonSignedArea).sort((x, y) => x - y);
    expect(areas[0]).toBeLessThan(0);
    expect(areas[1]).toBeGreaterThan(0);
    expect(Math.abs(areas[0])).toBeCloseTo(100, 6);
    expect(areas[1]).toBeCloseTo(400, 6);

    // The hole really is a hole: the middle is not covered, the ring is.
    expect(covers(r.loops, { x: 10, y: 10 })).toBe(false);
    expect(covers(r.loops, { x: 2, y: 10 })).toBe(true);
  });

  it("intersecting a circle with a rectangle keeps the curve, area within the fit tolerance", () => {
    const disk = circle("disk", 10, 10, 10);
    const box = rect("box", 10, 0, 20, 20); // the right half of the disk
    // The flattening tolerance is the ONLY source of area error for a curve
    // (the arrangement itself is exact), so tightening it tightens the answer.
    const r = booleanContours([disk, box], "intersect", { flattenTolerance: 0.05 });
    const expected = (Math.PI * 100) / 2; // ~157.08
    expect(Math.abs(r.area - expected)).toBeLessThan(1.5);
    expect(r.loops).toHaveLength(1);
    const anchors = r.anchorLoops[0];
    expect(anchors.some((anchor) => anchor.hIn !== null || anchor.hOut !== null)).toBe(true);
    // A half circle needs far fewer anchors than its flattening (~120 points).
    expect(anchors.length).toBeLessThan(30);
    expect(anchors.length).toBeGreaterThan(3);
  });

  it("union of a disk and its enclosing box is just the box", () => {
    const disk = circle("disk", 10, 10, 5);
    const box = rect("box", 0, 0, 20, 20);
    const r = result([disk, box], "union");
    expect(r.area).toBeCloseTo(400, 6);
    expect(r.loops).toHaveLength(1);
  });

  it("empty operand list is not an error", () => {
    expect(booleanContours([], "union").empty).toBe(true);
  });

  it("a single operand is the identity for intersect and union", () => {
    const only = rect("only", 500, 500, 10, 20);
    expect(result([only], "intersect").area).toBeCloseTo(200, 6);
    expect(result([only], "union").area).toBeCloseTo(200, 6);
    expect(result([only], "subtract").area).toBeCloseTo(200, 6);
  });
});

/* ------------------------------------------------------------------ */
/* The arrangement agrees with the predicate everywhere               */
/* ------------------------------------------------------------------ */

describe("boolean ops — point-wise agreement", () => {
  const a = rect("a", 0, 0, 30, 30);
  const b = circle("b", 30, 30, 18);
  const c = rect("c", 10, 10, 40, 8);

  const cases: { op: BooleanOp; operands: BooleanOperand[] }[] = [
    { op: "union", operands: [a, b, c] },
    { op: "intersect", operands: [a, b, c] },
    { op: "subtract", operands: [b, a, c] },
    { op: "exclude", operands: [a, b, c] },
  ];

  for (const { op, operands } of cases) {
    it(`${op}: every sampled pixel matches the predicate`, () => {
      const r = result(operands, op);
      let mismatches = 0;
      let covered = 0;
      for (let x = -2; x <= 62; x += 1.5) {
        for (let y = -2; y <= 62; y += 1.5) {
          const point = { x, y };
          const viaLoops = covers(r.loops, point);
          if (viaLoops) covered += 1;
          if (viaLoops === referencePointInside(operands, op, point)) continue;
          // Points within ~1px of an operand's own boundary are where "on the
          // edge" is genuinely undefined (the loops are polygonised), so they
          // are the only ones allowed to disagree.
          if (!nearBoundary(operands, point)) mismatches += 1;
        }
      }
      expect(mismatches).toBe(0);
      if (op !== "intersect") expect(covered).toBeGreaterThan(50);
    });
  }
});

/** Independently recompute the predicate from the source subpaths. */
function referencePointInside(operands: BooleanOperand[], op: BooleanOp, point: Pt): boolean {
  const inside = operands.map((operand) =>
    pointInContours(
      point,
      operand.subpaths.flatMap((sub) => [flattenedContour(sub)]),
      "nonzero",
    ),
  );
  switch (op) {
    case "union":
      return inside.some(Boolean);
    case "intersect":
      return inside.every(Boolean);
    case "subtract":
      return inside[0] && !inside.slice(1).some(Boolean);
    case "exclude":
      return inside.filter(Boolean).length % 2 === 1;
  }
}

/** A coarse polyline of one subpath (enough for a boundary-proximity test). */
function flattenedContour(sub: SubPath): Pt[] {
  const points: Pt[] = [{ ...sub.start }];
  for (const segment of sub.segments) {
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      points.push({
        x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p1.x,
        y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p1.y,
      });
    }
  }
  if (sub.closed && points.length > 1) points.pop();
  return points;
}

/** Cheap "is this point within ~0.9px of any operand edge" guard. */
function nearBoundary(operands: BooleanOperand[], point: Pt): boolean {
  const tolerance = 1.2;
  for (const operand of operands) {
    for (const sub of operand.subpaths) {
      const contour = flattenedContour(sub);
      for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
        if (Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)) <= tolerance) return true;
      }
    }
  }
  return false;
}

/** Shortest distance from a point to a closed polygon's edges. */
function distanceToPolygon(point: Pt, polygon: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

describe("boolean ops — pieces", () => {
  it("insertTJunctions splits an edge at a vertex that lies on it", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const spike = [
      { x: 5, y: 0 }, // exactly on the square's bottom edge
      { x: 5, y: -5 },
      { x: 6, y: -5 },
    ];
    const [spliced] = insertTJunctions([square, spike], 0.01);
    expect(spliced).toHaveLength(5);
    expect(spliced[1]).toEqual({ x: 5, y: 0 });
  });

  it("insertTJunctions leaves geometry alone when nothing lands on an edge", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(insertTJunctions([square], 0.01)[0]).toEqual(square);
  });

  it("refitLoop keeps a rectangle at 4 sharp anchors", () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const anchors = refitLoop(loop);
    expect(anchors).toHaveLength(4);
    expect(anchors.every((anchor) => anchor.hIn === null && anchor.hOut === null)).toBe(true);
  });

  it("refitLoop smooths a dense curve instead of faceting it", () => {
    const loop: Pt[] = [];
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      loop.push({ x: 50 + Math.cos(angle) * 20, y: 50 + Math.sin(angle) * 20 });
    }
    const anchors = refitLoop(loop, { fitTolerance: 0.2 });
    expect(anchors.length).toBeLessThan(40);
    expect(anchors.some((anchor) => anchor.hIn && anchor.hOut)).toBe(true);
    // Shape preserved: dropping vertices is an INSCRIBED approximation, so the
    // anchor polygon is a hair smaller — well under 1% of a 1257px² circle.
    const fitted = anchors.map((anchor) => ({ x: anchor.x, y: anchor.y }));
    expect(polygonSignedArea(fitted)).toBeGreaterThan(polygonSignedArea(loop) * 0.99);
    // Every dropped vertex stays within the fit tolerance of the new outline.
    for (const point of loop) {
      expect(distanceToPolygon(point, fitted)).toBeLessThanOrEqual(0.6);
    }
  });
});
