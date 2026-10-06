/**
 * The layer hit-area cursor is a PROMISE about what a press will do.
 *
 * The stage draws one transparent box per layer and makes that box the pointer
 * target, so the cursor has to stay honest over the whole bounding rectangle —
 * including the large parts of it that hold no ink at all. These tests pin the
 * one rule that matters: `move` appears exactly where a press really drags the
 * layer, and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { layerHitCursor } from "../cursorPolicy";

const SELECT = { tool: "select" as const, locked: false, editing: false };

describe("layerHitCursor", () => {
  it("offers `move` on a plain, idle layer — the press really does drag it", () => {
    expect(layerHitCursor(SELECT)).toBe("move");
  });

  it("never offers `move` over the box of the path being point-edited", () => {
    // Pressing here starts a node marquee, or (click) leaves point-editing.
    // A four-headed arrow on this box is a promise the stage cannot keep.
    expect(layerHitCursor({ ...SELECT, editing: true })).toBe("default");
  });

  it("keeps `move` reachable on the edited path while Alt is held", () => {
    // Alt is the documented way to drag the whole layer from inside the node
    // mode, so the stage passes `editing: false` when Alt is down and the
    // promise becomes true again.
    const held = layerHitCursor({ tool: "select", locked: false, editing: false });
    expect(held).toBe("move");
  });

  it("uses the brush crosshair over ANY layer while the freehand tool is active", () => {
    // The brush paints over whatever it lands on, so the pen wins even for a
    // locked or point-edited box.
    expect(layerHitCursor({ tool: "draw", locked: false, editing: false })).toBe("crosshair");
    expect(layerHitCursor({ tool: "draw", locked: true, editing: false })).toBe("crosshair");
    expect(layerHitCursor({ tool: "draw", locked: false, editing: true })).toBe("crosshair");
  });

  it("refuses a locked layer", () => {
    expect(layerHitCursor({ ...SELECT, locked: true })).toBe("not-allowed");
    // Locked beats the point-edit state: the layer refuses either way.
    expect(layerHitCursor({ ...SELECT, locked: true, editing: true })).toBe("not-allowed");
  });

  it("only ever returns one of the four cursors the stage renders", () => {
    const allowed = new Set(["move", "crosshair", "not-allowed", "default"]);
    for (const tool of ["select", "draw", "pen"] as const) {
      for (const locked of [false, true]) {
        for (const editing of [false, true]) {
          expect(allowed.has(layerHitCursor({ tool, locked, editing }))).toBe(true);
        }
      }
    }
  });
});