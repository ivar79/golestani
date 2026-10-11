import { describe, expect, it } from "vitest";
import type { ShapeLayer } from "../document";
import { selectLayerIdsByMarquee } from "../selectionMarquee";

function shapeLayer(overrides: Partial<ShapeLayer> & { id: string }): ShapeLayer {
  const { id, ...properties } = overrides;
  return {
    id,
    kind: "shape",
    shape: "rect",
    x: 10,
    y: 10,
    width: 40,
    height: 30,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: "#fff",
    radius: 0,
    stroke: null,
    strokeWidth: 0,
    ...properties,
  };
}

describe("selectLayerIdsByMarquee", () => {
  const layers = [
    shapeLayer({ id: "inside", x: 20, y: 20, width: 20, height: 20 }),
    shapeLayer({ id: "crossing", x: 75, y: 20, width: 35, height: 25 }),
    shapeLayer({ id: "touching", x: 55, y: 20, width: 20, height: 25 }),
    shapeLayer({ id: "hidden", x: 30, y: 20, hidden: true }),
    shapeLayer({ id: "locked", x: 30, y: 20, locked: true }),
  ];

  it("left-to-right selects only fully contained visible, unlocked layers", () => {
    expect(selectLayerIdsByMarquee(layers, { x: 0, y: 0 }, { x: 65, y: 60 })).toEqual(["inside"]);
  });

  it("right-to-left selects layers that intersect the rectangle", () => {
    expect(selectLayerIdsByMarquee(layers, { x: 125, y: 0 }, { x: 60, y: 60 })).toEqual(["crossing", "touching"]);
  });

  it("uses rotation-aware bounds for intersection", () => {
    const rotated = shapeLayer({ id: "rotated", x: 80, y: 80, width: 80, height: 10, angle: 45 });
    expect(selectLayerIdsByMarquee([rotated], { x: 90, y: 45 }, { x: 65, y: 80 })).toEqual(["rotated"]);
  });

  it("preserves layer ordering and rejects a rectangle with no matches", () => {
    expect(selectLayerIdsByMarquee(layers, { x: 500, y: 500 }, { x: 600, y: 590 })).toEqual([]);
  });
});
