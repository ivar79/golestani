import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import { resolveLayerPathD } from "../path";

/**
 * A legacy 2-point arc draws a CIRCLE through `bend`, not the straight line
 * between its two anchors. Changing its node count must therefore convert it to
 * canonical parametric geometry first — resampling the two anchors directly
 * would flatten the arc into a line, which is the bug this pins.
 */
function docWithLegacyArc(): CardDocument {
  const arc: PathLayer = {
    id: "legacy-arc",
    kind: "path",
    pathMode: "curve",
    x: 200,
    y: 260,
    width: 500,
    height: 100,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    points: [
      { x: 0, y: 50, hIn: null, hOut: null },
      { x: 500, y: 50, hIn: null, hOut: null },
    ],
    bend: 0.5,
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
  };
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [arc] };
}

describe("node count on a legacy sagitta arc", () => {
  it("converts the circle into parametric nodes instead of flattening it", () => {
    const engine = new EditorEngine(docWithLegacyArc());
    expect(resolveLayerPathD((engine.snapshot().doc.layers[0] as PathLayer))).toContain(" A ");

    const before = engine.snapshot().doc.layers[0] as PathLayer;
    const start = { x: before.x + before.points[0].x, y: before.y + before.points[0].y };
    const end = { x: before.x + before.points[1].x, y: before.y + before.points[1].y };

    expect(engine.setCurveNodeCount("legacy-arc", 5)).toBe(true);
    const after = engine.snapshot().doc.layers[0] as PathLayer;

    expect(after.points).toHaveLength(5);
    // The bend model is gone and a real spec took over.
    expect(after.bend).toBeUndefined();
    expect(after.curve?.kind).toBe("arc");
    // sagitta = 0.5 * chord/2 = 125 for a 500px chord.
    expect(after.curve?.amplitude).toBeCloseTo(125, 3);
    // The chord is preserved: both ends stay where they were.
    expect(after.x + after.points[0].x).toBeCloseTo(start.x, 3);
    expect(after.y + after.points[0].y).toBeCloseTo(start.y, 3);
    expect(after.x + after.points[4].x).toBeCloseTo(end.x, 3);
    expect(after.y + after.points[4].y).toBeCloseTo(end.y, 3);
    // The arch is still tall: an arc flattened into a line would have ~0 height.
    expect(after.height).toBeGreaterThan(100);
    // And the layer is now an ordinary editable curve.
    expect(engine.isParametricCurve("legacy-arc")).toBe(true);
    expect(engine.curveNodeCount("legacy-arc")).toBe(5);
  });
});
