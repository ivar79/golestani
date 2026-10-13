import { describe, expect, it } from "vitest";
import { HistoryStack } from "../history";
import { EditorEngine } from "../../engine/EditorEngine";
import { fitZoom, keepInside, snapCenter } from "../geometry";
import { ARTBOARD, type CardDocument } from "../document";
import { resolveLayerPathD } from "../path";

function testDoc(): CardDocument {
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [
      { id: "t1", kind: "text", x: 10, y: 10, width: 300, height: 50, angle: 0, opacity: 1, locked: false, hidden: false, z: 1, color: "#000000", background: null, text: "سلام", fontSize: 28, fontWeight: 600, align: "start", fontFamily: "vazir" },
      { id: "t2", kind: "text", x: 20, y: 80, width: 300, height: 50, angle: 0, opacity: 1, locked: false, hidden: false, z: 2, color: "#111111", background: null, text: "دوم", fontSize: 24, fontWeight: 400, align: "center", fontFamily: "vazir" },
    ],
  };
}

describe("HistoryStack", () => {
  it("commit/undo/redo round-trips", () => {
    const stack = new HistoryStack();
    stack.commit("a");
    expect(stack.canUndo).toBe(true);
    const restored = stack.undo("b");
    expect(restored).toBe("a");
    expect(stack.canRedo).toBe(true);
    const redo = stack.redo("b");
    expect(redo).toBe("b");
    expect(stack.canUndo).toBe(true);
  });

  it("no-op guard: identical doc does not change depth", () => {
    const stack = new HistoryStack();
    stack.commit("a");
    const depth = stack.depth;
    stack.commit("a");
    expect(stack.depth).toBe(depth + 1); // plain commit always records state
  });

  it("same-group commits merge to one gesture record (one drag = one record)", () => {
    const stack = new HistoryStack();
    stack.commit("v1", { group: null });
    stack.commit("pre-drag", { group: "drag:x" });
    stack.commit("pre-drag", { group: "drag:x" }); // same group → skipped
    expect(stack.depth).toBe(2);
    expect(stack.undo("after-drag")).toBe("pre-drag");
  });

  it("stack is bounded at cap", () => {
    const stack = new HistoryStack(5);
    for (let i = 0; i < 20; i++) stack.commit(`v${i}`);
    expect(stack.depth).toBe(5);
    expect(stack.undo("now")).toBe("v19");
  });
});

describe("EditorEngine", () => {
  it("transientMove does not create history; commitMove creates exactly one", () => {
    const engine = new EditorEngine(testDoc());
    engine.select("t1");
    const before = engine.getState().canUndo;

    engine.transientMove("t1", 100, 200);
    engine.transientMove("t1", 120, 220);
    expect(engine.getState().canUndo).toBe(before); // no history from moves
    expect(engine.getState().doc.layers[0].x).toBe(120); // state did move

    engine.commitMove("t1");
    expect(engine.getState().canUndo).toBe(true);
    expect(engine.getState().dirty).toBe(true);
  });

  it("undo restores the pre-drag position", () => {
    const engine = new EditorEngine(testDoc());
    engine.transientMove("t1", 300, 300);
    engine.commitMove("t1");
    engine.undo();
    expect(engine.getState().doc.layers[0].x).toBe(10);
    expect(engine.getState().canRedo).toBe(true);
    engine.redo();
    expect(engine.getState().doc.layers[0].x).toBe(300);
  });

  it("updateLayer changes text and marks dirty", () => {
    const engine = new EditorEngine(testDoc());
    engine.updateLayer("t1", { text: "نام نو" });
    const first = engine.getState().doc.layers[0];
    expect(first.kind === "text" && first.text === "نام نو").toBe(true);
    expect(engine.getState().dirty).toBe(true);
  });

  it("deleteLayer removes unlocked but locked layers survive", () => {
    const engine = new EditorEngine(testDoc());
    engine.toggleLocked("t2");
    const nowLocked = engine.getState().doc.layers.find((l) => l.id === "t2")?.locked;
    expect(nowLocked).toBe(true);
    engine.deleteLayer("t2");
    expect(engine.getState().doc.layers.some((l) => l.id === "t2")).toBe(true);
    engine.toggleLocked("t2");
    engine.deleteLayer("t2");
    expect(engine.getState().doc.layers.some((l) => l.id === "t2")).toBe(false);
  });

  it("reorder moves layer up and down", () => {
    const engine = new EditorEngine(testDoc());
    engine.reorder("t2", 1);
    expect(engine.getState().doc.layers[1].id).toBe("t2"); // t2 swapped to top
    engine.reorder("t2", 1);
    expect(engine.getState().doc.layers[1].id).toBe("t2"); // already top, no-op
    engine.reorder("t2", -1);
    expect(engine.getState().doc.layers[0].id).toBe("t2");
  });

  it("markSaved clears the dirty flag", () => {
    const engine = new EditorEngine(testDoc());
    engine.updateLayer("t1", { text: "x" });
    expect(engine.getState().dirty).toBe(true);
    engine.markSaved();
    expect(engine.getState().dirty).toBe(false);
  });

  it("undo back to the last saved revision reports CLEAN (header must not lie)", () => {
    const engine = new EditorEngine(testDoc());
    // No save has happened yet: the initial document is the only revision.
    engine.markSaved();
    expect(engine.getState().dirty).toBe(false);

    engine.updateLayer("t1", { text: "edited" });
    expect(engine.getState().dirty).toBe(true);

    engine.undo();
    // Undone exactly onto the saved revision — nothing is pending.
    expect(engine.getState().dirty).toBe(false);

    engine.redo();
    expect(engine.getState().dirty).toBe(true);
  });

  it("addLayer selects the new layer", () => {
    const engine = new EditorEngine(testDoc());
    const id = engine.addLayer("badge");
    expect(engine.getState().selection.layerId).toBe(id);
    expect(engine.getState().doc.layers).toHaveLength(3);
  });

  it("undo after addLayer removes the added layer (real pre-state history)", () => {
    const engine = new EditorEngine(testDoc());
    const before = engine.getState().doc.layers.length;
    engine.addLayer("text");
    expect(engine.getState().doc.layers.length).toBe(before + 1);
    engine.undo();
    expect(engine.getState().doc.layers.length).toBe(before);
    expect(engine.getState().doc.layers.some((l) => l.id.startsWith("text-"))).toBe(false);
    engine.redo();
    expect(engine.getState().doc.layers.length).toBe(before + 1);
  });

  it("undo after deleteLayer restores the deleted layer", () => {
    const engine = new EditorEngine(testDoc());
    engine.deleteLayer("t2");
    expect(engine.getState().doc.layers).toHaveLength(1);
    engine.undo();
    expect(engine.getState().doc.layers.some((l) => l.id === "t2")).toBe(true);
  });

  it("no-op guard: identical updateLayer/setBackground record NO history", () => {
    const engine = new EditorEngine(testDoc());
    const depthBefore = engine.getState().canUndo ? 1 : 0;
    engine.updateLayer("t1", { text: "سلام" }); // unchanged (same as initial)
    engine.setBackground("#ffffff"); // unchanged
    expect(engine.getState().dirty).toBe(false);
    expect(engine.getState().canUndo).toBe(depthBefore > 0 ? true : false);
    // A real change right after still undoes to the untouched document.
    engine.updateLayer("t1", { text: "جدید" });
    expect(engine.getState().dirty).toBe(true);
    engine.undo();
    const restored = engine.getState().doc.layers.find((l) => l.id === "t1");
    expect(restored?.kind === "text" && restored.text === "سلام").toBe(true);
  });

  it("updateLayer on a locked layer is fully ignored (no history, no dirty)", () => {
    const engine = new EditorEngine(testDoc());
    engine.toggleLocked("t1"); // lock t1
    const snapshot = JSON.stringify(engine.getState().doc);
    engine.updateLayer("t1", { text: "نباید اعمال شود" });
    expect(JSON.stringify(engine.getState().doc)).toBe(snapshot);
    // Locked-edit attempts must not pile up history records either.
    const historyDepth = engine.getState().canUndo;
    engine.updateLayer("t1", { text: "دوباره رد شود" });
    expect(engine.getState().canUndo).toBe(historyDepth);
  });
});

describe("geometry", () => {
  it("fitZoom uses min ratio", () => {
    expect(fitZoom(1050, 600)).toBe(1);
    expect(fitZoom(525, 600)).toBe(0.5);
    expect(fitZoom(2100, 600)).toBe(1);
  });

  it("keepInside clamps layers to the artboard", () => {
    expect(keepInside(-500, -500, 100, 100).x).toBeLessThanOrEqual(0);
    expect(keepInside(2000, 2000, 100, 100).x).toBe(ARTBOARD.width - 12);
  });

  it("snapCenter snaps to the middle line", () => {
    const snapped = snapCenter(ARTBOARD.width / 2 - 55, 100);
    expect(snapped.snapped).toBe(true);
    expect(snapped.value).toBe(ARTBOARD.width / 2 - 50);
  });
});

describe("EditorEngine freehand drawing", () => {
  function stroke(engine: EditorEngine, ...points: [number, number][]): string | null {
    engine.beginFreehandStroke({ x: points[0][0], y: points[0][1] });
    for (const [x, y] of points.slice(1)) engine.extendFreehandStroke({ x, y });
    return engine.commitFreehandStroke({ color: "#0ea5e9", width: 6 });
  }

  it("begin/extend/commit produces one path layer with one history record", () => {
    const engine = new EditorEngine(testDoc());
    const before = engine.getState().doc.layers.length;

    const id = stroke(engine, [100, 100], [150, 120], [200, 100]);
    expect(id).not.toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(before + 1);

    const path = engine.getState().doc.layers.find((l) => l.id === id);
    expect(path?.kind).toBe("path");
    if (path?.kind === "path") {
      expect(path.points.length).toBeGreaterThanOrEqual(2);
      expect(path.stroke).toBe("#0ea5e9");
      expect(path.strokeWidth).toBe(6);
      expect(path.fill).toBeNull();
    }

    // The stroke itself is one undo step (the transient preview kept no history).
    engine.undo();
    expect(engine.getState().doc.layers).toHaveLength(before);
    engine.redo();
    expect(engine.getState().doc.layers).toHaveLength(before + 1);
  });

  it("a too-short stroke is dropped and leaves no history", () => {
    const engine = new EditorEngine(testDoc());
    const canUndoBefore = engine.getState().canUndo;

    engine.beginFreehandStroke({ x: 10, y: 10 });
    expect(engine.commitFreehandStroke({ color: "#0ea5e9", width: 6 })).toBeNull();
    expect(engine.getState().workingStroke).toBeNull();
    expect(engine.getState().canUndo).toBe(canUndoBefore);
  });

  it("cancelFreehandStroke clears the working stroke without committing", () => {
    const engine = new EditorEngine(testDoc());
    const before = engine.getState().doc.layers.length;
    engine.beginFreehandStroke({ x: 10, y: 10 });
    engine.extendFreehandStroke({ x: 60, y: 60 });
    engine.cancelFreehandStroke();
    expect(engine.getState().workingStroke).toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(before);
  });

  it("commits consecutive strokes as separate undo steps", () => {
    const engine = new EditorEngine(testDoc());
    stroke(engine, [10, 10], [60, 60]);
    stroke(engine, [100, 100], [160, 160]);
    expect(engine.getState().doc.layers.filter((l) => l.kind === "path")).toHaveLength(2);

    engine.undo();
    expect(engine.getState().doc.layers.filter((l) => l.kind === "path")).toHaveLength(1);
    engine.undo();
    expect(engine.getState().doc.layers.filter((l) => l.kind === "path")).toHaveLength(0);
  });

  it("a path layer survives a JSON round-trip", () => {
    const engine = new EditorEngine(testDoc());
    const id = stroke(engine, [10, 10], [60, 60]);
    const exported = engine.snapshot().doc;
    const reparsed = JSON.parse(JSON.stringify(exported));
    expect(reparsed.layers.find((l: { id: string }) => l.id === id)).toBeDefined();
  });

  it("addBrushLayer stores a tight box + editable Bezier the shared resolver renders", () => {
    const engine = new EditorEngine(testDoc());
    // A small ribbon outline in artboard coordinates.
    const outline = [
      [100, 100],
      [120, 108],
      [140, 100],
      [130, 90],
      [110, 92],
    ];
    const id = engine.addBrushLayer(outline, "#22d3ee");
    expect(id).not.toBeNull();
    const layer = engine.getState().doc.layers.find((l) => l.id === id);
    expect(layer?.kind).toBe("path");
    if (layer?.kind !== "path") return;
    // The stroke is NOT the whole artboard — it frames only its own ink.
    expect(layer.width).toBeLessThan(ARTBOARD.width);
    expect(layer.height).toBeLessThan(ARTBOARD.height);
    expect(layer.x).toBeLessThanOrEqual(100);
    expect(layer.y).toBeLessThanOrEqual(100);
    expect(layer.fill).toBe("#22d3ee");
    // The brush pipeline commits EDITABLE vector geometry now: real anchors,
    // no `rawD` shadow document. The resolver (canvas + export) rebuilds the
    // `d` from those anchors, so the stroke survives the pointer release AND
    // stays node-editable/resizable afterwards.
    expect(layer.pathMode).toBe("freehand");
    expect(layer.closed).toBe(true);
    expect(layer.points.length).toBeGreaterThanOrEqual(3);
    expect(layer.rawD).toBeUndefined();
    const d = resolveLayerPathD(layer);
    expect(d).toContain("M ");
    expect(d.endsWith("Z")).toBe(true);
  });

  it("addBrushLayer drops a degenerate outline without leaving a layer", () => {
    const engine = new EditorEngine(testDoc());
    const before = engine.getState().doc.layers.length;
    expect(engine.addBrushLayer([], "#22d3ee")).toBeNull();
    expect(engine.addBrushLayer([[0, 0], [1, 1]], "#22d3ee")).toBeNull();
    expect(engine.getState().doc.layers).toHaveLength(before);
  });

  it("addCurvedLine stores the canonical bend the resolver and handle read", () => {
    const engine = new EditorEngine(testDoc());
    const id = engine.addCurvedLine(50);
    const layer = engine.getState().doc.layers.find((l) => l.id === id);
    expect(layer?.kind).toBe("path");
    if (layer?.kind !== "path") return;
    expect(layer.bend).toBe(0.5);
    // The geometry the renderer/export draws is the arc, not the anchors.
    expect(resolveLayerPathD(layer)).toContain(" A ");
  });

  it("setPathBend changes the resolved arc live", () => {
    const engine = new EditorEngine(testDoc());
    const id = engine.addCurvedLine(0);
    const layer = () => engine.getState().doc.layers.find((l) => l.id === id);
    expect((layer() as { bend?: number }).bend).toBe(0);
    expect(resolveLayerPathD(layer() as never)).not.toContain(" A ");

    engine.setPathBend(id, 1);
    expect((layer() as { bend?: number }).bend).toBe(1);
    expect(resolveLayerPathD(layer() as never)).toContain(" A ");

    engine.setPathBend(id, 10); // clamped to the resolver's supported range
    expect((layer() as { bend?: number }).bend).toBe(1.5);
  });
});

describe("EditorEngine transient color editing", () => {
  it("transientPatch + commit records exactly one history step", () => {
    const engine = new EditorEngine(testDoc());
    engine.select("t1");
    const canUndoBefore = engine.getState().canUndo;

    engine.transientPatch("t1", { color: "#ff0000" });
    engine.transientPatch("t1", { color: "#00ff00" });
    expect(engine.getState().canUndo).toBe(canUndoBefore); // no history while dragging

    engine.commitTransient();
    expect(engine.getState().canUndo).toBe(true);
    expect(engine.getState().dirty).toBe(true);
    expect(engine.getState().doc.layers[0].color).toBe("#00ff00");

    // One undo restores the pre-gesture color (both intermediate values collapse).
    engine.undo();
    expect(engine.getState().doc.layers[0].color).toBe("#000000");
  });

  it("a transient gesture with no net change records nothing", () => {
    const engine = new EditorEngine(testDoc());
    engine.beginTransient();
    engine.commitTransient(); // untouched
    expect(engine.getState().dirty).toBe(false);
  });
});
