import { describe, expect, it } from "vitest";
import type { ShapeLayer } from "../document";
import {
  clampSides,
  resolveShapeFill,
  resolveShapePaint,
  resolveShapeStroke,
  shapePrimitives,
  type SvgPrimitive,
} from "../shapes";

/** Vertex list of a polygon primitive (the union type needs narrowing). */
function pointsOf(primitive: SvgPrimitive): string {
  if (primitive.tag !== "polygon") throw new Error(`expected a polygon, got ${primitive.tag}`);
  return primitive.attrs.points;
}

function shapeLayer(overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: "s1",
    kind: "shape",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: "#0ea5e9",
    shape: "rect",
    radius: 0,
    ...overrides,
  };
}

describe("shapePrimitives", () => {
  it("returns nothing for a degenerate box", () => {
    expect(shapePrimitives("rect", 0, 100)).toEqual([]);
    expect(shapePrimitives("rect", -5, 100)).toEqual([]);
  });

  it("a rect fills its box exactly when there is no stroke", () => {
    expect(shapePrimitives("rect", 200, 100, { strokeWidth: 0 })).toEqual([
      { tag: "rect", attrs: { x: 0, y: 0, width: 200, height: 100, rx: 0, ry: 0 } },
    ]);
  });

  it("insets every shape by half the stroke so the stroke stays inside the box", () => {
    expect(shapePrimitives("rect", 200, 100, { strokeWidth: 10 })[0].attrs).toMatchObject({
      x: 5,
      y: 5,
      width: 190,
      height: 90,
    });
    expect(shapePrimitives("ellipse", 200, 100, { strokeWidth: 10 })[0].attrs).toMatchObject({
      cx: 100,
      cy: 50,
      rx: 95,
      ry: 45,
    });
    expect(shapePrimitives("line", 200, 40, { strokeWidth: 8 })[0].attrs).toMatchObject({
      x1: 4,
      y1: 20,
      x2: 196,
      y2: 20,
    });
  });

  it("clamps the corner radius to half the box", () => {
    expect(shapePrimitives("rect", 100, 40, { radius: 999 })[0].attrs).toMatchObject({ rx: 20, ry: 20 });
    expect(shapePrimitives("rect", 100, 40, { radius: 12 })[0].attrs).toMatchObject({ rx: 12, ry: 12 });
  });

  it("builds a regular polygon with the requested vertex count, starting at the top", () => {
    const hexagon = pointsOf(shapePrimitives("polygon", 200, 200, { sides: 6 })[0]);
    expect(hexagon.split(" ")).toHaveLength(6);
    expect(hexagon.startsWith("100,0")).toBe(true);

    expect(pointsOf(shapePrimitives("polygon", 200, 200, { sides: 3 })[0]).split(" ")).toHaveLength(3);
  });

  it("clamps the polygon vertex count into 3..12", () => {
    expect(clampSides(1)).toBe(3);
    expect(clampSides(99)).toBe(12);
    expect(clampSides(undefined)).toBe(6);
    expect(pointsOf(shapePrimitives("polygon", 100, 100, { sides: 2 })[0]).split(" ")).toHaveLength(3);
  });

  it("keeps the star on its min-side fit and the triangle on the full box", () => {
    expect(pointsOf(shapePrimitives("star", 200, 100)[0]).split(" ")).toHaveLength(10);
    expect(pointsOf(shapePrimitives("triangle", 200, 100)[0])).toBe("100,0 200,100 0,100");
  });

  it("does not let a thick stroke push geometry outside the layer box", () => {
    const width = 300;
    const height = 200;
    const strokeWidth = 20;

    expect(shapePrimitives("rect", width, height, { strokeWidth })[0].attrs).toMatchObject({
      x: strokeWidth / 2,
      y: strokeWidth / 2,
      width: width - strokeWidth,
      height: height - strokeWidth,
    });
    expect(shapePrimitives("ellipse", width, height, { strokeWidth })[0].attrs).toMatchObject({
      rx: (width - strokeWidth) / 2,
      ry: (height - strokeWidth) / 2,
    });

    const pairs = pointsOf(shapePrimitives("star", width, height, { strokeWidth })[0])
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    const xs = pairs.map(([x]) => x);
    const ys = pairs.map(([, y]) => y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(width);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height);
  });
});

describe("resolveShapeStroke", () => {
  it("gives a line a REAL width from strokeWidth, in the line's own colour", () => {
    const stroke = resolveShapeStroke(shapeLayer({ shape: "line", strokeWidth: 12, stroke: "#ff0000", background: null }));
    expect(stroke).toMatchObject({ color: "#ff0000", width: 12, visible: true });
  });

  it("falls back to the box height for legacy lines (thickness used to be the box)", () => {
    const stroke = resolveShapeStroke(
      shapeLayer({ shape: "line", height: 36, stroke: undefined, strokeWidth: undefined, background: "#123456" }),
    );
    expect(stroke.width).toBe(36);
    expect(stroke.color).toBe("#123456");
    expect(stroke.visible).toBe(true);
  });

  it("carries dash/cap/join/opacity for a line too", () => {
    const stroke = resolveShapeStroke(
      shapeLayer({ shape: "line", strokeWidth: 4, stroke: "#111111", strokeStyle: "dashed", strokeOpacity: 0.5 }),
    );
    expect(stroke.dasharray).toBe("12 8");
    expect(stroke.opacity).toBe(0.5);
  });

  it("a shape with strokeWidth 0 has no visible stroke", () => {
    const stroke = resolveShapeStroke(shapeLayer({ strokeWidth: 0 }));
    expect(stroke.visible).toBe(false);
    expect(stroke.width).toBe(0);
  });
});

describe("resolveShapeFill", () => {
  it("uses the editor gradient when the fill is one", () => {
    const fill = resolveShapeFill(shapeLayer({ background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" }));
    expect(fill.kind).toBe("gradient");
    if (fill.kind === "gradient") {
      expect(fill.spec.angle).toBe(135);
      expect(fill.spec.stops).toHaveLength(2);
    }
  });

  it("expands 8-digit hex to rgba so SVG 1.1 consumers agree", () => {
    expect(resolveShapeFill(shapeLayer({ background: "#0ea5e980" }))).toEqual({
      kind: "solid",
      color: "rgba(14, 165, 233, 0.502)",
    });
  });

  it("a line has no fill — the stroke IS the ink", () => {
    expect(resolveShapeFill(shapeLayer({ shape: "line" })).kind).toBe("none");
  });

  it("falls back to the default accent when neither background nor color is set", () => {
    expect(resolveShapeFill(shapeLayer({ background: null, color: null }))).toEqual({
      kind: "solid",
      color: "#0ea5e9",
    });
  });
});

describe("resolveShapePaint", () => {
  it("resolves the geometry inset from the resolved stroke width (never disagreeing)", () => {
    const paint = resolveShapePaint(shapeLayer({ shape: "rect", strokeWidth: 10, stroke: "#000000" }));
    expect(paint.stroke.width).toBe(10);
    expect(paint.primitives[0].attrs).toMatchObject({ x: 5, y: 5, width: 190, height: 90 });
  });

  it("uses the box height as the inset for a legacy line so nothing is clipped", () => {
    const paint = resolveShapePaint(
      shapeLayer({ shape: "line", height: 20, strokeWidth: undefined, stroke: undefined, background: "#000000" }),
    );
    expect(paint.primitives[0].attrs).toMatchObject({ x1: 10, y1: 10, x2: 190, y2: 10 });
  });
});
