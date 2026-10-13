/**
 * Editor engine: z-order, duplication, paste, alignment and the transform
 * transient/commit contract. Covers the Phase-1 stabilization work.
 */
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import type { CardDocument, PathLayer, ShapeLayer, TextLayer } from "../document";
import { ARTBOARD } from "../document";
import { resolveLayerPathD } from "../path";

function makeDoc(): CardDocument {
  const mk = (id: string, kind: "shape" | "text", x: number, y: number, w: number, h: number): ShapeLayer | TextLayer =>
    kind === "shape"
      ? ({ id, kind, shape: "rect", x, y, width: w, height: h, angle: 0, opacity: 1, locked: false, hidden: false, color: null, background: "#0ea5e9", radius: 0 } as ShapeLayer)
      : ({ id, kind, x, y, width: w, height: h, angle: 0, opacity: 1, locked: false, hidden: false, color: null, background: null, text: "متن", fontSize: 20, fontWeight: 400, align: "start", fontFamily: "vazir" } as TextLayer);
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [mk("a", "shape", 10, 10, 100, 60), mk("b", "shape", 200, 100, 100, 60), mk("c", "text", 400, 200, 100, 60)],
  };
}

describe("EditorEngine z-order (array order is the single source of truth)", () => {
  it("starts with layers in array order", () => {
    const engine = new EditorEngine(makeDoc());
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("reorder(+1) swaps a layer with the one above it", () => {
    const engine = new EditorEngine(makeDoc());
    engine.reorder("b", 1);
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });

  it("reorder(-1) swaps a layer with the one below it", () => {
    const engine = new EditorEngine(makeDoc());
    engine.reorder("b", -1);
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("bringToFront moves a layer to the end of the array", () => {
    const engine = new EditorEngine(makeDoc());
    engine.bringToFront("a");
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["b", "c", "a"]);
  });

  it("sendToBack moves a layer to the start of the array", () => {
    const engine = new EditorEngine(makeDoc());
    engine.bringToFront("a");
    engine.sendToBack("a");
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("reorder at array bounds is a no-op", () => {
    const engine = new EditorEngine(makeDoc());
    engine.reorder("a", -1); // already first
    engine.reorder("c", 1); // already last
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("reorder records ONE undo entry", () => {
    const engine = new EditorEngine(makeDoc());
    engine.reorder("a", 1);
    engine.undo();
    expect(engine.getState().doc.layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("EditorEngine duplicate + paste", () => {
  it("duplicates a layer with a new id, offset down-right", () => {
    const engine = new EditorEngine(makeDoc());
    const newId = engine.duplicateLayer("a");
    expect(newId).not.toBeNull();
    const copy = engine.getState().doc.layers.find((l) => l.id === newId);
    const source = engine.getState().doc.layers.find((l) => l.id === "a");
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe("a");
    expect(copy!.x).toBe(source!.x + 24);
    expect(copy!.y).toBe(source!.y + 24);
    expect(engine.getState().selection.layerId).toBe(newId);
  });

  it("duplicating a locked layer clears the lock flag", () => {
    const engine = new EditorEngine(makeDoc());
    engine.toggleLocked("a");
    const newId = engine.duplicateLayer("a")!;
    expect(engine.getState().doc.layers.find((l) => l.id === newId)!.locked).toBe(false);
  });

  it("pasteLayer offsets and selects the pasted copy", () => {
    const engine = new EditorEngine(makeDoc());
    const source = engine.getState().doc.layers[1];
    const newId = engine.pasteLayer(structuredClone(source));
    expect(engine.getState().doc.layers.find((l) => l.id === newId)!.x).toBe(source.x + 24);
    expect(engine.getState().selection.layerId).toBe(newId);
  });
});

describe("EditorEngine alignment", () => {
  it("aligns a layer to the artboard left edge", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "left");
    expect(engine.getState().doc.layers.find((l) => l.id === "b")!.x).toBe(0);
  });

  it("aligns a layer to the artboard right edge", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "right");
    const layer = engine.getState().doc.layers.find((l) => l.id === "b")!;
    expect(layer.x).toBe(ARTBOARD.width - layer.width);
  });

  it("aligns a layer to the horizontal center", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "centerX");
    const layer = engine.getState().doc.layers.find((l) => l.id === "b")!;
    expect(layer.x).toBe(ARTBOARD.width / 2 - layer.width / 2);
  });

  it("aligns a layer to the vertical center", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "centerY");
    const layer = engine.getState().doc.layers.find((l) => l.id === "b")!;
    expect(layer.y).toBe(ARTBOARD.height / 2 - layer.height / 2);
  });

  it("aligns a layer to the artboard bottom", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "bottom");
    const layer = engine.getState().doc.layers.find((l) => l.id === "b")!;
    expect(layer.y).toBe(ARTBOARD.height - layer.height);
  });

  it("locked layers are not moved by alignment", () => {
    const engine = new EditorEngine(makeDoc());
    engine.toggleLocked("b");
    engine.alignToArtboard("b", "left");
    expect(engine.getState().doc.layers.find((l) => l.id === "b")!.x).toBe(200);
  });

  it("alignment is undoable", () => {
    const engine = new EditorEngine(makeDoc());
    engine.alignToArtboard("b", "left");
    engine.undo();
    expect(engine.getState().doc.layers.find((l) => l.id === "b")!.x).toBe(200);
  });
});

describe("EditorEngine transform contract", () => {
  it("setLayerBox updates position/size in one history record", () => {
    const engine = new EditorEngine(makeDoc());
    engine.setLayerBox("a", { x: 5, y: 7, width: 50, height: 40, angle: 12 });
    const layer = engine.getState().doc.layers.find((l) => l.id === "a")!;
    expect(layer).toMatchObject({ x: 5, y: 7, width: 50, height: 40, angle: 12 });
    engine.undo();
    expect(engine.getState().doc.layers.find((l) => l.id === "a")!.x).toBe(10);
  });

  it("nudge moves by a delta and is undoable", () => {
    const engine = new EditorEngine(makeDoc());
    engine.nudge("a", 3, -5);
    const layer = engine.getState().doc.layers.find((l) => l.id === "a")!;
    expect(layer.x).toBe(13);
    expect(layer.y).toBe(5);
    engine.undo();
    expect(engine.getState().doc.layers.find((l) => l.id === "a")!.x).toBe(10);
  });

  it("transient resize enforces the 8px minimum and keeps the opposite edge fixed", () => {
    const engine = new EditorEngine(makeDoc());
    engine.beginTransient();
    // Drag the E handle far past the pivot: the west edge must stay at x=10.
    engine.transientResize("a", "e", { x: 10, y: 40 });
    let layer = engine.getState().doc.layers.find((l) => l.id === "a")!;
    expect(layer.width).toBeGreaterThanOrEqual(8);
    engine.transientResize("a", "e", { x: 1000, y: 40 });
    layer = engine.getState().doc.layers.find((l) => l.id === "a")!;
    expect(layer.width).toBe(990);
    expect(layer.x).toBe(10); // west edge anchored
  });

  it("transient rotate points the layer at the pointer, snapping with shift", () => {
    const engine = new EditorEngine(makeDoc());
    const layer = engine.getState().doc.layers.find((l) => l.id === "a")!;
    const center = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    engine.beginTransient();
    // Pointer directly below the center should be ~180°.
    engine.transientRotate("a", { x: center.x, y: center.y + 300 }, false);
    expect(engine.getState().doc.layers.find((l) => l.id === "a")!.angle).toBeCloseTo(180, 0);
  });

  it("transient changes commit exactly ONE history record", () => {
    const engine = new EditorEngine(makeDoc());
    const before = engine.getState().canUndo;
    expect(before).toBe(false);
    engine.beginTransient();
    engine.transientMove("a", 100, 100);
    engine.transientMove("a", 150, 150);
    engine.transientMove("a", 200, 200);
    expect(engine.getState().canUndo).toBe(false); // not yet committed
    engine.commitTransform();
    expect(engine.getState().canUndo).toBe(true);
    engine.undo();
    expect(engine.getState().doc.layers.find((l) => l.id === "a")!.x).toBe(10);
  });

  it("a gesture that never moves commits nothing", () => {
    const engine = new EditorEngine(makeDoc());
    engine.beginTransient();
    engine.commitTransform();
    expect(engine.getState().canUndo).toBe(false);
  });
});

/**
 * REGRESSION (SVG NaN / blank drawing from the layer-op buttons).
 *
 * The transform panel's rotation controls commit an ANGLE-ONLY box:
 * "صاف کردن" sends `{ angle: 0 }` and the quick slider sends `{ angle: n }`.
 * `setLayerBox` read the missing size as a scale factor, so for a path layer
 * `sx = undefined / Math.max(1, width)` was NaN and EVERY anchor (and its
 * handles) was rewritten with NaN. The renderer turned that into
 * `d="M NaN NaN …"` plus `cy="NaN"` on the anchor/handle circles — the console
 * flood in the report — and the autosave persisted the ruin. A partial box must
 * only touch what it actually specifies.
 */
describe("EditorEngine setLayerBox keeps partial (angle-only) boxes safe", () => {
  const ANCHORS = [
    { x: 0, y: 0, hIn: null, hOut: { x: 10, y: 0 } },
    { x: 50, y: 20, hIn: { x: 30, y: 12 }, hOut: { x: 70, y: 28 } },
    { x: 100, y: 0, hIn: { x: 80, y: 4 }, hOut: null },
  ];

  const makePath = (extra: Partial<PathLayer> = {}): PathLayer =>
    ({
      id: "p",
      kind: "path",
      x: 20,
      y: 30,
      width: 120,
      height: 60,
      angle: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      color: null,
      background: null,
      closed: false,
      points: ANCHORS.map((point) => ({ ...point })),
      stroke: "#0ea5e9",
      strokeWidth: 6,
      fill: null,
      pathMode: "pen",
      ...extra,
    }) as PathLayer;

  const makePathDoc = (extra: Partial<PathLayer> = {}): CardDocument => ({
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [makePath(extra)],
  });

  const pathOf = (engine: EditorEngine) => engine.getState().doc.layers[0] as PathLayer;
  const snapshot = (layer: PathLayer) => JSON.parse(JSON.stringify(layer)) as PathLayer;

  it("angle-only commit (صاف کردن) leaves anchors and the drawn path untouched", () => {
    const engine = new EditorEngine(makePathDoc());
    const original = snapshot(pathOf(engine));

    engine.setLayerBox("p", { angle: 0 });

    const after = pathOf(engine);
    expect(after.points).toEqual(original.points);
    expect(after.width).toBe(original.width);
    expect(after.x).toBe(original.x);
    // The renderer's own path builder must stay free of NaN/Infinity values.
    expect(resolveLayerPathD(after)).not.toMatch(/NaN|Infinity/);
  });

  it("the quick rotation slider only changes the angle", () => {
    const engine = new EditorEngine(makePathDoc());
    const original = snapshot(pathOf(engine));

    engine.setLayerBox("p", { angle: 37 });

    const after = pathOf(engine);
    expect(after.angle).toBe(37);
    expect(after.points).toEqual(original.points);
    expect(after.width).toBe(original.width);
    expect(after.height).toBe(original.height);
    expect(after.x).toBe(original.x);
    expect(after.y).toBe(original.y);
  });

  it("an angle-only commit keeps a rawD contour verbatim", () => {
    const RAW_D = "M 4 40 C 20 10 60 10 100 40 L 120 60";
    const engine = new EditorEngine(makePathDoc({ rawD: RAW_D }));

    engine.setLayerBox("p", { angle: 0 });

    expect(pathOf(engine).rawD).toBe(RAW_D);
  });

  it("a real resize STILL rescales the anchors into the new box", () => {
    const engine = new EditorEngine(makePathDoc());

    engine.setLayerBox("p", { x: 20, y: 30, width: 240, height: 60, angle: 0 });

    const after = pathOf(engine);
    expect(after.width).toBe(240);
    // sx = 240 / 120 = 2, sy = 60 / 60 = 1 — anchors AND their handles scale.
    expect(after.points.map((point) => point.x)).toEqual([0, 100, 200]);
    expect(after.points[1].hIn).toEqual({ x: 60, y: 12 });
    expect(after.points[1].hOut).toEqual({ x: 140, y: 28 });
  });

  it("non-finite box values never reach the document", () => {
    const engine = new EditorEngine(makePathDoc());
    const original = snapshot(pathOf(engine));

    engine.setLayerBox("p", { width: Number.NaN });
    engine.setLayerBox("p", { height: Number.POSITIVE_INFINITY });
    engine.setLayerBox("p", { x: Number.NaN, y: Number.NaN });

    const after = pathOf(engine);
    expect(after).toMatchObject({
      x: original.x,
      y: original.y,
      width: original.width,
      height: original.height,
    });
    expect(after.points).toEqual(original.points);
    // Nothing changed, so nothing was recorded (no bogus undo step).
    expect(engine.getState().canUndo).toBe(false);
  });
});
