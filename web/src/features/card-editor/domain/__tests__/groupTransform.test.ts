/**
 * Group transform contract (P1): a Figma-like bounding box for a multi-layer
 * selection.
 *
 * Locked rules:
 *   1. the group frame is DERIVED (never stored on the document)
 *   2. one gesture = ONE history record (undo restores every member)
 *   3. the anchor (opposite corner/edge) stays fixed
 *   4. a live gesture is ABSOLUTE — repeated pointermoves must not compound
 *   5. the group can never invert or collapse (8px minimum)
 *   6. locked members are excluded from the transform
 */
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import type { CardDocument, CardLayer, ShapeLayer } from "../document";
import { ARTBOARD } from "../document";

function mk(id: string, x: number, y: number, w: number, h: number, locked = false): ShapeLayer {
  return {
    id,
    kind: "shape",
    shape: "rect",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    opacity: 1,
    locked,
    hidden: false,
    color: null,
    background: "#0ea5e9",
    radius: 0,
  };
}

function engineWith(layers: CardLayer[]): EditorEngine {
  const doc: CardDocument = {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#fff",
    layers,
  };
  return new EditorEngine(doc);
}

/** Select every id (first plain, the rest additively). */
function selectAll(engine: EditorEngine, ids: string[]): void {
  ids.forEach((id, index) => engine.select(id, index > 0));
}

const box = (engine: EditorEngine, id: string) => {
  const layer = engine.getState().doc.layers.find((l) => l.id === id)!;
  return { x: layer.x, y: layer.y, w: layer.width, h: layer.height, angle: layer.angle };
};

describe("selectionBounds", () => {
  it("is null for a single selection", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    engine.select("a");
    expect(engine.selectionBounds()).toBeNull();
  });

  it("derives the bounding box of the unlocked selection", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);
    expect(engine.selectionBounds()).toEqual({ x: 100, y: 100, width: 400, height: 150 });
  });

  it("ignores locked members and is null when fewer than two remain", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50, true)]);
    selectAll(engine, ["a", "b"]);
    expect(engine.selectionBounds()).toBeNull();
  });

  it("is never written onto the document", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);
    engine.beginTransient();
    engine.transientGroupResize("e", { x: 900, y: 175 });
    engine.commitTransform();

    const doc = engine.snapshot().doc as CardDocument & Record<string, unknown>;
    expect(doc.selectionBounds).toBeUndefined();
    expect(Object.keys(doc).sort()).toEqual(["artboard", "background", "layers", "version"]);
    // Members carry no group bookkeeping either.
    for (const layer of doc.layers) {
      expect(Object.keys(layer)).not.toContain("group");
      expect(Object.keys(layer)).not.toContain("groupId");
    }
  });
});

describe("transientGroupResize", () => {
  it("scales every member about the anchored edge", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    // group box = 100..500 wide; drag the east handle to 900 → scale 2.
    engine.transientGroupResize("e", { x: 900, y: 175 });

    expect(box(engine, "a")).toMatchObject({ x: 100, y: 100, w: 400, h: 100 });
    expect(box(engine, "b")).toMatchObject({ x: 700, y: 200, w: 200, h: 50 });
  });

  it("keeps the west anchor fixed when dragging the west handle", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    // West handle to 300 → new box 300..500 (half width), east edge stays 500.
    engine.transientGroupResize("w", { x: 300, y: 175 });

    const a = box(engine, "a");
    const b = box(engine, "b");
    expect(a.x).toBeCloseTo(300, 5);
    expect(b.x + b.w).toBeCloseTo(500, 5);
    expect(a.w).toBeCloseTo(100, 5);
    expect(b.w).toBeCloseTo(50, 5);
  });

  it("is ABSOLUTE across pointermoves — a repeated event cannot compound", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupResize("e", { x: 900, y: 175 });
    const first = box(engine, "a");

    // The same pointer position again must produce the SAME geometry.
    engine.transientGroupResize("e", { x: 900, y: 175 });
    expect(box(engine, "a")).toEqual(first);

    // And a third identical event, to be sure nothing accumulates.
    engine.transientGroupResize("e", { x: 900, y: 175 });
    expect(box(engine, "a")).toEqual(first);
  });

  it("never inverts or collapses the group", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    // Drag the east handle far past the west edge.
    engine.transientGroupResize("e", { x: -500, y: 175 });

    const bounds = engine.selectionBounds();
    expect(bounds!.width).toBeGreaterThanOrEqual(8);
    for (const layer of engine.getState().doc.layers) {
      expect(layer.width).toBeGreaterThan(0);
    }
  });

  it("honours the aspect lock on corner handles when shift is held", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupResize("se", { x: 900, y: 700 }, true);
    const a = box(engine, "a");
    // Both axes scaled by the same factor → the original 2:1 ratio holds.
    expect(a.w / a.h).toBeCloseTo(2, 4);
  });

  it("leaves locked members exactly where they were", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50), mk("c", 700, 300, 100, 100, true)]);
    selectAll(engine, ["a", "b", "c"]);

    engine.transientGroupResize("e", { x: 1200, y: 175 });

    expect(box(engine, "c")).toMatchObject({ x: 700, y: 300, w: 100, h: 100 });
  });
});

describe("transientGroupRotate", () => {
  it("rotates member centres about the group centre and advances their angles", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    // group centre = (300, 175); pointer due east → delta 90°.
    engine.transientGroupRotate({ x: 400, y: 175 }, false);

    const a = box(engine, "a");
    expect(a.angle).toBeCloseTo(90, 5);
    // A's centre (200,150) rotates 90° about (300,175) → (325,75).
    expect(a.x + a.w / 2).toBeCloseTo(325, 5);
    expect(a.y + a.h / 2).toBeCloseTo(75, 5);
    expect(box(engine, "b").angle).toBeCloseTo(90, 5);
  });

  it("reads 0 at the rotate handle (directly above the centre)", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupRotate({ x: 300, y: 0 }, false);
    expect(box(engine, "a").angle).toBeCloseTo(0, 5);
  });

  it("snaps the delta to 15° steps when shift is held", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupRotate({ x: 700, y: 600 }, true);
    const angle = box(engine, "a").angle;
    expect(Math.abs(angle % 15)).toBeLessThan(0.0001);
  });
});

describe("group transform history", () => {
  it("commits exactly ONE record per gesture and undo restores every member", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupResize("e", { x: 900, y: 175 });
    engine.transientGroupResize("e", { x: 950, y: 175 }); // still the same gesture
    engine.commitTransform();

    expect(engine.getState().canUndo).toBe(true);
    engine.undo();

    expect(box(engine, "a")).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    expect(box(engine, "b")).toMatchObject({ x: 400, y: 200, w: 100, h: 50 });

    // No intermediate record exists to unwind: the first pointermove did not
    // create its own history entry, so a second undo lands on the very same
    // pre-gesture document instead of a half-way state.
    engine.undo();
    expect(box(engine, "a")).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    expect(box(engine, "b")).toMatchObject({ x: 400, y: 200, w: 100, h: 50 });
  });

  it("undoes a group rotation back to the original angles", () => {
    const engine = engineWith([mk("a", 100, 100, 200, 100), mk("b", 400, 200, 100, 50)]);
    selectAll(engine, ["a", "b"]);

    engine.transientGroupRotate({ x: 400, y: 175 }, false);
    engine.commitTransform();
    engine.undo();

    expect(box(engine, "a").angle).toBe(0);
    expect(box(engine, "b").angle).toBe(0);
    expect(box(engine, "a")).toMatchObject({ x: 100, y: 100 });
  });
});
