import { describe, expect, it } from "vitest";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import { EditorEngine } from "../../engine/EditorEngine";

function pathDoc(): CardDocument {
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [
      {
        id: "p1",
        kind: "path",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        color: null,
        background: null,
        closed: false,
        fill: null,
        stroke: "#0ea5e9",
        strokeWidth: 4,
        points: [
          { x: 10, y: 10, hIn: null, hOut: null },
          { x: 110, y: 10, hIn: null, hOut: null },
          { x: 110, y: 60, hIn: null, hOut: null },
        ],
      },
    ],
  };
}

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

function pathLayer(engine: EditorEngine, id: string): PathLayer {
  const layer = engine.getState().doc.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== "path") throw new Error(`no path layer ${id}`);
  return layer;
}

/** A point's position in ARTBOARD coordinates (what the user actually sees). */
function worldOf(engine: EditorEngine, id: string, index: number): { x: number; y: number } {
  const layer = pathLayer(engine, id);
  const point = layer.points[index];
  return { x: layer.x + point.x, y: layer.y + point.y };
}

describe("pen tool", () => {
  it("commits anchors as ONE path layer with one history record", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    expect(engine.getState().tool).toBe("pen");

    engine.penStart({ x: 100, y: 100 });
    engine.penAddAnchor({ x: 200, y: 100 });
    engine.penAddAnchor({ x: 200, y: 200 });
    const id = engine.finishPen(false);
    expect(id).not.toBeNull();

    const layer = pathLayer(engine, id!);
    expect(layer.points).toHaveLength(3);
    expect(layer.closed).toBe(false);
    // The draft is consumed and the tool returns to select so the new curve is
    // immediately editable.
    expect(engine.getState().penDraft).toBeNull();
    expect(engine.getState().tool).toBe("select");
    expect(engine.getState().selection.layerId).toBe(id);
    expect(engine.getState().editingPathId).toBe(id);

    // The world position of every anchor survives the box normalisation.
    expect(worldOf(engine, id!, 0)).toEqual({ x: 100, y: 100 });
    expect(worldOf(engine, id!, 2)).toEqual({ x: 200, y: 200 });

    // ONE undo removes the whole stroke.
    engine.undo();
    expect(engine.getState().doc.layers).toHaveLength(0);
    engine.redo();
    expect(engine.getState().doc.layers).toHaveLength(1);
  });

  it("carries the brush stroke settings onto the committed curve", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.setBrushColor("#e11d48");
    engine.setBrushWidth(12);
    engine.setBrushStroke({ style: "dashed", linecap: "square", linejoin: "bevel", opacity: 0.5 });

    engine.penStart({ x: 0, y: 0 });
    engine.penAddAnchor({ x: 200, y: 0 });
    const id = engine.finishPen(false)!;

    expect(pathLayer(engine, id)).toMatchObject({
      stroke: "#e11d48",
      strokeWidth: 12,
      strokeStyle: "dashed",
      strokeLinecap: "square",
      strokeLinejoin: "bevel",
      strokeOpacity: 0.5,
    });
  });

  it("only closes a path that has enough anchors", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.penStart({ x: 0, y: 0 });
    engine.penAddAnchor({ x: 100, y: 0 });
    const twoPoint = engine.finishPen(true)!;
    expect(pathLayer(engine, twoPoint).closed).toBe(false);

    engine.setTool("pen");
    engine.penStart({ x: 0, y: 0 });
    engine.penAddAnchor({ x: 100, y: 0 });
    engine.penAddAnchor({ x: 50, y: 80 });
    const triangle = engine.finishPen(true)!;
    expect(pathLayer(engine, triangle).closed).toBe(true);
  });

  it("click-and-drag pulls mirrored handles out of the anchor", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.penStart({ x: 100, y: 100 });
    engine.penDragHandle({ x: 160, y: 100 });

    const draft = engine.getState().penDraft!;
    expect(draft[0].hOut).toEqual({ x: 160, y: 100 });
    expect(draft[0].hIn).toEqual({ x: 40, y: 100 });

    engine.penAddAnchor({ x: 300, y: 100 });
    const id = engine.finishPen(false)!;
    // Normalisation moves the layer origin, so the meaningful invariant is the
    // handle's OFFSET from its anchor (mirrored, 60px each side).
    const anchor = pathLayer(engine, id).points[0];
    expect(anchor.hOut!.x - anchor.x).toBeCloseTo(60, 6);
    expect(anchor.hIn!.x - anchor.x).toBeCloseTo(-60, 6);
  });

  it("a one-anchor draft is dropped without touching the document", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.penStart({ x: 10, y: 10 });
    expect(engine.finishPen(false)).toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(0);
    expect(engine.getState().penDraft).toBeNull();
  });

  it("cancelPen drops the draft and leaves no trace", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.penStart({ x: 10, y: 10 });
    engine.penAddAnchor({ x: 50, y: 10 });
    engine.cancelPen();
    expect(engine.getState().penDraft).toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(0);
  });

  it("switching tools cancels an unfinished draft", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.penStart({ x: 10, y: 10 });
    engine.setTool("select");
    expect(engine.getState().penDraft).toBeNull();
  });
});

describe("path point editing", () => {
  it("a point drag records exactly ONE history entry and keeps the anchor where it was dropped", () => {
    const engine = new EditorEngine(pathDoc());
    const before = worldOf(engine, "p1", 0);

    engine.transientMoveAnchor("p1", 0, { x: 210, y: 310 });
    engine.transientMoveAnchor("p1", 0, { x: 220, y: 320 });
    engine.commitPathEdit("p1");

    expect(worldOf(engine, "p1", 0)).toEqual({ x: 320, y: 420 });

    engine.undo();
    expect(worldOf(engine, "p1", 0).x).toBeCloseTo(before.x, 6);
    expect(worldOf(engine, "p1", 0).y).toBeCloseTo(before.y, 6);
  });

  it("re-derives the layer box onto the new geometry after a drag", () => {
    const engine = new EditorEngine(pathDoc());
    engine.transientMoveAnchor("p1", 0, { x: 10, y: 10 });
    engine.transientMoveAnchor("p1", 1, { x: 300, y: 10 });
    engine.commitPathEdit("p1");

    const layer = pathLayer(engine, "p1");
    // Padding = strokeWidth/2 + 2 = 4.
    expect(layer.width).toBeCloseTo(300 - 10 + 8, 6);
    expect(layer.points[1].x - layer.points[0].x).toBeCloseTo(290, 6);
  });

  it("a handle drag mirrors the opposite handle by default and breaks with Alt", () => {
    const engine = new EditorEngine(pathDoc());
    engine.transientMoveHandle("p1", 0, "hOut", { x: 100, y: 10 }, true);
    engine.commitPathEdit("p1");
    const smoothed = pathLayer(engine, "p1").points[0];
    // Symmetric: the two handles are mirrored about the anchor.
    expect(smoothed.hOut!.x - smoothed.x).toBeCloseTo(90, 6);
    expect(smoothed.hIn!.x - smoothed.x).toBeCloseTo(-90, 6);
    expect(smoothed.hIn!.y).toBeCloseTo(smoothed.y, 6);

    engine.transientMoveHandle("p1", 0, "hIn", { x: 5, y: 10 }, false);
    engine.commitPathEdit("p1");
    const broken = pathLayer(engine, "p1").points[0];
    // Alt breaks the link: the outgoing handle stays exactly where it was.
    expect(broken.hIn!.x - broken.x).toBeCloseTo(1, 6);
    expect(broken.hOut!.x - broken.x).toBeCloseTo(90, 6);
  });

  it("a drag that changes nothing records no history", () => {
    const engine = new EditorEngine(pathDoc());
    engine.transientMoveAnchor("p1", 0, { x: 10, y: 10 });
    engine.commitPathEdit("p1");
    const snapshot = JSON.stringify(engine.getState().doc);
    engine.commitPathEdit("p1");
    expect(JSON.stringify(engine.getState().doc)).toBe(snapshot);
  });

  it("inserts an anchor on a segment as one undoable step", () => {
    const engine = new EditorEngine(pathDoc());
    engine.insertAnchorAt("p1", 0, 0.5);
    const layer = pathLayer(engine, "p1");
    expect(layer.points).toHaveLength(4);
    // The midpoint of a straight segment lands exactly halfway.
    const [a, , b] = layer.points;
    expect(layer.points[1].x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(engine.getState().selectedAnchor).toEqual({ layerId: "p1", index: 1 });

    engine.undo();
    expect(pathLayer(engine, "p1").points).toHaveLength(3);
  });

  it("removes an anchor but never below the minimum point count", () => {
    const engine = new EditorEngine(pathDoc());
    engine.removeAnchorAt("p1", 0);
    expect(pathLayer(engine, "p1").points).toHaveLength(2);
    engine.removeAnchorAt("p1", 0);
    expect(pathLayer(engine, "p1").points).toHaveLength(2);
  });

  it("closes and re-opens a path", () => {
    const engine = new EditorEngine(pathDoc());
    engine.setPathClosed("p1", true);
    expect(pathLayer(engine, "p1").closed).toBe(true);
    engine.undo();
    expect(pathLayer(engine, "p1").closed).toBe(false);
  });

  it("refuses to edit a locked path", () => {
    const engine = new EditorEngine(pathDoc());
    engine.toggleLocked("p1");
    const snapshot = JSON.stringify(engine.getState().doc);
    engine.transientMoveAnchor("p1", 0, { x: 999, y: 999 });
    engine.removeAnchorAt("p1", 0);
    expect(JSON.stringify(engine.getState().doc)).toBe(snapshot);
  });
});

describe("addShape", () => {
  it("gives a line a REAL stroke width instead of deriving it from the box", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addShape("line");
    const layer = engine.getState().doc.layers.find((l) => l.id === id)!;
    expect(layer).toMatchObject({ kind: "shape", shape: "line", strokeWidth: 4, stroke: "#0b1c33" });
  });

  it("gives a polygon a vertex count and other shapes a fill", () => {
    const engine = new EditorEngine(emptyDoc());
    const polygonId = engine.addShape("polygon");
    expect(engine.getState().doc.layers.find((l) => l.id === polygonId)).toMatchObject({ sides: 6, background: "#0ea5e9" });

    const rectId = engine.addShape("rect");
    expect(engine.getState().doc.layers.find((l) => l.id === rectId)).toMatchObject({ radius: 12, strokeWidth: 0 });
  });
});
