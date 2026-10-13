import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type CardLayer } from "../document";
import { ANGLE_ASSIST_DEFAULT, MAX_GUIDES, addGuide } from "../guides";

/**
 * RULERS / GUIDES / ANGLE ASSIST at the ENGINE level.
 *
 * The load-bearing contract is that all three are VIEW STATE: they must change
 * what a drag aligns to while never reaching the document, the undo history or
 * the save payload. A guide that leaks into the design would be exported onto
 * the card, so these are the tests that matter most.
 */

function layer(id: string, x: number, y: number, width: number, height: number): CardLayer {
  return {
    id,
    kind: "text",
    x,
    y,
    width,
    height,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    z: 1,
    color: "#000000",
    background: null,
    text: "متن",
    fontSize: 20,
    fontWeight: 400,
    align: "start",
    fontFamily: "vazir",
  } as CardLayer;
}

function docWith(...layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

describe("EditorEngine — rulers, guides and the set-square", () => {
  it("starts with the aids off and no guides", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    const state = engine.getState();
    expect(state.rulers).toBe(false);
    expect(state.guides).toEqual([]);
    expect(state.angleAssist).toBe(false);
    expect(state.angleAssistIncrement).toBe(ANGLE_ASSIST_DEFAULT);
  });

  it("toggles the rulers without touching the guides or the document", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    const before = JSON.stringify(engine.getState().doc);
    engine.addGuide("x", 120);
    engine.setRulers(true);
    engine.setRulers(false);
    expect(engine.getState().rulers).toBe(false);
    // Hiding a ruler is not deleting the user's lines.
    expect(engine.getState().guides).toHaveLength(1);
    expect(JSON.stringify(engine.getState().doc)).toBe(before);
  });

  it("adds, moves and removes guides as view state (document unchanged)", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    const before = JSON.stringify(engine.getState().doc);

    engine.addGuide("x", 100.04);
    engine.addGuide("y", ARTBOARD.height + 50);
    const [first, second] = engine.getState().guides;
    expect(first).toMatchObject({ angle: 90, x: 100 });
    // Out-of-board guides are clamped onto the board, never stored off-canvas.
    expect(second.y).toBe(ARTBOARD.height);

    engine.moveGuide(first.id, { x: 10.55, y: first.y });
    expect(engine.getState().guides[0].x).toBe(10.6);

    expect(engine.removeGuide(second.id)).toBe(true);
    expect(engine.removeGuide("missing")).toBe(false);
    expect(engine.getState().guides).toHaveLength(1);

    engine.clearGuides();
    expect(engine.getState().guides).toEqual([]);
    expect(JSON.stringify(engine.getState().doc)).toBe(before);
  });

  it("never grows past the guide cap", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    for (let index = 0; index < MAX_GUIDES + 10; index += 1) {
      engine.addGuide("y", index * 3);
    }
    expect(engine.getState().guides.length).toBeLessThanOrEqual(MAX_GUIDES);
  });

  it("snaps a dragged node to a guide, and reports it as a guide hit", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("x", 177);
    const snapped = engine.smartSnapPoint({ x: 179, y: 40 });
    expect(snapped.x).toBe(177);
    expect(snapped.snappedX).toBe(true);
    expect(snapped.kind).toBe("guide");
    expect(snapped.guides.some((guide) => guide.axis === "x" && guide.at === 177)).toBe(true);
  });

  it("keeps a DIAGONAL guide out of the axis lines but still lets nodes snap to it", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addAngledGuide(45, { x: 0, y: 0 });
    const guide = engine.getState().guides[0];
    expect(guide).toMatchObject({ angle: 45, x: 0, y: 0 });

    // A point 3 units off the 45° line is PROJECTED onto it — both coordinates
    // move, which is the only way a diagonal can honour a snap.
    const snapped = engine.smartSnapPoint({ x: 60, y: 66 }, { tolerance: 6 });
    expect(snapped.x).toBeCloseTo(63, 10);
    expect(snapped.y).toBeCloseTo(63, 10);
    expect(snapped.kind).toBe("guide");
    expect(snapped.guides[0].angle).toBe(45);

    // Outside the tolerance it must not attract anything.
    expect(engine.smartSnapPoint({ x: 60, y: 80 }, { tolerance: 6 })).toMatchObject({ x: 60, y: 80 });
  });

  it("rotates a guide to any angle, and merges it when it lands on another line", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("y", 60);
    const id = engine.getState().guides[0].id;
    engine.rotateGuide(id, 30);
    expect(engine.getState().guides[0].angle).toBe(30);
    expect(engine.rotateGuide("missing", 45)).toBeUndefined();
    expect(engine.getState().guides).toHaveLength(1);
  });

  it("lets an angled guide outrank an axis guide when the line is closer", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    // Two user lines near the same spot: a vertical guide at x = 100 (4 units
    // from the point) and a 45° diagonal through (100,100) (0.7 units from it).
    // The closer line must win, whichever kind it is — a guide is a guide.
    engine.addGuide("x", 100);
    engine.addAngledGuide(45, { x: 100, y: 100 });
    const snapped = engine.smartSnapPoint({ x: 104, y: 105 }, { tolerance: 8 });
    expect(snapped.kind).toBe("guide");
    expect(snapped.x).toBeCloseTo(104.5, 10);
    expect(snapped.y).toBeCloseTo(104.5, 10);
    expect(snapped.guides[0].angle).toBe(45);
  });

  it("snaps to a guide even when the ruler strip is hidden", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("y", 150);
    engine.setRulers(false);
    // A guide is a commitment, not a decoration: hiding the ruler scale does not
    // silently un-align everything the user lined up.
    expect(engine.smartSnapPoint({ x: 5, y: 152 }).y).toBe(150);
  });

  it("ignores a guide that is farther than the snap tolerance", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("x", 177);
    expect(engine.smartSnapPoint({ x: 163, y: 40 }, { tolerance: 5 }).x).toBe(163);
  });

  it("keeps a diagonal guide out of undo history and out of the saved document too", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addAngledGuide(30, { x: 40, y: 40 });
    expect(engine.getState().canUndo).toBe(false);
    const json = JSON.stringify(engine.getState().doc);
    expect(json).not.toContain("guide");
    expect(json).not.toContain("angle\":30");
  });

  it("keeps guides out of undo history and out of the saved document", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("x", 200);
    // Guides are not a document edit, so there is nothing to undo…
    expect(engine.getState().canUndo).toBe(false);
    engine.undo();
    expect(engine.getState().canUndo).toBe(false);
    // …and undoing (which is a no-op here) does not wipe the user's guides.
    expect(engine.getState().guides).toHaveLength(1);
    // …and the serialised document (what the API receives) has no trace of them.
    const json = JSON.stringify(engine.getState().doc);
    expect(json).not.toContain("guide");
    expect(json).not.toContain("ruler");
  });

  it("changes the angle-assist increment only to an offered grid", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.setAngleAssist(true);
    engine.setAngleAssistIncrement(30);
    expect(engine.getState().angleAssist).toBe(true);
    expect(engine.getState().angleAssistIncrement).toBe(30);
    engine.setAngleAssistIncrement(7);
    expect(engine.getState().angleAssistIncrement).toBe(ANGLE_ASSIST_DEFAULT);
    engine.setAngleAssist(false);
    expect(engine.getState().angleAssist).toBe(false);
  });

  it("notifies subscribers when a guide lands", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    let notifications = 0;
    const unsubscribe = engine.subscribe(() => {
      notifications += 1;
    });
    engine.addGuide("x", 42);
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    engine.addGuide("x", 84);
    const after = notifications;
    expect(notifications).toBe(after);
  });

  it("normalizes the incoming list through the same clamp as the pure module", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 50)));
    engine.addGuide("x", 10);
    const list = engine.getState().guides;
    expect(addGuide(list, "x", 10.2, engine.getState().doc.artboard)).toHaveLength(1);
  });
});
