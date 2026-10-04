/**
 * P0 RECOVERY REGRESSIONS — the two editor defects that made the studio feel
 * broken, locked down at the engine level (no DOM, no React):
 *
 *  1. MIRROR/FLIP is a LAYER-LEVEL transform. It used to exist only for image
 *     layers and only inside the image inspector, so "mirror" looked missing.
 *     It now toggles on every kind, survives the document round trip and is
 *     refused on locked layers like every other property edit.
 *
 *  2. SELECTION AFTER DRAWING. Drawing a freehand stroke / curve enters
 *     point-edit mode automatically; that mode used to swallow every later
 *     click (the layer hit-areas started a node marquee instead of selecting),
 *     so an existing line/path could not be re-selected to change its
 *     curvature. Selecting a DIFFERENT layer now always leaves the mode.
 */
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type BadgeLayer, type CardDocument, type CardLayer, type ImageLayer, type PathLayer, type QrLayer, type ShapeLayer, type TextLayer } from "../document";
import { parseDocument, serializeDocument } from "../factory";

const BASE = {
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  angle: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  color: null,
  background: null,
} as const;

function pathLayer(overrides: Partial<PathLayer> = {}): PathLayer {
  return {
    ...BASE,
    id: "p1",
    kind: "path",
    closed: false,
    points: [
      { x: 0, y: 0, hIn: null, hOut: null },
      { x: 60, y: 40, hIn: null, hOut: null },
    ],
    bend: 0.4,
    pathMode: "curve",
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    ...overrides,
  };
}

function everyKind(): CardLayer[] {
  const text: TextLayer = { ...BASE, id: "t1", kind: "text", text: "متن", fontSize: 24, fontWeight: 600, align: "start", fontFamily: "vazir" };
  const image: ImageLayer = { ...BASE, id: "i1", kind: "image", src: "/storage/cards/logo.png", radius: 0, objectFit: "cover" };
  const qr: QrLayer = { ...BASE, id: "q1", kind: "qr", width: 120, height: 120, payload: "my-shop", dark: "#000000", light: "#ffffff" };
  const badge: BadgeLayer = { ...BASE, id: "b1", kind: "badge", width: 140, height: 36, style: "verified", text: "تأییدشده" };
  const shape: ShapeLayer = { ...BASE, id: "s1", kind: "shape", shape: "rect", radius: 0, background: "#0ea5e9" };
  return [text, image, qr, badge, shape, pathLayer()];
}

function doc(layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

describe("mirror/flip on every layer kind", () => {
  it("toggles horizontal and vertical flip on each kind", () => {
    for (const layer of everyKind()) {
      const engine = new EditorEngine(doc([layer]));
      expect(engine.toggleFlip(layer.id, "x"), `${layer.kind}: flipX`).toBe(true);
      expect(engine.getState().doc.layers[0].flipX).toBe(true);
      expect(engine.toggleFlip(layer.id, "y"), `${layer.kind}: flipY`).toBe(true);
      expect(engine.getState().doc.layers[0].flipY).toBe(true);
      // Toggling back is a real un-mirror, not a one-way switch.
      expect(engine.toggleFlip(layer.id, "x")).toBe(false);
      expect(engine.getState().doc.layers[0].flipX).toBe(false);
    }
  });

  it("records ONE history step per toggle and is undoable", () => {
    const engine = new EditorEngine(doc([everyKind()[0]]));
    engine.toggleFlip("t1", "x");
    expect(engine.getState().doc.layers[0].flipX).toBe(true);
    engine.undo();
    expect(engine.getState().doc.layers[0].flipX ?? false).toBe(false);
  });

  it("refuses a locked layer (same contract as every property edit)", () => {
    const locked: ShapeLayer = { ...(everyKind()[4] as ShapeLayer), locked: true };
    const engine = new EditorEngine(doc([locked]));
    expect(engine.toggleFlip("s1", "x")).toBeNull();
    expect(engine.getState().doc.layers[0].flipX ?? false).toBe(false);
  });

  it("survives a save/reload round trip for every kind", () => {
    for (const layer of everyKind()) {
      const engine = new EditorEngine(doc([layer]));
      engine.toggleFlip(layer.id, "y");
      const reloaded = parseDocument(serializeDocument(engine.snapshot().doc));
      expect(reloaded, `${layer.kind}: reload`).not.toBeNull();
      expect(reloaded?.layers[0].flipY, `${layer.kind}: flipY kept`).toBe(true);
    }
  });

  it("keeps a mirrored layer's geometry identical (mirroring is not a resize)", () => {
    const engine = new EditorEngine(doc([everyKind()[4]]));
    const before = { ...engine.getState().doc.layers[0] };
    engine.toggleFlip("s1", "x");
    const after = engine.getState().doc.layers[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.angle).toBe(before.angle);
  });
});

describe("selection while point-editing a path", () => {
  it("leaves point-edit mode when a DIFFERENT layer is selected", () => {
    const engine = new EditorEngine(doc([pathLayer(), everyKind()[0]]));
    engine.setPathEditing("p1");
    expect(engine.getState().editingPathId).toBe("p1");

    engine.select("t1");
    expect(engine.getState().selection.layerId).toBe("t1");
    expect(engine.getState().editingPathId).toBeNull();
  });

  it("keeps point-edit mode when the SAME path is re-selected", () => {
    const engine = new EditorEngine(doc([pathLayer()]));
    engine.setPathEditing("p1");
    engine.select("p1");
    expect(engine.getState().editingPathId).toBe("p1");
  });

  it("re-selects the drawn path and still reports its curvature", () => {
    // The exact user journey: draw → leave → click the path again → edit the arc.
    const engine = new EditorEngine(doc([pathLayer(), everyKind()[0]]));
    engine.setPathEditing("p1");
    engine.select("t1");
    engine.select("p1");
    const layer = engine.getState().doc.layers[0] as PathLayer;
    expect(layer.bend).toBeCloseTo(0.4, 6);
    engine.setPathBend("p1", 0.75);
    expect((engine.getState().doc.layers[0] as PathLayer).bend).toBeCloseTo(0.75, 6);
  });

  it("clears point-edit mode when the selection is emptied", () => {
    const engine = new EditorEngine(doc([pathLayer()]));
    engine.setPathEditing("p1");
    engine.select(null);
    expect(engine.getState().editingPathId).toBeNull();
  });
});

describe("QR payload integrity", () => {
  it("keeps the payload through serialize/parse (the slug is what renders)", () => {
    const engine = new EditorEngine(doc([everyKind()[2]]));
    const reloaded = parseDocument(serializeDocument(engine.snapshot().doc));
    expect((reloaded?.layers[0] as QrLayer).payload).toBe("my-shop");
  });

  it("seeds a new QR layer with the payload it was given (toolbox contract)", () => {
    const engine = new EditorEngine(doc([]));
    engine.addLayer("qr", { payload: "golestani" });
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("golestani");
  });
});
