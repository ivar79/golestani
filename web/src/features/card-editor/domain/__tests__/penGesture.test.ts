import { describe, expect, it } from "vitest";
import {
  CLICK_DRAG_THRESHOLD_PX,
  PEN_DRAG_THRESHOLD_PX,
  exceedsClickThreshold,
  shouldBeginHandleDrag,
} from "../penGesture";

describe("CLICK_DRAG_THRESHOLD_PX", () => {
  it("is the documented 3px screen threshold", () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(3);
  });

  it("is the SAME number the pen uses — one click↔drag rule for the whole editor", () => {
    // The pen (corner anchor vs. handle drag) and the node marquee (click vs.
    // rubber band) must not disagree, or the same gesture would cost a
    // different amount of hand movement depending on the active tool.
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(PEN_DRAG_THRESHOLD_PX);
  });
});

describe("exceedsClickThreshold", () => {
  it("a press with no movement is still a click", () => {
    expect(exceedsClickThreshold({ x: 100, y: 100 }, { x: 100, y: 100 }, 1)).toBe(false);
  });

  it("movement at exactly the threshold is still a click (strictly greater than)", () => {
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: CLICK_DRAG_THRESHOLD_PX, y: 0 }, 1)).toBe(false);
  });

  it("movement past the threshold is a drag", () => {
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: CLICK_DRAG_THRESHOLD_PX + 1, y: 0 }, 1)).toBe(true);
  });

  it("measures in SCREEN pixels, so zoom scales the artboard movement", () => {
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 2, y: 0 }, 2)).toBe(true);
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
  });

  it("tolerates a broken zoom instead of never dragging", () => {
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 4, y: 0 }, Number.NaN)).toBe(true);
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 2, y: 0 }, Number.NaN)).toBe(false);
  });

  it("is exactly the predicate the pen gesture already used", () => {
    // `shouldBeginHandleDrag` is kept as the pen's own name for it; every
    // existing pen test doubles as a test of the shared threshold.
    for (const [dx, dy] of [[0, 0], [2, 0], [3, 0], [4, 0], [2, 2], [3, 3]]) {
      expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: dx, y: dy }, 1)).toBe(
        exceedsClickThreshold({ x: 0, y: 0 }, { x: dx, y: dy }, 1),
      );
    }
  });
});

describe("shouldBeginHandleDrag", () => {
  it("a click with no movement is NOT a drag (leaves a corner anchor)", () => {
    expect(shouldBeginHandleDrag({ x: 100, y: 100 }, { x: 100, y: 100 }, 1)).toBe(false);
  });

  it("movement at exactly the threshold is still a click (strictly greater than)", () => {
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: PEN_DRAG_THRESHOLD_PX, y: 0 }, 1)).toBe(false);
  });

  it("movement past the threshold begins a handle drag", () => {
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: PEN_DRAG_THRESHOLD_PX + 1, y: 0 }, 1)).toBe(true);
  });

  it("measures the threshold in SCREEN pixels (zoom scales artboard movement)", () => {
    // 2 artboard px at zoom 2 = 4 screen px → drag.
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, 2)).toBe(true);
    // The same 2 artboard px at zoom 1 = 2 screen px → click.
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
    // Zooming out makes the same artboard movement SMALLER on screen.
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 8, y: 0 }, 0.3)).toBe(false);
  });

  it("uses the true diagonal distance, not a per-axis check", () => {
    // sqrt(2*2 + 2*2) = 2.83 screen px — under the threshold → click.
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 2, y: 2 }, 1)).toBe(false);
    // sqrt(3*3 + 3*3) = 4.24 screen px — over the threshold → drag.
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 3, y: 3 }, 1)).toBe(true);
  });

  it("works in any direction (threshold is direction-less)", () => {
    expect(shouldBeginHandleDrag({ x: 50, y: 50 }, { x: 50, y: 54 }, 1)).toBe(true);
    expect(shouldBeginHandleDrag({ x: 50, y: 50 }, { x: 46, y: 50 }, 1)).toBe(true);
    expect(shouldBeginHandleDrag({ x: 50, y: 50 }, { x: 50, y: 47 }, 1)).toBe(false);
  });

  it("treats a broken zoom as 1x instead of NaN/never-drag", () => {
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 4, y: 0 }, Number.NaN)).toBe(true);
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, Number.NaN)).toBe(false);
    expect(shouldBeginHandleDrag({ x: 0, y: 0 }, { x: 4, y: 0 }, 0)).toBe(true);
  });
});
