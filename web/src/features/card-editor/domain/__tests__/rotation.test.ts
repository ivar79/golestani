/**
 * §3 exact rotation + §5 handle tangent tests.
 *
 * These pin the acceptance criteria that a straight line can be rotated to 0.1°
 * precision and that length and rotation are INDEPENDENT — the two things the
 * old pointer-only rotation could not guarantee.
 */
import { describe, expect, it } from "vitest";
import {
  ANGLE_PRESETS,
  angleStepForEvent,
  bakePathRotation,
  handleVector,
  lineMetrics,
  normalizeAngle,
  rotatePoints,
  setHandleAngle,
  setHandleLength,
  setLineAngle,
  setLineLength,
  snapAngle,
} from "../rotation";
import type { PathPoint } from "../document";

const line = (): PathPoint[] => [{ x: 100, y: 100 }, { x: 700, y: 100 }];

describe("angle helpers", () => {
  it("wraps into (-180, 180]", () => {
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-370)).toBe(-10);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(540)).toBe(180);
  });

  it("snaps to a step at the step's own precision", () => {
    expect(snapAngle(12.34, 15)).toBeCloseTo(15, 6);
    expect(snapAngle(12.34, 1)).toBeCloseTo(12, 6);
    expect(snapAngle(12.34, 0.1)).toBe(12.3);
    expect(snapAngle(-12.36, 0.1)).toBe(-12.4);
    // A zero/invalid step is a no-op rather than a divide by zero.
    expect(snapAngle(12.34, 0)).toBe(12.34);
  });

  it("derives the keyboard increment from the modifiers", () => {
    expect(angleStepForEvent(1, {})).toBe(1);
    expect(angleStepForEvent(1, { shift: true })).toBe(15);
    expect(angleStepForEvent(1, { alt: true })).toBe(0.1);
    expect(angleStepForEvent(0.25, {})).toBe(0.25);
  });

  it("offers the professional preset ladder", () => {
    expect(ANGLE_PRESETS).toEqual(expect.arrayContaining([0, 0.1, 0.25, 0.5, 1, 2, 5, 15, 45, 90, 180]));
  });
});

describe("straight lines: length and angle are independent", () => {
  it("rotates to arbitrary decimal angles without changing the length", () => {
    const original = line();
    const { length } = lineMetrics(original)!;

    for (const angle of [0.1, 0.25, 0.37, 0.5, 1, 2, 5, 15, 45, 90, 180, -0.1, -33.3, -90]) {
      const rotated = setLineAngle(original, angle);
      const metrics = lineMetrics(rotated)!;
      expect(metrics.angleDeg).toBeCloseTo(angle, 6);
      // THE requirement: the length is untouched by a rotation.
      expect(metrics.length).toBeCloseTo(length, 9);
    }
  });

  it("keeps the centre fixed while rotating", () => {
    const rotated = setLineAngle(line(), 33.3);
    const center = lineMetrics(rotated)!.center;
    expect(center.x).toBeCloseTo(400, 9);
    expect(center.y).toBeCloseTo(100, 9);
  });

  it("changes length without touching the angle", () => {
    const aimed = setLineAngle(line(), 12.5);
    for (const length of [50, 123.75, 600, 1]) {
      const resized = setLineLength(aimed, length);
      const metrics = lineMetrics(resized)!;
      expect(metrics.length).toBeCloseTo(length, 9);
      expect(metrics.angleDeg).toBeCloseTo(12.5, 9);
    }
  });

  it("survives rotate → resize → rotate without drift", () => {
    const original = line();
    let points = setLineAngle(original, 0.1);
    points = setLineLength(points, 321.5);
    points = setLineAngle(points, -7.25);
    const metrics = lineMetrics(points)!;
    expect(metrics.length).toBeCloseTo(321.5, 9);
    expect(metrics.angleDeg).toBeCloseTo(-7.25, 6);
  });

  it("ignores degenerate input instead of producing NaN", () => {
    expect(setLineLength(line(), 0)).toEqual(line());
    expect(setLineLength(line(), Number.NaN)).toEqual(line());
    expect(setLineAngle([{ x: 0, y: 0 }], 45)).toHaveLength(1);
  });
});

describe("rotatePoints rotates real geometry rigidly", () => {
  it("rotates anchors and their handles together", () => {
    const square: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const rotated = rotatePoints(square, { x: 50, y: 50 }, 90);
    expect(rotated[0].x).toBeCloseTo(100, 9);
    expect(rotated[0].y).toBeCloseTo(0, 9);
    expect(rotated[2].x).toBeCloseTo(0, 9);
    expect(rotated[2].y).toBeCloseTo(100, 9);
    // Rigid: the edge length is preserved.
    expect(Math.hypot(rotated[1].x - rotated[0].x, rotated[1].y - rotated[0].y)).toBeCloseTo(100, 9);
  });

  it("preserves the tangent angle of a handle (rigid, not re-shaped)", () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, hOut: { x: 20, y: 0 } },
      { x: 100, y: 0 },
    ];
    const before = handleVector(points, 0, "hOut")!;
    const rotated = rotatePoints(points, { x: 0, y: 0 }, 37.5);
    const after = handleVector(rotated, 0, "hOut")!;
    expect(after.length).toBeCloseTo(before.length, 9);
    // The handle's own angle rotates with the shape: 0° + 37.5°.
    expect(after.angleDeg).toBeCloseTo(37.5, 9);
  });

  it("bakes a rotation into the anchors and re-origins the box", () => {
    const layer = {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      closed: true,
      strokeWidth: 4,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ] as PathPoint[],
    };
    const baked = bakePathRotation(layer, 90);
    // A 90° rotation swaps the box's axes.
    expect(baked.width).toBeCloseTo(layer.height + 4 * 2, 6);
    expect(baked.height).toBeCloseTo(layer.width + 4 * 2, 6);

    // The layer's CENTRE stays put in artboard space — baking must not make the
    // drawing jump.
    const beforeCenter = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    expect(baked.x + baked.width / 2).toBeCloseTo(beforeCenter.x, 6);
    expect(baked.y + baked.height / 2).toBeCloseTo(beforeCenter.y, 6);

    // ...and the corner really is rotated geometry, not a re-origined box:
    // (0,0) local sits at world (100,100) and swings 90° about the centre.
    expect(baked.x + baked.points[0].x).toBeCloseTo(250, 6);
    expect(baked.y + baked.points[0].y).toBeCloseTo(50, 6);
  });
});

describe("handle (tangent) angle editing", () => {
  const points = (): PathPoint[] => [
    { x: 50, y: 50, hOut: { x: 80, y: 50 }, hIn: { x: 20, y: 50 } },
    { x: 150, y: 50 },
  ];

  it("reports angle and length", () => {
    const vector = handleVector(points(), 0, "hOut")!;
    expect(vector.angleDeg).toBeCloseTo(0, 9);
    expect(vector.length).toBeCloseTo(30, 9);
  });

  it("re-aims a handle to an exact decimal angle, preserving its length", () => {
    const updated = setHandleAngle(points(), 0, "hOut", 0.1);
    const vector = handleVector(updated, 0, "hOut")!;
    expect(vector.angleDeg).toBeCloseTo(0.1, 9);
    expect(vector.length).toBeCloseTo(30, 9);
  });

  it("mirrors the opposite handle to keep the node smooth", () => {
    const updated = setHandleAngle(points(), 0, "hOut", 30, true);
    expect(handleVector(updated, 0, "hOut")!.angleDeg).toBeCloseTo(30, 9);
    expect(handleVector(updated, 0, "hIn")!.angleDeg).toBeCloseTo(-150, 9);
    // Mirroring must not move the anchor.
    expect(updated[0].x).toBe(50);
    expect(updated[0].y).toBe(50);
  });

  it("re-lengths a handle without changing its direction", () => {
    const updated = setHandleLength(points(), 0, "hOut", 75);
    const vector = handleVector(updated, 0, "hOut")!;
    expect(vector.length).toBeCloseTo(75, 9);
    expect(vector.angleDeg).toBeCloseTo(0, 9);
  });
});
