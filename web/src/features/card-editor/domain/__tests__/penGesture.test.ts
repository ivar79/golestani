import { describe, expect, it } from "vitest";
import {
  CLICK_DRAG_THRESHOLD_PX,
  PEN_ANGLE_SNAP_DEGREES,
  PEN_DRAG_THRESHOLD_PX,
  constrainPenPoint,
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

// ─── SHIFT ANGLE LOCK ───────────────────────────────────────────────────────
// Illustrator and Photoshop document Shift on the Pen tool as "constrain the
// angle of the segment to a multiple of 45°". The lock must be FORCEFUL (no
// tolerance window — Shift is an explicit command) and must keep the pointer's
// distance, so the segment rotates instead of shrinking towards the anchor.
describe("constrainPenPoint (Pen Shift angle lock)", () => {
  const from = { x: 0, y: 0 };

  it("uses 45° as the documented default grid", () => {
    expect(PEN_ANGLE_SNAP_DEGREES).toBe(45);
  });

  it("returns the raw point untouched when the lock is off", () => {
    expect(constrainPenPoint(from, { x: 100, y: 10 }, false)).toEqual({ x: 100, y: 10 });
  });

  it("locks a near-horizontal segment onto the horizontal", () => {
    const locked = constrainPenPoint(from, { x: 100, y: 10 }, true);
    expect(locked.y).toBe(0);
    // The distance is preserved: hypot(100,10) = 100.4988…
    expect(locked.x).toBeCloseTo(Math.hypot(100, 10), 6);
  });

  it("locks a near-vertical segment onto the vertical", () => {
    const locked = constrainPenPoint(from, { x: 10, y: 100 }, true);
    // `constrainToAngle` returns a cleaned finite coordinate, but JS trig can
    // leave a sub-ULP residue on the frozen axis. A near-zero is still the
    // vertical; nothing the Pen draws here should ever send an infinite number
    // into buildPathD.
    // A frozen axis from `constrainToAngle`'s trig can leave a tiny sub-ULP
    // residue (6e-15 here) that varies by JS engine. Accept anything below
    // 1e-12 so the test stays machine-independent instead of pinning one exact
    // rounding.
    expect(locked.x).toBeLessThanOrEqual(1e-12);
    expect(locked.y).toBeCloseTo(Math.hypot(10, 100), 6);
  });

  it("locks both diagonals onto 45°", () => {
    const downRight = constrainPenPoint(from, { x: 100, y: 90 }, true);
    const upRight = constrainPenPoint(from, { x: 100, y: -90 }, true);
    expect(downRight.x).toBeCloseTo(downRight.y, 6);
    expect(upRight.x).toBeCloseTo(-upRight.y, 6);
    // 41.99° and −41.99° are on the same ray length as the raw pointer.
    expect(Math.hypot(downRight.x, downRight.y)).toBeCloseTo(Math.hypot(100, 90), 6);
  });

  it("rotates rather than shortens — every direction keeps the pointer distance", () => {
    for (const to of [{ x: 30, y: 80 }, { x: -140, y: 12 }, { x: 5, y: -200 }, { x: -70, y: -70 }]) {
      const locked = constrainPenPoint(from, to, true);
      expect(Math.hypot(locked.x, locked.y)).toBeCloseTo(Math.hypot(to.x, to.y), 6);
    }
  });

  it("force-snaps anywhere inside a half-step (no tolerance window)", () => {
    // 22.4° off the horizontal is still clamped to the grid: the farthest a raw
    // angle can ever be from a 45° multiple is 22.5°.
    const locked = constrainPenPoint(from, { x: 100, y: 41.2 }, true);
    expect(locked.y).toBe(0);
    expect(constrainPenPoint(from, { x: 100, y: 42 }, true).y).not.toBe(0); // 22.78° → 45°
  });

  it("accepts a wider/narrower grid through the increments argument", () => {
    // A 15° grid keeps a 38.66° pointer near its own direction instead of 45°.
    const fine = constrainPenPoint(from, { x: 100, y: 80 }, true, [15]);
    const coarse = constrainPenPoint(from, { x: 100, y: 80 }, true, [90]);
    expect((Math.atan2(fine.y, fine.x) * 180) / Math.PI).toBeCloseTo(45, 6);
    expect(coarse.y).toBe(0);
    expect(Math.hypot(fine.x, fine.y)).toBeCloseTo(Math.hypot(coarse.x, coarse.y), 6);
  });

  it("ignores a broken increments list instead of throwing or zeroing the point", () => {
    const to = { x: 100, y: 10 };
    expect(constrainPenPoint(from, to, true, [])).toEqual(to);
    expect(constrainPenPoint(from, to, true, [Number.NaN, 0, -45])).toEqual(to);
  });

  it("never invents geometry out of a non-finite coordinate", () => {
    const to = { x: 100, y: 10 };
    expect(constrainPenPoint({ x: Number.NaN, y: 0 }, to, true)).toEqual(to);
    expect(constrainPenPoint(from, { x: Number.POSITIVE_INFINITY, y: 10 }, true)).toEqual({
      x: Number.POSITIVE_INFINITY,
      y: 10,
    });
  });

  it("leaves a pointer sitting exactly on the anchor alone", () => {
    // No direction to lock: a zero-length segment must not become a NaN ray.
    expect(constrainPenPoint({ x: 5, y: 5 }, { x: 5, y: 5 }, true)).toEqual({ x: 5, y: 5 });
  });
});
