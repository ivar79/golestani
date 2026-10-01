import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer, type PathPoint } from "../document";
import {
  autoCloseWithinTolerance,
  breakPathAt,
  constrainToAngle,
  extendPath,
  joinPointLists,
  nearestAnchor,
  reshapePath,
  reversePoints,
  snapToTargets,
} from "../pathOps";
import { resolveLayerPathD } from "../path";
import { parsePathData } from "../geometry/pathData";

/**
 * Direction-independent signature of a path string: the same cubic is written
 * `p0 c1 c2 p1` forward and `p1 c2 c1 p0` in reverse, so each segment collapses
 * to its SORTED four control points and the segments themselves are sorted too.
 * Same signature ⇒ same drawn curve.
 */
function segmentSignature(d: string): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const segments = parsePathData(d).flatMap((sub) =>
    sub.segments.map((segment) =>
      [segment.p0, segment.c1, segment.c2, segment.p1]
        .map((point) => `${round(point.x)},${round(point.y)}`)
        .sort()
        .join(" "),
    ),
  );
  return segments.sort().join("|");
}

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

/** A 3-anchor open polyline with handles on the middle anchor. */
function samplePath(): PathPoint[] {
  return [
    { x: 0, y: 0, hIn: null, hOut: null },
    { x: 100, y: 40, hIn: { x: 80, y: 40 }, hOut: { x: 120, y: 40 } },
    { x: 200, y: 0, hIn: null, hOut: null },
  ];
}

describe("pen path surgery (pure)", () => {
  it("reverse swaps the handles with their anchors and is its own inverse", () => {
    const points = samplePath();
    const reversed = reversePoints(points);
    expect(reversed.map((p) => p.x)).toEqual([200, 100, 0]);
    expect(reversed[1].hIn).toEqual({ x: 120, y: 40 });
    expect(reversed[1].hOut).toEqual({ x: 80, y: 40 });
    expect(reversePoints(reversed)).toEqual(points);
  });

  it("joins the CLOSEST pair of ends and drops the duplicated weld anchor", () => {
    const a = samplePath();
    const b: PathPoint[] = [
      { x: 205, y: 5, hIn: null, hOut: null },
      { x: 300, y: 30, hIn: null, hOut: null },
    ];
    const joined = joinPointLists(a, b, 8);
    expect(joined).not.toBeNull();
    expect(joined!.connection).toBe("a-end→b-start");
    expect(joined!.points).toHaveLength(4); // 3 + 2 - the weld node
    expect(joined!.points[2].x).toBe(200);

    // The same two paths with the second one reversed are still joined.
    const flipped = joinPointLists(a, reversePoints(b), 8);
    expect(flipped?.connection).toBe("a-end→b-end");
    expect(flipped?.points[flipped.points.length - 1].x).toBe(300);

    // Reversing the FIRST path makes its start the closest end.
    const reversedFirst = joinPointLists(reversePoints(a), b, 8);
    expect(reversedFirst?.connection).toBe("a-start→b-start");
  });

  it("refuses to join paths whose ends are far apart", () => {
    const a = samplePath();
    const far: PathPoint[] = [
      { x: 900, y: 400, hIn: null, hOut: null },
      { x: 950, y: 420, hIn: null, hOut: null },
    ];
    expect(joinPointLists(a, far, 8)).toBeNull();
  });

  it("breaks an open path into two, and refuses to break at an end", () => {
    const broken = breakPathAt(samplePath(), false, 1);
    expect(broken).not.toBeNull();
    expect(broken!.first.map((p) => p.x)).toEqual([0, 100]);
    expect(broken!.second.map((p) => p.x)).toEqual([100, 200]);
    expect(broken!.first[1].hOut).toEqual({ x: 120, y: 40 });
    expect(broken!.second[0].hIn).toEqual({ x: 80, y: 40 });
    expect(breakPathAt(samplePath(), false, 0)).toBeNull();
    expect(breakPathAt(samplePath(), false, 2)).toBeNull();
  });

  it("breaks a closed path into ONE open path whose ends are the break node", () => {
    const square: PathPoint[] = [
      { x: 0, y: 0, hIn: null, hOut: null },
      { x: 10, y: 0, hIn: null, hOut: null },
      { x: 10, y: 10, hIn: null, hOut: null },
      { x: 0, y: 10, hIn: null, hOut: null },
    ];
    const broken = breakPathAt(square, true, 2)!;
    expect(broken.second).toEqual([]);
    expect(broken.first[0]).toMatchObject({ x: 10, y: 10, hIn: null });
    const last = broken.first[broken.first.length - 1];
    expect(last).toMatchObject({ x: 10, y: 10, hOut: null });
    // Every original corner survives exactly once (plus the duplicated break node).
    expect(broken.first).toHaveLength(5);
  });

  it("auto-close only connects ends that are already touching", () => {
    const near: PathPoint[] = [
      { x: 0, y: 0, hIn: null, hOut: null },
      { x: 50, y: 0, hIn: null, hOut: null },
      { x: 50, y: 50, hIn: null, hOut: null },
      { x: 2, y: 2, hIn: null, hOut: null },
    ];
    const closed = autoCloseWithinTolerance(near, 6);
    expect(closed).not.toBeNull();
    expect(closed).toHaveLength(3);
    expect(autoCloseWithinTolerance(near, 1)).toBeNull();
  });

  it("finds the nearest anchor only inside the tolerance", () => {
    const points = samplePath();
    expect(nearestAnchor(points, { x: 102, y: 41 }, 6)?.index).toBe(1);
    expect(nearestAnchor(points, { x: 102, y: 41 }, 1)).toBeNull();
  });

  it("snaps to another path's node or keeps the raw point", () => {
    const targets = [{ x: 100, y: 100, id: "a#0" }];
    expect(snapToTargets({ x: 103, y: 102 }, targets, 6)).toMatchObject({
      snapped: true,
      point: { x: 100, y: 100 },
    });
    const miss = snapToTargets({ x: 200, y: 200 }, targets, 6);
    expect(miss.snapped).toBe(false);
    expect(miss.point).toEqual({ x: 200, y: 200 });
  });

  it("axis lock wins over angle snapping, and increments produce exact angles", () => {
    const horizontal = constrainToAngle({ x: 0, y: 0 }, { x: 120, y: 4 }, { increments: [45], tolerance: 5 });
    expect(horizontal.axis).toBe("x");
    expect(horizontal.y).toBe(0);

    const diagonal = constrainToAngle({ x: 0, y: 0 }, { x: 103, y: 96 }, { increments: [45], tolerance: 5 });
    expect(diagonal.snapped).toBe(true);
    expect(diagonal.angle).toBe(45);
    expect(diagonal.x).toBeCloseTo(diagonal.y, 6);

    const untouched = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 30 }, { increments: [45], tolerance: 2, axisLock: false });
    expect(untouched.snapped).toBe(false);
    expect(untouched.angle).toBeCloseTo(16.7, 1);
  });

  it("extends a path at whichever end is closest, and refuses far runs", () => {
    const points = samplePath();
    const run: PathPoint[] = [
      { x: 204, y: 6, hIn: null, hOut: null },
      { x: 260, y: 40, hIn: null, hOut: null },
    ];
    const extended = extendPath(points, run, 10)!;
    expect(extended.at(-1)!.x).toBe(260);
    expect(extended).toHaveLength(4);

    const atStart = extendPath(points, reversePoints(run).map((p) => ({ ...p, x: p.x - 258, y: p.y - 44 })), 10);
    expect(atStart).not.toBeNull();
    expect(atStart![0].x).toBeLessThan(0);

    expect(extendPath(points, [{ x: 800, y: 800, hIn: null, hOut: null }, { x: 900, y: 900, hIn: null, hOut: null }], 10)).toBeNull();
  });

  it("reshapes a middle run while keeping the untouched anchors and handles", () => {
    const points = samplePath();
    const replacement: PathPoint[] = [
      { x: 60, y: -30, hIn: null, hOut: null },
      { x: 140, y: -30, hIn: null, hOut: null },
    ];
    const reshaped = reshapePath(points, 0, 1, replacement)!;
    expect(reshaped[0]).toMatchObject({ x: 60, y: -30 });
    expect(reshaped.at(-1)!.x).toBe(200); // the untouched tail anchor survives
    expect(reshapePath(points, 1, 1, replacement)).toBeNull();
  });
});

describe("pen path surgery in the engine", () => {
  function pathEngine(): { engine: EditorEngine; id: string } {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 300, amplitude: 40 });
    engine.convertCurveToPath(id);
    return { engine, id };
  }

  it("reversePath keeps the drawn geometry identical", () => {
    const { engine, id } = pathEngine();
    const before = engine.snapshot().doc.layers[0] as PathLayer;
    const forwardD = resolveLayerPathD(before);
    engine.reversePath(id);
    const after = engine.snapshot().doc.layers[0] as PathLayer;
    expect(after.points.map((p) => p.x)).toEqual(before.points.map((p) => p.x).reverse());
    // Reversing only re-orders the parameter direction: the two path strings must
    // describe the very same set of cubic segments.
    expect(segmentSignature(resolveLayerPathD(after))).toEqual(segmentSignature(forwardD));
  });

  it("breakPathAtAnchor splits an open path into two layers", () => {
    const { engine, id } = pathEngine();
    const before = engine.snapshot().doc.layers.length;
    const ids = engine.breakPathAtAnchor(id, 2);
    expect(ids).toEqual([id, expect.any(String)]);
    const doc = engine.snapshot().doc;
    expect(doc.layers).toHaveLength(before + 1);
    expect((doc.layers[0] as PathLayer).points.length).toBe(3);
    engine.undo();
    expect(engine.snapshot().doc.layers).toHaveLength(before);
  });

  it("joinPaths merges two open paths into one layer", () => {
    const { engine, id } = pathEngine();
    const [, secondId] = engine.breakPathAtAnchor(id, 2) as string[];
    expect(secondId).not.toBe(id);
    const before = engine.snapshot().doc.layers.length;
    const joined = engine.joinPaths(id, secondId);
    expect(joined).toBe(id);
    expect(engine.snapshot().doc.layers).toHaveLength(before - 1);
    expect(engine.selectedIds()).toEqual([id]);
  });

  it("continuePathFrom writes the continued run back into the SAME layer", () => {
    const { engine, id } = pathEngine();
    const before = engine.snapshot().doc.layers.length;
    const start = (engine.snapshot().doc.layers[0] as PathLayer).points.at(-1)!;
    expect(engine.continuePathFrom(id, "end")).toBe(true);
    engine.penAddAnchor({ x: start.x + 60, y: start.y - 40 });
    engine.finishPen(false);

    const doc = engine.snapshot().doc;
    expect(doc.layers).toHaveLength(before); // no duplicate layer
    const layer = doc.layers[0] as PathLayer;
    expect(layer.points.length).toBeGreaterThan(3);
    expect(engine.selectedIds()).toEqual([id]);
  });

  it("a closed path cannot be continued and is not joinable", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 200 });
    engine.convertCurveToPath(id);
    engine.setPathClosed(id, true);
    expect(engine.continuePathFrom(id, "end")).toBe(false);
  });

  it("snapping considers every other visible path's anchors", () => {
    const engine = new EditorEngine(emptyDoc());
    const first = engine.addCurve("sine", { length: 200, amplitude: 20 });
    engine.convertCurveToPath(first);
    const anchor = (engine.snapshot().doc.layers[0] as PathLayer).points[1];
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    const world = { x: anchor.x + layer.x + 2, y: anchor.y + layer.y - 3 };
    const snapped = engine.snapPoint(world, 8);
    expect(snapped.snapped).toBe(true);
    expect(snapped.target).not.toBeNull();
  });
});
