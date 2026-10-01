/**
 * Vector-engine geometry tests — canonical resolver, path parser, rotation and
 * the region/face system.
 *
 * These are the §22 acceptance criteria expressed as executable checks:
 * rotation is exact and decoupled from length, and intersecting paths produce
 * independently paintable faces whose paint survives a boundary edit.
 */
import { describe, expect, it } from "vitest";
import { arcToCubics, parsePathData } from "../pathData";
import {
  flattenSubPath,
  flattenSubPaths,
  offsetSubPaths,
  pointInContours,
  polygonSignedArea,
  resolvePathGeometry,
  toWorldSubPaths,
  type Pt,
} from "../canonical";
import {
  buildRegions,
  extractFaces,
  faceContainsPoint,
  remapRegionStyles,
  type RegionSourcePath,
  type RegionStyle,
} from "../regions";
import { curveLineD } from "../../curveLine";
import { ARTBOARD, type CardDocument } from "../../document";
import { parseDocument, serializeDocument } from "../../factory";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function rect(id: string, x0: number, y0: number, x1: number, y1: number): RegionSourcePath {
  return {
    id,
    polylines: [{ points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true }],
  };
}

function line(id: string, a: Pt, b: Pt): RegionSourcePath {
  return { id, polylines: [{ points: [a, b], closed: false }] };
}

describe("SVG path data parser", () => {
  it("parses M/L/Z into straight cubics whose controls sit on the endpoints", () => {
    const [sub] = parsePathData("M 0 0 L 100 0 L 100 50 Z");
    expect(sub.segments).toHaveLength(3);
    // A straight segment must not bulge: controls equal its own endpoints.
    const first = sub.segments[0];
    expect(first.c1).toEqual({ x: 0, y: 0 });
    expect(first.c2).toEqual({ x: 100, y: 0 });
    expect(first.p1).toEqual({ x: 100, y: 0 });
    expect(sub.closed).toBe(true);
  });

  it("honours relative commands and implicit lineto after moveto", () => {
    const [sub] = parsePathData("m 10 10 20 0 0 20");
    expect(sub.segments).toHaveLength(2);
    expect(sub.segments[0].p1).toEqual({ x: 30, y: 10 });
    expect(sub.segments[1].p1).toEqual({ x: 30, y: 30 });
  });

  it("elevates a quadratic to an exact cubic", () => {
    const [sub] = parsePathData("M 0 0 Q 50 100 100 0");
    const seg = sub.segments[0];
    expect(seg.c1.x).toBeCloseTo(100 / 3, 9);
    expect(seg.c1.y).toBeCloseTo(200 / 3, 9);
    expect(seg.c2.x).toBeCloseTo(200 / 3, 9);
    expect(seg.c2.y).toBeCloseTo(200 / 3, 9);
    expect(seg.p1).toEqual({ x: 100, y: 0 });
  });

  it("reflects the previous control point for S", () => {
    const [sub] = parsePathData("M 0 0 C 10 10 20 10 30 0 S 50 -10 60 0");
    expect(sub.segments).toHaveLength(2);
    // c1 of the second cubic mirrors c2 of the first about (30,0).
    expect(sub.segments[1].c1).toEqual({ x: 40, y: -10 });
  });

  it("converts an arc to cubics that land exactly on the requested endpoint", () => {
    const pieces = arcToCubics(0, 50, 50, 50, 0, false, true, 100, 50);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces[pieces.length - 1].p1).toEqual({ x: 100, y: 50 });
    // The first piece starts at the arc's start point.
    expect(pieces[0].p0).toEqual({ x: 0, y: 50 });
    // A semicircle through cubics reaches the top of the circle mid-way.
    const top = pieces[0].p1;
    expect(top.y).toBeLessThan(50);
  });

  it("reads the arc curveLineD emits (the legacy bend representation)", () => {
    const d = curveLineD({ x1: 0, y1: 60, x2: 500, y2: 60, bend: 0.5 });
    const [sub] = parsePathData(d);
    expect(sub.segments.length).toBeGreaterThanOrEqual(1);
    const last = sub.segments[sub.segments.length - 1];
    expect(near(last.p1.x, 500, 1e-6)).toBe(true);
    expect(near(last.p1.y, 60, 1e-6)).toBe(true);
  });

  it("never throws on malformed input", () => {
    expect(() => parsePathData("M 0 0 L garbage")).not.toThrow();
    expect(parsePathData("")).toEqual([]);
  });
});

describe("canonical geometry resolver", () => {
  it("resolves anchors, rawD and bend through ONE function", () => {
    const anchored = resolvePathGeometry({
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      closed: false,
    });
    expect(anchored[0].segments).toHaveLength(1);

    const raw = resolvePathGeometry({ points: [], rawD: "M 0 0 L 5 5 L 10 0" });
    expect(raw[0].segments).toHaveLength(2);

    const bent = resolvePathGeometry({
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      bend: 0.5,
    });
    // A bent 2-point "line" is a real curve, not a straight segment.
    expect(bent[0].segments.length).toBeGreaterThan(1);
  });

  it("flattens a straight segment back to exactly its two anchors", () => {
    const [sub] = resolvePathGeometry({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false });
    const flat = flattenSubPath(sub);
    expect(flat).toHaveLength(2);
    expect(flat[1]).toEqual({ x: 100, y: 0 });
  });

  it("shifts geometry into artboard space without touching the source", () => {
    const sub = resolvePathGeometry({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false });
    const world = offsetSubPaths(sub, 40, 5);
    expect(world[0].segments[0].p0).toEqual({ x: 40, y: 5 });
    // Source is untouched (pure).
    expect(sub[0].segments[0].p0).toEqual({ x: 0, y: 0 });

    const viaHelper = toWorldSubPaths({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, x: 40, y: 5 });
    expect(viaHelper[0].segments[0].p0).toEqual({ x: 40, y: 5 });
  });

  it("computes signed area and respects nonzero vs evenodd", () => {
    const square: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(Math.abs(polygonSignedArea(square))).toBe(10000);

    const inner: Pt[] = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }];
    const sameWinding = [square, inner];
    // Nested with the SAME winding: nonzero fills the hole, evenodd cuts it.
    expect(pointInContours({ x: 50, y: 50 }, sameWinding, "nonzero")).toBe(true);
    expect(pointInContours({ x: 50, y: 50 }, sameWinding, "evenodd")).toBe(false);
    expect(pointInContours({ x: 10, y: 50 }, sameWinding, "evenodd")).toBe(true);
    expect(pointInContours({ x: 500, y: 500 }, sameWinding, "evenodd")).toBe(false);
  });
});

describe("region / face system", () => {
  it("produces no face for two crossing lines (nothing is enclosed)", () => {
    const faces = extractFaces([line("a", { x: 0, y: 0 }, { x: 100, y: 100 }), line("b", { x: 0, y: 100 }, { x: 100, y: 0 })]);
    expect(faces).toHaveLength(0);
  });

  it("turns a rectangle into exactly one region", () => {
    const faces = extractFaces([rect("r", 0, 0, 100, 100)]);
    expect(faces).toHaveLength(1);
    expect(Math.abs(faces[0].area)).toBeCloseTo(10000, 6);
    expect(faceContainsPoint(faces[0], { x: 50, y: 50 })).toBe(true);
  });

  it("splits a rectangle into two faces with one intersecting line", () => {
    const faces = extractFaces([rect("r", 0, 0, 100, 100), line("d", { x: 50, y: 0 }, { x: 50, y: 100 })]);
    expect(faces).toHaveLength(2);
    const total = faces.reduce((sum, face) => sum + Math.abs(face.area), 0);
    expect(total).toBeCloseTo(10000, 6);
    // Each midpoint belongs to exactly one face — clicking selects THAT area.
    for (const probe of [{ x: 25, y: 50 }, { x: 75, y: 50 }]) {
      expect(faces.filter((face) => faceContainsPoint(face, probe))).toHaveLength(1);
    }
    // Both faces are bounded by BOTH paths.
    for (const face of faces) expect(face.pathIds).toEqual(["d", "r"]);
  });

  it("handles multiple intersections -> four independent faces", () => {
    const faces = extractFaces([
      rect("r", 0, 0, 100, 100),
      line("v", { x: 50, y: 0 }, { x: 50, y: 100 }),
      line("h", { x: 0, y: 50 }, { x: 100, y: 50 }),
    ]);
    expect(faces).toHaveLength(4);
    const probes = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 25, y: 75 }, { x: 75, y: 75 }];
    for (const probe of probes) {
      expect(faces.filter((face) => faceContainsPoint(face, probe))).toHaveLength(1);
    }
    const total = faces.reduce((sum, face) => sum + Math.abs(face.area), 0);
    expect(total).toBeCloseTo(10000, 6);
  });

  it("gives each face its own id so fills are independent", () => {
    const faces = extractFaces([
      rect("r", 0, 0, 100, 100),
      line("v", { x: 50, y: 0 }, { x: 50, y: 100 }),
    ]);
    expect(new Set(faces.map((face) => face.id)).size).toBe(2);
  });

  it("treats a small gap as closed ONLY when tolerance allows it", () => {
    // A square whose left edge stops 3px short of closing the loop.
    const gapped: RegionSourcePath[] = [{
      id: "g",
      polylines: [{
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 3 }],
        closed: false,
      }],
    }];
    expect(extractFaces(gapped, { gapTolerance: 0 })).toHaveLength(0);
    const closed = extractFaces(gapped, { gapTolerance: 4 });
    expect(closed).toHaveLength(1);
    expect(Math.abs(closed[0].area)).toBeCloseTo(10000, 6);
  });

  it("does not physically move the source geometry when closing gaps", () => {
    const source: RegionSourcePath[] = [{
      id: "g",
      polylines: [{
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 3 }],
        closed: false,
      }],
    }];
    extractFaces(source, { gapTolerance: 4 });
    // Virtual closure is private to the builder — the caller's data is intact.
    expect(source[0].polylines[0].points.at(-1)).toEqual({ x: 0, y: 3 });
  });

  it("turns a shape drawn inside a shape into a face with a HOLE", () => {
    const faces = extractFaces([rect("outer", 0, 0, 300, 300), rect("inner", 100, 100, 200, 200)]);
    expect(faces).toHaveLength(2);

    const withHole = faces.find((face) => face.holes.length > 0);
    expect(withHole).toBeDefined();
    // The donut's middle is NOT part of the outer region...
    expect(faceContainsPoint(withHole!, { x: 150, y: 150 })).toBe(false);
    // ...but its ring is.
    expect(faceContainsPoint(withHole!, { x: 50, y: 50 })).toBe(true);

    const innerFace = faces.find((face) => face.holes.length === 0 && Math.abs(face.area) < 20000);
    expect(innerFace).toBeDefined();
    expect(faceContainsPoint(innerFace!, { x: 150, y: 150 })).toBe(true);
    expect(innerFace!.depth).toBe(1);
    expect(withHole!.depth).toBe(0);
  });

  it("keeps existing paint when a boundary path is edited afterwards", () => {
    const divider = (x: number) => line("d", { x, y: 0 }, { x, y: 100 });
    const paths = (x: number) => [rect("r", 0, 0, 100, 100), divider(x)];

    const before = extractFaces(paths(50));
    expect(before).toHaveLength(2);
    // Paint the LEFT face gold and the right one purple.
    const left = before.find((face) => faceContainsPoint(face, { x: 25, y: 50 }))!;
    const right = before.find((face) => faceContainsPoint(face, { x: 75, y: 50 }))!;
    const painted: RegionStyle[] = [
      { key: left.id, fill: "solid", color: "#d4af37" },
      { key: right.id, fill: "solid", color: "#7c3aed" },
    ];

    // The user drags the divider 20px right — topology is recomputed.
    const after = extractFaces(paths(70));
    expect(after).toHaveLength(2);
    const remapped = remapRegionStyles(painted, after);

    expect(remapped).toHaveLength(2);
    // Paint stays at the same PLACE (left region is still gold), not at the
    // old coordinates.
    const goldKey = remapped.find((style) => style.color === "#d4af37")!.key;
    const goldFace = after.find((face) => face.id === goldKey)!;
    expect(goldFace).toBeDefined();
    expect(faceContainsPoint(goldFace, { x: 30, y: 50 })).toBe(true);
  });

  it("drops paint whose face no longer exists instead of leaving it stale", () => {
    const faces = extractFaces([rect("r", 0, 0, 100, 100)]);
    const stray: RegionStyle[] = [{ key: "ghost@9000,9000", fill: "solid", color: "#ffffff" }];
    expect(remapRegionStyles(stray, faces, 50)).toHaveLength(0);
  });

  it("round-trips region paint + settings through the document serializer", () => {
    const faces = extractFaces([rect("r", 0, 0, 100, 100), line("d", { x: 50, y: 0 }, { x: 50, y: 100 })]);
    const paint: RegionStyle[] = [
      { key: faces[0].id, fill: "linear", color: "#d4af37", color2: "#7c3aed", angle: 45, opacity: 0.8 },
      { key: faces[1].id, fill: "solid", color: "#7c3aed" },
    ];
    const document_: CardDocument = {
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#0d2342",
      layers: [],
      regions: paint,
      regionSettings: { gapTolerance: 4, fillRule: "evenodd" },
    };

    const reloaded = parseDocument(serializeDocument(document_));
    expect(reloaded?.regions).toEqual(paint);
    expect(reloaded?.regionSettings).toEqual({ gapTolerance: 4, fillRule: "evenodd" });
  });

  it("leaves documents without regions untouched (no empty arrays written)", () => {
    const document_: CardDocument = {
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#0d2342",
      layers: [],
    };
    const reloaded = parseDocument(serializeDocument(document_)) as CardDocument;
    expect("regions" in reloaded).toBe(false);
    expect("regionSettings" in reloaded).toBe(false);
  });

  it("builds regions straight from path layers via flattenSubPaths", () => {
    const square = resolvePathGeometry({
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
      closed: true,
    });
    const regions = buildRegions([{ id: "square", geometry: square }]);
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].area)).toBeCloseTo(6400, 6);
    expect(flattenSubPaths(square).length).toBe(1);
  });
});
