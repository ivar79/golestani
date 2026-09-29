import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShapeSvg, LayerVisual } from "../LayeredCardRenderer";
import type { PathLayer, ShapeLayer } from "../../domain/document";

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

function pathLayer(overrides: Partial<PathLayer> = {}): PathLayer {
  return {
    id: "p1",
    kind: "path",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    points: [
      { x: 0, y: 0, hIn: null, hOut: null },
      { x: 100, y: 50, hIn: null, hOut: null },
    ],
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    ...overrides,
  };
}

const shapeMarkup = (layer: ShapeLayer) => renderToStaticMarkup(createElement(ShapeSvg, { layer }));
const layerMarkup = (layer: ShapeLayer | PathLayer) => renderToStaticMarkup(createElement(LayerVisual, { layer }));

describe("ShapeSvg", () => {
  it("renders a rectangle as SVG, not CSS background/border", () => {
    const markup = shapeMarkup(shapeLayer({ stroke: "#000000", strokeWidth: 6 }));
    expect(markup).toContain("<rect");
    expect(markup).not.toContain("border");
    // The stroke is inset by half its width so it stays inside the box.
    expect(markup).toContain('x="3"');
    expect(markup).toContain('width="194"');
  });

  it("applies stroke style / cap / join / opacity for real", () => {
    const markup = shapeMarkup(
      shapeLayer({
        stroke: "#e11d48",
        strokeWidth: 6,
        strokeStyle: "dashed",
        strokeLinecap: "square",
        strokeLinejoin: "bevel",
        strokeOpacity: 0.4,
      }),
    );
    expect(markup).toContain('stroke-dasharray="18 12"');
    expect(markup).toContain('stroke-linecap="square"');
    expect(markup).toContain('stroke-linejoin="bevel"');
    expect(markup).toContain('stroke-opacity="0.4"');
    expect(markup).toContain('stroke="#e11d48"');
  });

  it("renders a rectangle with a corner radius", () => {
    expect(shapeMarkup(shapeLayer({ radius: 12 }))).toContain('rx="12"');
  });

  it("gives a LINE a real thickness from strokeWidth (not the box height)", () => {
    const markup = shapeMarkup(shapeLayer({ shape: "line", height: 40, stroke: "#111111", strokeWidth: 2 }));
    expect(markup).toContain("<line");
    expect(markup).toContain('stroke-width="2"');
    expect(markup).toContain('stroke="#111111"');
    // Inset by strokeWidth/2 = 1.
    expect(markup).toContain('x1="1"');
  });

  it("falls back to the box height for LEGACY lines (old documents keep their look)", () => {
    const markup = shapeMarkup(
      shapeLayer({ shape: "line", height: 40, stroke: undefined, strokeWidth: undefined, background: "#123456" }),
    );
    expect(markup).toContain('stroke-width="40"');
    expect(markup).toContain('stroke="#123456"');
  });

  it("renders a polygon with the requested vertex count", () => {
    const markup = shapeMarkup(shapeLayer({ shape: "polygon", sides: 5, width: 100, height: 100 }));
    const points = /points="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(points.split(" ")).toHaveLength(5);
  });

  it("converts an editor gradient fill into native SVG <defs>", () => {
    const markup = shapeMarkup(shapeLayer({ background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" }));
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('stop-color="#0ea5e9"');
    expect(markup).toContain('stop-color="#2563eb"');
    expect(markup).toContain('fill="url(#shape-grad-s1)"');
  });

  it("emits NO stroke attributes for a fill-only shape", () => {
    const markup = shapeMarkup(shapeLayer({ strokeWidth: 0 }));
    expect(markup).not.toContain("stroke-dasharray");
    expect(markup).not.toContain("stroke-width");
  });

  it("returns nothing for a degenerate box", () => {
    expect(shapeMarkup(shapeLayer({ width: 0 }))).toBe("");
  });
});

describe("PathVisual", () => {
  it("uses cubic segments and real dash/cap/join (no hardcoded round cap)", () => {
    const markup = layerMarkup(pathLayer({ strokeStyle: "dashed", strokeLinecap: "butt", strokeLinejoin: "miter" }));
    expect(markup).toContain(" C ");
    expect(markup).toContain('stroke-dasharray="12 8"');
    expect(markup).toContain('stroke-linecap="butt"');
    expect(markup).toContain('stroke-linejoin="miter"');
  });

  it("closes a path when the layer says so", () => {
    const closed = layerMarkup(
      pathLayer({
        closed: true,
        points: [
          { x: 0, y: 0, hIn: null, hOut: null },
          { x: 100, y: 0, hIn: null, hOut: null },
          { x: 100, y: 50, hIn: null, hOut: null },
        ],
      }),
    );
    expect(closed).toContain("Z");
  });
});
