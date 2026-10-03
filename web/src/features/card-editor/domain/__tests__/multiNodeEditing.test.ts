import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer, type PathPoint } from "../document";
import {
  anchorsInRect,
  deleteAnchors,
  minimumAnchorCount,
  moveAnchorsBy,
  normalizeAnchorIndices,
  rectFromPoints,
  setAnchorTypes,
} from "../pathOps";

function anchor(x: number, y: number): PathPoint {
  return { x, y, hIn: null, hOut: null };
}

/** A square with handles on one anchor, so handle-rigidity is observable. */
function squarePoints(size = 100): PathPoint[] {
  return [
    { x: 0, y: 0, hIn: null, hOut: null },
    { x: size, y: 0, hIn: null, hOut: { x: size - 10, y: 0 } },
    { x: size, y: size, hIn: null, hOut: null },
    { x: 0, y: size, hIn: null, hOut: null },
  ];
}

function pathLayer(id: string, x: number, y: number, points: PathPoint[], overrides: Partial<PathLayer> = {}): PathLayer {
  return {
    id,
    kind: "path",
    x,
    y,
    width: 1,
    height: 1,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    z: 1,
    color: null,
    background: null,
    closed: false,
    points,
    stroke: "#0b1c33",
    strokeWidth: 2,
    fill: null,
    ...overrides,
  };
}

function docWith(...layers: PathLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

describe("multi-node primitives (pathOps)", () => {
  it("minimumAnchorCount: an open path needs 2, a closed one 3", () => {
    expect(minimumAnchorCount(false)).toBe(2);
    expect(minimumAnchorCount(true)).toBe(3);
  });

  it("normalizeAnchorIndices dedupes, sorts and drops out-of-range indices", () => {
    expect(normalizeAnchorIndices(4, [3, 1, 1, 9, -1, 2.5])).toEqual([1, 3]);
    expect(normalizeAnchorIndices(4, [2, 0, 2, 0])).toEqual([0, 2]);
  });

  it("moveAnchorsBy is rigid: handles travel with their anchor", () => {
    const points = squarePoints();
    const moved = moveAnchorsBy(points, [0, 1], 5, 7);
    expect(moved[1].x).toBe(105);
    expect(moved[1].y).toBe(7);
    expect(moved[1].hOut).toEqual({ x: 95, y: 7 });
    expect(moved[2].x).toBe(100); // untouched
  });

  it("moveAnchorsBy leaves the input list untouched", () => {
    const points = squarePoints();
    moveAnchorsBy(points, [0], 50, 50);
    expect(points[0]).toEqual({ x: 0, y: 0, hIn: null, hOut: null });
  });

  it("deleteAnchors removes the whole group in one pass", () => {
    const next = deleteAnchors(squarePoints(), false, [0, 2]);
    expect(next?.map((point) => [point.x, point.y])).toEqual([
      [100, 0],
      [0, 100],
    ]);
  });

  it("deleteAnchors refuses to destroy the shape", () => {
    expect(deleteAnchors(squarePoints(), false, [0, 1, 2])).toBeNull();
    expect(deleteAnchors(squarePoints(), true, [0, 1])).toBeNull();
  });

  it("anchorsInRect selects by hit target, in any marquee direction", () => {
    const points = squarePoints(100).map((point) => ({ ...point, x: point.x + 10, y: point.y + 10 }));
    // Points sit at (10,10) (110,10) (110,110) (10,110): a wide short rect catches the top row.
    expect(anchorsInRect(points, rectFromPoints({ x: -5, y: -5 }, { x: 120, y: 20 }))).toEqual([0, 1]);
    // Same rect drawn the other way — direction must not matter.
    expect(anchorsInRect(points, rectFromPoints({ x: 120, y: 20 }, { x: -5, y: -5 }))).toEqual([0, 1]);
    // Tolerance grows the rect (touch to select).
    expect(anchorsInRect(points, { x: 0, y: 0, width: 60, height: 5 }, 15)).toEqual([0]);
  });

  it("setAnchorTypes smooths a whole run at once", () => {
    const cornered = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }].map((point) => anchor(point.x, point.y));
    const smoothed = setAnchorTypes(cornered, false, [0, 1, 2], "smooth");
    expect(smoothed[1].hIn).not.toBeNull();
    expect(smoothed[1].hOut).not.toBeNull();
    expect(smoothed[1].hIn?.y).toBe(smoothed[1].hOut?.y); // collinear tangents
  });
});

describe("multi-node editing (engine)", () => {
  it("marquee selects nodes in artboard space and additive extends the group", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 100, 100, squarePoints())));
    engine.setSelectionDomain("node");
    engine.setPathEditing("p");

    // World nodes: (100,100) (200,100) (200,200) (100,200).
    expect(engine.selectAnchorsInRect({ x: 95, y: 95, width: 110, height: 15 })).toBe(2);
    expect(engine.anchorSelectionList()).toHaveLength(2);

    // Shift-drag adds nodes 2 and 3 to the group instead of replacing it.
    expect(engine.selectAnchorsInRect({ x: 95, y: 95, width: 15, height: 110 }, true)).toBe(2);
    expect(engine.anchorSelectionList()).toHaveLength(3);

    // A plain marquee on empty space clears the group.
    engine.selectAnchorsInRect({ x: 900, y: 900, width: 10, height: 10 });
    expect(engine.anchorSelectionList()).toHaveLength(0);
  });

  it("marquee hit-testing follows rotated path nodes", () => {
    const rotated = pathLayer("rotated", 200, 100, squarePoints(), {
      width: 100,
      height: 100,
      angle: 90,
    });
    const engine = new EditorEngine(docWith(rotated));
    engine.setPathEditing("rotated");

    // The first local node (0, 0) rotates around the path box center to (300, 100).
    expect(engine.selectAnchorsInRect({ x: 296, y: 96, width: 8, height: 8 })).toBe(1);
    expect(engine.selectedAnchorIndices("rotated")).toEqual([0]);
  });

  it("a whole-gesture group drag is exactly ONE undo record", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints())));
    engine.setSelectionDomain("node");
    engine.setPathEditing("p");
    engine.selectAllAnchors();

    const before = engine.getState().doc.layers[0] as PathLayer;
    const worldBefore = before.points.map((point) => [point.x + before.x, point.y + before.y]);

    engine.beginAnchorGesture();
    engine.transientMoveAnchors({ x: 3, y: 2 });
    engine.transientMoveAnchors({ x: 10, y: 5 });
    engine.transientMoveAnchors({ x: 20, y: 9 });
    engine.commitPathEdit("p");

    // Every commit re-origins the layer box, so WORLD positions are the contract.
    const after = engine.getState().doc.layers[0] as PathLayer;
    expect(after.points[0].x + after.x).toBe(20);
    expect(after.points[0].y + after.y).toBe(9);
    expect(engine.getState().canUndo).toBe(true);

    // Exactly ONE record: a single undo lands on the pre-gesture state (not on
    // an intermediate sample like (10,5)), and one redo returns to the result.
    engine.undo();
    const restored = engine.getState().doc.layers[0] as PathLayer;
    expect(restored.points.map((point) => [point.x + restored.x, point.y + restored.y])).toEqual(worldBefore);
    engine.redo();
    const redone = engine.getState().doc.layers[0] as PathLayer;
    expect(redone.points[0].x + redone.x).toBe(20);
  });

  it("the drag is a function of the total delta, not an accumulation of samples", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints())));
    engine.setPathEditing("p");
    engine.selectAnchor({ layerId: "p", index: 0 });

    engine.beginAnchorGesture();
    engine.transientMoveAnchors({ x: 100, y: 0 });
    engine.transientMoveAnchors({ x: 7, y: 0 }); // a later, smaller sample wins
    engine.commitPathEdit("p");

    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.points[0].x + layer.x).toBe(7);
  });

  it("snapping lands the primary node on a target and moves the group with it", () => {
    // Two shapes 10px apart horizontally; dragging the right one left should
    // click its edge onto the other's edge.
    const engine = new EditorEngine(
      docWith(
        pathLayer("a", 0, 0, [{ ...anchor(0, 0) }, { ...anchor(50, 0) }, { ...anchor(50, 50) }, { ...anchor(0, 50) }], { closed: true, fill: "#0891b2" }),
        pathLayer("b", 60, 0, [{ ...anchor(0, 0) }, { ...anchor(50, 0) }, { ...anchor(50, 50) }, { ...anchor(0, 50) }], { closed: true, fill: "#0891b2" }),
      ),
    );
    engine.setSelectionDomain("node");
    engine.setPathEditing("b");
    engine.selectAnchor({ layerId: "b", index: 0 });

    engine.beginAnchorGesture();
    // Unsnapped, node 0 of "b" would land at x = 70 - 15 = 55; the snap to
    // a's right edge (x=50) pulls it to exactly 0 (world) for that node.
    engine.transientMoveAnchors({ x: -15, y: 0 });
    engine.commitPathEdit("b");

    const layerB = engine.getState().doc.layers.find((layer) => layer.id === "b") as PathLayer;
    // Primary node must sit EXACTLY on the target edge, not 0.6px past it.
    expect(layerB.points[0].x + layerB.x).toBe(50);
  });

  it("deleteSelectedAnchors removes the group in one record and keeps a valid node", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints())));
    engine.setPathEditing("p");
    engine.selectAllAnchors();
    // Deselect two nodes so only 0 and 1 remain selected.
    engine.selectAnchor({ layerId: "p", index: 0 });
    engine.selectAnchor({ layerId: "p", index: 1 }, true);

    expect(engine.deleteSelectedAnchors()).toBe(true);
    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.points).toHaveLength(2);
    expect(layer.points.map((point) => [point.x + layer.x, point.y + layer.y])).toEqual([
      [100, 100],
      [0, 100],
    ]);
    // The primary selection survives on a still-existing node.
    expect(engine.getState().selectedAnchor).toEqual({ layerId: "p", index: 0 });

    engine.undo();
    expect((engine.getState().doc.layers[0] as PathLayer).points).toHaveLength(4);
  });

  it("deleteSelectedAnchors refuses to go below the minimum anchor count", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints(), { closed: true })));
    engine.setPathEditing("p");
    engine.selectAllAnchors();
    expect(engine.deleteSelectedAnchors()).toBe(false);
    expect((engine.getState().doc.layers[0] as PathLayer).points).toHaveLength(4);
  });

  it("sets an anchor at an exact artboard position on a rotated path", () => {
    const engine = new EditorEngine(
      docWith(pathLayer("p", 100, 80, squarePoints(), { width: 100, height: 100, angle: 90 })),
    );
    engine.setPathEditing("p");

    expect(engine.setAnchorWorldPosition("p", 0, { x: 310, y: 220 })).toBe(true);
    const layer = engine.getState().doc.layers[0] as PathLayer;
    const point = layer.points[0];
    const angle = ((layer.angle ?? 0) * Math.PI) / 180;
    const dx = point.x - layer.width / 2;
    const dy = point.y - layer.height / 2;
    expect(layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle)).toBeCloseTo(310);
    expect(layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)).toBeCloseTo(220);
  });

  it("sets a node tangent to the requested world angle and length", () => {
    const engine = new EditorEngine(
      docWith(pathLayer("p", 100, 80, squarePoints(), { width: 100, height: 100, angle: 30 })),
    );
    engine.setPathEditing("p");
    const before = engine.getState().doc.layers[0] as PathLayer;
    const beforePoint = before.points[1];
    const beforeAngle = ((before.angle ?? 0) * Math.PI) / 180;
    const beforeDx = beforePoint.x - before.width / 2;
    const beforeDy = beforePoint.y - before.height / 2;
    const worldX = before.x + before.width / 2 + beforeDx * Math.cos(beforeAngle) - beforeDy * Math.sin(beforeAngle);
    const worldY = before.y + before.height / 2 + beforeDx * Math.sin(beforeAngle) + beforeDy * Math.cos(beforeAngle);

    expect(engine.setAnchorTangent("p", 1, 90, 25)).toBe(true);
    const layer = engine.getState().doc.layers[0] as PathLayer;
    const point = layer.points[1];
    const nodeAngle = ((layer.angle ?? 0) * Math.PI) / 180;
    const nodeDx = point.x - layer.width / 2;
    const nodeDy = point.y - layer.height / 2;
    expect(layer.x + layer.width / 2 + nodeDx * Math.cos(nodeAngle) - nodeDy * Math.sin(nodeAngle)).toBeCloseTo(worldX);
    expect(layer.y + layer.height / 2 + nodeDx * Math.sin(nodeAngle) + nodeDy * Math.cos(nodeAngle)).toBeCloseTo(worldY);
    const handle = point.hOut!;
    const localAngle = ((layer.angle ?? 0) * Math.PI) / 180;
    const dx = handle.x - point.x;
    const dy = handle.y - point.y;
    const worldDx = dx * Math.cos(localAngle) - dy * Math.sin(localAngle);
    const worldDy = dx * Math.sin(localAngle) + dy * Math.cos(localAngle);
    expect(Math.hypot(worldDx, worldDy)).toBeCloseTo(25);
    expect(Math.atan2(worldDy, worldDx) * 180 / Math.PI).toBeCloseTo(90);
  });

  it("creates an exact path reflection across an arbitrary axis", () => {
    const source = pathLayer(
      "p",
      100,
      80,
      [
        { x: 10, y: 20, hIn: { x: 7, y: 15 }, hOut: { x: 14, y: 25 } },
        { x: 70, y: 60, hIn: { x: 65, y: 55 }, hOut: { x: 75, y: 65 } },
      ],
      { width: 100, height: 100 },
    );
    const engine = new EditorEngine(docWith(source));
    engine.setPathEditing("p");

    const id = engine.duplicateMirroredPathAcrossAxis("p", { x: 180, y: 0 }, { x: 180, y: 300 });
    expect(id).not.toBeNull();
    const copy = engine.getState().doc.layers.find((layer) => layer.id === id) as PathLayer;
    expect(copy.points).toHaveLength(2);
    expect(copy.points[0].x + copy.x).toBeCloseTo(2 * 180 - (source.x + source.points[0].x));
    expect(copy.points[0].y + copy.y).toBeCloseTo(source.y + source.points[0].y);
    expect(copy.points[0].hOut!.x + copy.x).toBeCloseTo(2 * 180 - (source.x + source.points[0].hOut!.x));
    expect(engine.getState().selection.layerId).toBe(id);
  });

  it("rejects a degenerate mirror axis", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints())));
    expect(engine.duplicateMirroredPathAcrossAxis("p", { x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(1);
  });

  it("dragging a straight segment creates Bezier handles and bends the path", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, [anchor(0, 0), anchor(100, 0)])));
    engine.setPathEditing("p");
    engine.beginTransient();
    engine.transientDragSegment("p", 0, 0, -25);
    engine.commitPathEdit("p");

    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.points[0].hOut).not.toBeNull();
    expect(layer.points[1].hIn).not.toBeNull();
    expect(layer.points[0].hOut!.y).toBeLessThan(layer.points[0].y);
    expect(layer.points[1].hIn!.y).toBeLessThan(layer.points[1].y);
  });

  it("setSelectedAnchorType converts the whole group (smooth / corner)", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, squarePoints())));
    engine.setPathEditing("p");
    engine.selectAllAnchors();
    engine.setSelectedAnchorType("smooth");
    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.points.every((point) => point.hIn || point.hOut)).toBe(true);

    engine.setSelectedAnchorType("corner");
    const cornered = engine.getState().doc.layers[0] as PathLayer;
    expect(cornered.points.every((point) => !point.hIn && !point.hOut)).toBe(true);
  });

  it("insertAnchorNearest splits the touched segment without moving the curve", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, [{ ...anchor(0, 0) }, { ...anchor(100, 0) }])));
    engine.setPathEditing("p");
    const index = engine.insertAnchorNearest("p", { x: 50, y: 0 }, 5);
    expect(index).toBe(1);
    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.points).toHaveLength(3);
    expect(layer.points[1].x + layer.x).toBe(50);
    // The geometry is untouched: the two end anchors are exactly where they were.
    expect(layer.points[0].x + layer.x).toBe(0);
    expect(layer.points[2].x + layer.x).toBe(100);
    expect(engine.getState().selectedAnchor).toEqual({ layerId: "p", index: 1 });
  });

  it("insertAnchorNearest ignores clicks far from the path", () => {
    const engine = new EditorEngine(docWith(pathLayer("p", 0, 0, [{ ...anchor(0, 0) }, { ...anchor(100, 0) }])));
    expect(engine.insertAnchorNearest("p", { x: 50, y: 40 }, 5)).toBeNull();
    expect((engine.getState().doc.layers[0] as PathLayer).points).toHaveLength(2);
  });
});
