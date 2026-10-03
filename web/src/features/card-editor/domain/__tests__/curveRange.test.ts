import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

function path(engine: EditorEngine, id: string): PathLayer {
  const layer = engine.snapshot().doc.layers.find((item) => item.id === id);
  if (!layer || layer.kind !== "path") throw new Error("expected a path layer");
  return layer;
}

function worldPoint(layer: PathLayer, index: number) {
  const point = layer.points[index];
  return { x: layer.x + point.x, y: layer.y + point.y };
}

function worldHandle(
  layer: PathLayer,
  index: number,
  which: "hIn" | "hOut",
) {
  const handle = layer.points[index][which];
  return handle ? { x: layer.x + handle.x, y: layer.y + handle.y } : null;
}

function expectPointClose(
  actual: { x: number; y: number } | null,
  expected: { x: number; y: number } | null,
) {
  if (!actual || !expected) {
    expect(actual).toEqual(expected);
    return;
  }
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("partial curve application", () => {
  it("changes only the selected anchor range and preserves both boundary anchors", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 520, amplitude: 65, nodes: 9 });
    const before = path(engine, id);
    const unchangedIndices = [0, 1, 7, 8];
    const unchanged = unchangedIndices.map((index) => ({
      point: worldPoint(before, index),
      hIn: worldHandle(before, index, "hIn"),
      hOut: worldHandle(before, index, "hOut"),
    }));
    const start = worldPoint(before, 2);
    const end = worldPoint(before, 6);

    expect(engine.applyCurveToRange(id, 2, 6, "arc", 100)).toBe(true);

    const after = path(engine, id);
    unchangedIndices.forEach((index, i) => {
      expectPointClose(worldPoint(after, index), unchanged[i].point);
      expectPointClose(worldHandle(after, index, "hIn"), unchanged[i].hIn);
      expectPointClose(worldHandle(after, index, "hOut"), unchanged[i].hOut);
    });
    expectPointClose(worldPoint(after, 2), start);
    expectPointClose(worldPoint(after, 6), end);
    expect(worldPoint(after, 4)).not.toEqual(worldPoint(before, 4));
    expect(after.curve).toBeUndefined();
  });

  it("uses Shift-click to mark a start and then an end anchor", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { nodes: 5 });
    engine.setPathEditing(id);

    engine.selectAnchor({ layerId: id, index: 1 }, true);
    expect(engine.getState().curveRangeStart).toEqual({ layerId: id, index: 1 });
    expect(engine.getState().selectedAnchor).toEqual({ layerId: id, index: 1 });

    engine.selectAnchor({ layerId: id, index: 4 }, true);
    expect(engine.getState().curveRangeStart).toEqual({ layerId: id, index: 1 });
    expect(engine.getState().selectedAnchor).toEqual({ layerId: id, index: 4 });
    expect(engine.getState().anchorSelection).toEqual([{ layerId: id, index: 4 }]);
  });

  it("rejects a degenerate or invalid range without changing the path", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { nodes: 5 });
    const before = path(engine, id);

    expect(engine.applyCurveToRange(id, 2, 2, "arc")).toBe(false);
    expect(engine.applyCurveToRange(id, -1, 2, "arc")).toBe(false);
    expect(engine.applyCurveToRange(id, 0, 4, "custom")).toBe(false);
    expect(path(engine, id)).toEqual(before);
  });
});
