import { describe, expect, it } from "vitest";
import { PEN_DRAG_THRESHOLD_PX, shouldBeginHandleDrag } from "../penGesture";

describe("PEN_DRAG_THRESHOLD_PX", () => {
  it("is the documented 3px screen threshold", () => {
    expect(PEN_DRAG_THRESHOLD_PX).toBe(3);
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
