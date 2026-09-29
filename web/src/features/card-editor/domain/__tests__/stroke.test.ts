import { describe, expect, it } from "vitest";
import {
  clampStrokeWidth,
  dashArrayFor,
  resolveStroke,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
} from "../stroke";

describe("clampStrokeWidth", () => {
  it("clamps into the 1..50 slider range", () => {
    expect(clampStrokeWidth(0)).toBe(STROKE_WIDTH_MIN);
    expect(clampStrokeWidth(-10)).toBe(STROKE_WIDTH_MIN);
    expect(clampStrokeWidth(999)).toBe(STROKE_WIDTH_MAX);
    expect(clampStrokeWidth(24.4)).toBe(24);
    expect(clampStrokeWidth(Number.NaN)).toBe(STROKE_WIDTH_MIN);
  });
});

describe("dashArrayFor", () => {
  it("a solid stroke has no dash pattern", () => {
    expect(dashArrayFor("solid", 8)).toBeUndefined();
    expect(dashArrayFor(undefined, 8)).toBeUndefined();
  });

  it("scales the dash rhythm with the stroke width", () => {
    expect(dashArrayFor("dashed", 2)).toBe("6 4");
    expect(dashArrayFor("dashed", 10)).toBe("30 20");
  });

  it("dotted is a sub-pixel dash so round caps render a row of dots", () => {
    const dash = dashArrayFor("dotted", 10);
    expect(dash).toBe("0.1 20");
  });
});

describe("resolveStroke", () => {
  it("defaults preserve the pre-upgrade look exactly", () => {
    const stroke = resolveStroke({}, "#0b1c33");
    expect(stroke).toMatchObject({
      color: "#0b1c33",
      width: 0,
      linecap: "round",
      linejoin: "round",
      opacity: 1,
      visible: false,
    });
    expect(stroke.dasharray).toBeUndefined();
  });

  it("dotted forces round caps (a sub-pixel dash with butt caps paints nothing)", () => {
    const stroke = resolveStroke({ strokeWidth: 6, strokeStyle: "dotted", strokeLinecap: "butt" }, "#000000");
    expect(stroke.linecap).toBe("round");
  });

  it("passes explicit color/width/style/cap/join/opacity through", () => {
    const stroke = resolveStroke(
      {
        stroke: "#ffffff",
        strokeWidth: 3,
        strokeStyle: "dashed",
        strokeLinecap: "square",
        strokeLinejoin: "miter",
        strokeOpacity: 0.4,
      },
      "#000000",
    );
    expect(stroke).toMatchObject({
      color: "#ffffff",
      width: 3,
      linecap: "square",
      linejoin: "miter",
      opacity: 0.4,
      visible: true,
    });
    expect(stroke.dasharray).toBe("9 6");
  });

  it("clamps opacity into 0..1", () => {
    expect(resolveStroke({ strokeWidth: 2, strokeOpacity: 5 }, "#000000").opacity).toBe(1);
    expect(resolveStroke({ strokeWidth: 2, strokeOpacity: -1 }, "#000000").opacity).toBe(0);
  });

  it("treats a non-positive width as no stroke", () => {
    expect(resolveStroke({ strokeWidth: 0, stroke: "#ffffff" }, "#000000").visible).toBe(false);
    expect(resolveStroke({ strokeWidth: -4 }, "#000000").width).toBe(0);
  });
});
