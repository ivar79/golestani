/**
 * Realistic transform sanity checks: resize with rotation, resize from each
 * handle, rotate around center — verifying the box math used by the handles.
 */
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import type { CardDocument, ShapeLayer } from "../document";
import { ARTBOARD } from "../document";

function mk(id: string, x: number, y: number, w: number, h: number, angle = 0): ShapeLayer {
  return {
    id,
    kind: "shape",
    shape: "rect",
    x,
    y,
    width: w,
    height: h,
    angle,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: "#0ea5e9",
    radius: 0,
  };
}

function engineWith(layer: ShapeLayer): EditorEngine {
  const doc: CardDocument = {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#fff",
    layers: [layer],
  };
  return new EditorEngine(doc);
}

const box = (e: EditorEngine, id: string) => {
  const l = e.getState().doc.layers.find((x) => x.id === id)!;
  return { x: l.x, y: l.y, w: l.width, h: l.height, angle: l.angle };
};

describe("resize math under rotation", () => {
  it("E handle grows width without moving the west edge (unrotated)", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "e", { x: 400, y: 150 });
    const b = box(engine, "a");
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
    expect(b.w).toBe(300);
    expect(b.h).toBe(100);
  });

  it("W handle grows width left without moving the east edge", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "w", { x: 0, y: 150 });
    const b = box(engine, "a");
    // east edge stays at x=300
    expect(b.x + b.w).toBe(300);
    expect(b.w).toBe(300);
  });

  it("S handle grows height without moving the north edge", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "s", { x: 200, y: 400 });
    const b = box(engine, "a");
    expect(b.y).toBe(100);
    expect(b.h).toBe(300);
  });

  it("N handle grows height up without moving the south edge", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "n", { x: 200, y: 0 });
    const b = box(engine, "a");
    expect(b.y + b.h).toBe(200);
    expect(b.h).toBe(200);
  });

  it("corner SE grows both, keeping the NW corner fixed", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "se", { x: 500, y: 500 });
    const b = box(engine, "a");
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
    expect(b.w).toBe(400);
    expect(b.h).toBe(400);
  });

  it("enforces the 8px minimum on both axes", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "se", { x: 90, y: 90 });
    const b = box(engine, "a");
    expect(b.w).toBe(8);
    expect(b.h).toBe(8);
  });

  /**
   * ROTATION CONVENTION: the renderer rotates with CSS `rotate()`, which is
   * CLOCKWISE-positive in a y-down coordinate system. Therefore at angle=90°
   * the layer's local +x (east) axis maps to world (cos90, sin90) = (0, +1),
   * i.e. DOWNWARD on screen. Dragging the E handle must follow that axis:
   * down grows the width, up shrinks it to the 8px minimum.
   * (This test previously dragged up and expected growth, which is why it
   * failed — the engine math was correct, the expectation was not.)
   */
  it("at 90° rotation, dragging the E handle along the rotated axis grows the box", () => {
    const engine = engineWith(mk("a", 300, 200, 200, 100, 90));
    engine.beginTransient();
    // Center is (400, 250); local +x points down, so grow by moving to y=400.
    engine.transientResize("a", "e", { x: 400, y: 400 });
    const b = box(engine, "a");
    // Width grew by 150 (pointer moved 150 along the rotated axis).
    expect(b.w).toBeCloseTo(250, 5);
    expect(b.angle).toBe(90);
    // The box must not drift: its centre stays where it was. Width grows about
    // the fixed WEST edge, which at 90° lies along the world x axis.
    expect(b.x + b.w / 2).toBeCloseTo(400, 5);
  });

  it("at 90° rotation, dragging the E handle backwards clamps to the 8px minimum", () => {
    const engine = engineWith(mk("a", 300, 200, 200, 100, 90));
    engine.beginTransient();
    // The opposite direction is a shrink past the east edge → clamped, never
    // inverted (a negative width would break the renderer's box).
    engine.transientResize("a", "e", { x: 400, y: 100 });
    expect(box(engine, "a").w).toBe(8);
  });
});

describe("rotate math", () => {
  it("pointer directly below center reads as 180°", () => {
    const engine = engineWith(mk("a", 300, 200, 200, 100));
    engine.beginTransient();
    engine.transientRotate("a", { x: 400, y: 600 }, false);
    expect(box(engine, "a").angle).toBeCloseTo(180, 0);
  });

  it("pointer directly above center reads as 0°", () => {
    const engine = engineWith(mk("a", 300, 200, 200, 100));
    engine.beginTransient();
    engine.transientRotate("a", { x: 400, y: -100 }, false);
    expect(box(engine, "a").angle).toBeCloseTo(0, 0);
  });

  it("shift snaps to 15° steps", () => {

    const engine = engineWith(mk("a", 300, 200, 200, 100));
    engine.beginTransient();
    // ~43° from vertical
    engine.transientRotate("a", { x: 700, y: 600 }, true);
    const a = box(engine, "a").angle;
    expect(a % 15).toBe(0);
  });
});

describe("transform + history integration", () => {
  it("a resize then undo restores the original box", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientResize("a", "e", { x: 400, y: 150 });
    engine.commitTransform();
    engine.undo();
    expect(box(engine, "a")).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
  });

  it("a rotate then undo restores the original angle", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.beginTransient();
    engine.transientRotate("a", { x: 500, y: 500 }, false);
    engine.commitTransform();
    engine.undo();
    expect(box(engine, "a").angle).toBe(0);
  });

  it("locked layers reject resize and rotate", () => {
    const engine = engineWith(mk("a", 100, 100, 200, 100));
    engine.toggleLocked("a");
    engine.beginTransient();
    engine.transientResize("a", "e", { x: 999, y: 150 });
    engine.transientRotate("a", { x: 999, y: 999 }, false);
    const b = box(engine, "a");
    expect(b).toMatchObject({ w: 200, h: 100, angle: 0 });
  });
});
