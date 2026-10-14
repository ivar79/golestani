import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import { pathD } from "../path";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}
const strokeOptions = { color: "#123456", width: 8, opacity: 1, style: "solid" as const, linecap: "round" as const, linejoin: "round" as const };

describe("drafting tool engine behavior", () => {
  it("commits a straightedge stroke as exactly two editable anchors and keeps draw active", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.commitStraightStroke({ x: 20, y: 30 }, { x: 180, y: 30 }, strokeOptions);
    expect(id).toBeTruthy();
    const layer = engine.getState().doc.layers.find(item => item.id === id) as PathLayer;
    expect(layer.kind).toBe("path");
    expect(layer.closed).toBe(false);
    expect(layer.points).toHaveLength(2);
    expect(engine.getState().tool).toBe("draw");
    expect(engine.getState().selection.layerId).toBe(id);
    expect(engine.getState().editingPathId).toBe(id);
  });

  it("commits exactly the editable geometry prepared for the freehand preview", () => {
    const engine = new EditorEngine(emptyDoc());
    const outline = [
      [10, 10], [24, 6], [40, 10], [48, 24], [40, 38], [24, 42], [10, 34], [4, 22],
    ];
    const geometry = engine.freehandOutlineGeometry(outline, 0.9)!;
    const id = engine.commitFreehandOutline(outline, { color: "#123456", width: 12, fidelity: 0.9 });
    const layer = engine.getState().doc.layers.find(item => item.id === id) as PathLayer;
    expect(layer.points).toEqual(geometry.points);
    expect(layer.x).toBe(geometry.x);
    expect(layer.y).toBe(geometry.y);
    expect(pathD(layer.points, true)).toBe(pathD(geometry.points, true));
    expect(layer.closed).toBe(true);
    expect(engine.getState().editingPathId).toBe(id);
    expect(engine.getState().tool).toBe("draw");
  });

  it("commits a tap as a visible editable circular path dab", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.commitFreehandDot({ x: 50, y: 60 }, strokeOptions);
    const layer = engine.getState().doc.layers.find(item => item.id === id) as PathLayer;
    expect(layer.kind).toBe("path");
    expect(layer.closed).toBe(true);
    expect(layer.points).toHaveLength(4);
    expect(layer.width).toBeCloseTo(layer.height);
    expect(engine.getState().tool).toBe("draw");
    expect(engine.getState().editingPathId).toBe(id);
  });

  it("keeps drafting aids out of the saved document and preserves locked aids on clear", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setRulers(true);
    engine.addGuide("x", 80);
    const guide = engine.getState().guides[0];
    engine.toggleGuideLock(guide.id);
    engine.clearGuides();
    expect(engine.getState().guides.map(g => g.id)).toEqual([guide.id]);
    expect(engine.getState().doc).not.toHaveProperty("guides");

    const squareId = engine.addSetSquare();
    expect(squareId).toBeTruthy();
    engine.toggleSetSquareLock(squareId!);
    engine.clearSetSquares();
    expect(engine.getState().setSquares.map(s => s.id)).toEqual([squareId]);
    expect(engine.getState().doc).not.toHaveProperty("setSquares");
  });

  it("pins an angle-dial guide and reuses an existing coincident line", () => {
    const engine = new EditorEngine(emptyDoc());
    expect(engine.addLockedAngledGuide(45, { x: 80, y: 80 })).toBe(true);
    expect(engine.getState().guides).toHaveLength(1);
    expect(engine.getState().guides[0].locked).toBe(true);
    const before = { ...engine.getState().guides[0] };
    expect(engine.addLockedAngledGuide(225, { x: 100, y: 100 })).toBe(true);
    expect(engine.getState().guides).toHaveLength(1);
    expect(engine.getState().guides[0]).toMatchObject({ id: before.id, x: before.x, y: before.y, locked: true });
  });

  it("adds straightedge Pen vertices without curvature smoothing and can drag them along the edge", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("pen");
    engine.setPenMode("curvature");
    engine.penStart({ x: 10, y: 10 });
    engine.penAddAnchor({ x: 20, y: 20 });
    engine.penAddStraightAnchor({ x: 30, y: 40 });
    let draft = engine.getState().penDraft!;
    expect(draft).toHaveLength(3);
    expect(draft[1].hOut).toBeNull();
    expect(draft[2].hIn).toBeNull();
    expect(draft[2].hOut).toBeNull();

    engine.penMoveLastAnchor({ x: 50, y: 60 });
    draft = engine.getState().penDraft!;
    expect(draft[2]).toMatchObject({ x: 50, y: 60, hIn: null, hOut: null });
    expect(engine.getState().tool).toBe("pen");
  });

  it("enforces the four-set-square cap", () => {
    const engine = new EditorEngine(emptyDoc());
    expect(engine.addSetSquare()).toBeTruthy();
    expect(engine.addSetSquare()).toBeTruthy();
    expect(engine.addSetSquare()).toBeTruthy();
    expect(engine.addSetSquare()).toBeTruthy();
    expect(engine.addSetSquare()).toBeNull();
    expect(engine.getState().setSquares).toHaveLength(4);
  });
});
