/**
 * Multi-select, align and distribute contracts.
 */
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import type { CardDocument, ShapeLayer } from "../document";
import { ARTBOARD } from "../document";

function makeDoc(): CardDocument {
  const mk = (id: string, x: number, y: number, w = 100, h = 60): ShapeLayer => ({
    id,
    kind: "shape",
    shape: "rect",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: "#0ea5e9",
    radius: 0,
  });
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [mk("a", 10, 10), mk("b", 200, 100), mk("c", 400, 200, 150, 80)],
  };
}

const byId = (engine: EditorEngine, id: string) => engine.getState().doc.layers.find((l) => l.id === id)!;

describe("EditorEngine multi-select", () => {
  it("plain click selects one layer", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    expect(engine.selectedIds()).toEqual(["a"]);
    expect(engine.getState().selection.layerId).toBe("a");
  });

  it("shift-click adds to the selection set", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    expect(engine.selectedIds().sort()).toEqual(["a", "b"]);
  });

  it("shift-click on an already-selected layer removes it", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select("a", true);
    expect(engine.selectedIds()).toEqual(["b"]);
  });

  it("plain click after multi-select collapses to a single selection", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select("c");
    expect(engine.selectedIds()).toEqual(["c"]);
  });

  it("select(null) clears the whole set", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select(null);
    expect(engine.selectedIds()).toEqual([]);
    expect(engine.getState().selection.layerId).toBeNull();
  });

  it("selectedLayers returns document-ordered layers", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("c");
    engine.select("a", true);
    expect(engine.selectedLayers().map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("transientMoveSelection moves every selected layer by the same delta", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.beginTransient();
    engine.transientMoveSelection("a", 110, 60); // a moved by +100,+50
    expect(byId(engine, "a")).toMatchObject({ x: 110, y: 60 });
    expect(byId(engine, "b")).toMatchObject({ x: 300, y: 150 });
  });

  it("unselected layers do not move with a multi-select drag", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.beginTransient();
    engine.transientMoveSelection("a", 110, 60);
    expect(byId(engine, "c").x).toBe(400);
  });
});

describe("EditorEngine alignSelection", () => {
  it("aligns all selected layers to the shared left edge (minimum x)", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select("c", true);
    engine.alignSelection("left");
    expect(byId(engine, "a").x).toBe(10);
    expect(byId(engine, "b").x).toBe(10);
    expect(byId(engine, "c").x).toBe(10);
  });

  it("aligns to the shared right edge (maximum x+w)", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.alignSelection("right");
    expect(byId(engine, "a").x).toBe(200 + 100 - 100);
    expect(byId(engine, "b").x).toBe(200);
  });

  it("aligns to the shared top edge", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("c", true);
    engine.alignSelection("top");
    expect(byId(engine, "a").y).toBe(10);
    expect(byId(engine, "c").y).toBe(10);
  });

  it("aligns to the shared bottom edge", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("c", true);
    engine.alignSelection("bottom");
    expect(byId(engine, "a").y).toBe(200 + 80 - 60);
    expect(byId(engine, "c").y).toBe(200);
  });

  it("aligns centers to the mean", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("c", true);
    engine.alignSelection("centerX");
    const mean = (10 + 50 + 400 + 75) / 2;
    expect(byId(engine, "a").x).toBe(mean - 50);
    expect(byId(engine, "c").x).toBe(mean - 75);
  });

  it("a single selection does not align via alignSelection", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.alignSelection("left");
    expect(byId(engine, "a").x).toBe(10);
  });

  it("locked layers are excluded from alignment (fewer than 2 movable = no-op)", () => {
    const engine = new EditorEngine(makeDoc());
    engine.toggleLocked("a");
    engine.select("a");
    engine.select("b", true);
    engine.alignSelection("left");
    // Only b is movable → alignSelection needs ≥2 movable layers, so b stays.
    expect(byId(engine, "a").x).toBe(10);
    expect(byId(engine, "b").x).toBe(200);
  });

  it("locked layers stay put when enough movable layers exist", () => {
    const engine = new EditorEngine(makeDoc());
    engine.toggleLocked("a");
    engine.select("a");
    engine.select("b", true);
    engine.select("c", true);
    engine.alignSelection("left");
    expect(byId(engine, "a").x).toBe(10); // locked, never moved
    expect(byId(engine, "b").x).toBe(200); // the movable minimum-left edge
    expect(byId(engine, "c").x).toBe(200);
  });

  it("alignment is one undoable history record", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.alignSelection("left");
    engine.undo();
    expect(byId(engine, "b").x).toBe(200);
  });
});

describe("EditorEngine distribute", () => {
  it("spaces inner layers evenly between the extremes (needs ≥3)", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a"); // x=10, w=100
    engine.select("b", true); // x=200, w=100
    engine.select("c", true); // x=400, w=150
    engine.distribute("x");
    // Extremes fixed: a=10, c=400. room = 400-10-150 = 240, one inner gap = 240/2 = 120.
    expect(byId(engine, "a").x).toBe(10);
    expect(byId(engine, "b").x).toBe(10 + 100 + 120);
    expect(byId(engine, "c").x).toBe(400);
  });

  it("keeps the extreme layers fixed", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select("c", true);
    engine.distribute("x");
    expect(byId(engine, "a").x).toBe(10);
    expect(byId(engine, "c").x).toBe(400);
  });

  it("distribute along y works the same way", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a"); // y=10, h=60
    engine.select("b", true); // y=100, h=60
    engine.select("c", true); // y=200, h=80
    engine.distribute("y");
    // room = 200-10-80 = 110, gap = 55. b → 10+60+55 = 125.
    expect(byId(engine, "a").y).toBe(10);
    expect(byId(engine, "c").y).toBe(200);
    expect(byId(engine, "b").y).toBe(10 + 60 + 55);
  });

  it("two layers are not enough to distribute", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.distribute("x");
    expect(byId(engine, "a").x).toBe(10);
    expect(byId(engine, "b").x).toBe(200);
  });

  it("distribute is undoable", () => {
    const engine = new EditorEngine(makeDoc());
    engine.select("a");
    engine.select("b", true);
    engine.select("c", true);
    engine.distribute("x");
    engine.undo();
    expect(byId(engine, "b").x).toBe(200);
  });
});
