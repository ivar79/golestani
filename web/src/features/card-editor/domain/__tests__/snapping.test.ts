import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type CardLayer } from "../document";
import {
  SNAP_TOLERANCE_DEFAULT,
  buildSnapIndex,
  equalSpacingGuides,
  measureBetween,
  snapBoxToIndex,
  snapPointSmart,
  type Rect,
} from "../snapping";

function layer(id: string, x: number, y: number, width: number, height: number, overrides: Partial<CardLayer> = {}): CardLayer {
  return {
    id,
    kind: "text",
    x,
    y,
    width,
    height,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    z: 1,
    color: "#000000",
    background: null,
    text: "متن",
    fontSize: 20,
    fontWeight: 400,
    align: "start",
    fontFamily: "vazir",
    ...overrides,
  } as CardLayer;
}

function docWith(...layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

describe("buildSnapIndex", () => {
  it("collects box corners, centres, edges and artboard lines", () => {
    const index = buildSnapIndex(docWith(layer("a", 0, 0, 100, 50)));
    const pointKinds = new Set(index.points.map((target) => target.kind));
    expect(pointKinds.has("box-corner")).toBe(true);
    expect(pointKinds.has("box-center")).toBe(true);

    const lineKinds = new Set(index.lines.map((line) => line.kind));
    expect(lineKinds.has("box-edge")).toBe(true);
    expect(lineKinds.has("box-center")).toBe(true);
    expect(lineKinds.has("artboard-edge")).toBe(true);
    expect(lineKinds.has("artboard-center")).toBe(true);
  });

  it("skips hidden and faded layers, but a locked layer still attracts (like Figma)", () => {
    const index = buildSnapIndex(
      docWith(layer("hidden", 0, 0, 100, 100, { hidden: true }), layer("locked", 0, 0, 100, 100, { locked: true })),
    );
    expect(index.lines.some((line) => line.sourceId === "hidden")).toBe(false);
    expect(index.lines.some((line) => line.sourceId === "locked")).toBe(true);
  });

  it("excludeIds removes the dragged layer from its own index", () => {
    const index = buildSnapIndex(docWith(layer("a", 0, 0, 100, 100)), { excludeIds: ["a"] });
    expect(index.lines).toHaveLength(6); // artboard edges + centres only
  });
});

describe("snapPointSmart", () => {
  const index = buildSnapIndex(docWith(layer("a", 100, 100, 100, 50)));

  it("a point target wins and snaps BOTH axes at once", () => {
    const result = snapPointSmart({ x: 204, y: 153 }, index, { tolerance: 6 });
    expect(result.x).toBe(200);
    expect(result.y).toBe(150);
    expect(result.snappedX && result.snappedY).toBe(true);
    expect(result.kind).toBe("box-corner");
    expect(result.guides.length).toBe(2);
  });

  it("falls back to the nearest alignment line per axis", () => {
    // Far below the artboard, so only the box's x-lines can claim the point.
    const result = snapPointSmart({ x: 149, y: 400 }, index, { tolerance: 6 });
    expect(result.x).toBe(150);
    expect(result.snappedX).toBe(true);
    expect(result.snappedY).toBe(false);
    expect(result.guides).toHaveLength(1);
  });

  it("beyond tolerance nothing snaps and no guide appears", () => {
    const result = snapPointSmart({ x: 400, y: 400 }, index, { tolerance: 1 });
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
    expect(result.kind).toBeNull();
    expect(result.guides).toHaveLength(0);
  });

  it("axisLock lets only the closer axis claim the point", () => {
    // x deviation 2 (→150), y deviation 3 (→600 centre). Shift = the x win only.
    const result = snapPointSmart({ x: 148, y: 603 }, index, { tolerance: 6, axisLock: true });
    expect(result.snappedX).toBe(true);
    expect(result.snappedY).toBe(false);
    expect(result.x).toBe(150);
  });

  it("the grid catches a point that no line claimed", () => {
    const result = snapPointSmart({ x: 23, y: 23 }, buildSnapIndex(docWith()), { grid: 10, tolerance: 6 });
    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
    expect(result.kind).toBe("grid");
  });
});

describe("snapBoxToIndex", () => {
  const index = buildSnapIndex(docWith(layer("a", 0, 0, 100, 100)));

  it("the smallest correction wins per axis (edge or centre)", () => {
    // Box left edge 2px from a's right edge, vertically far from every y-line.
    const moved = snapBoxToIndex({ x: 102, y: 400, width: 50, height: 50 }, index);
    expect(moved.dx).toBe(-2);
    expect(moved.dy).toBe(0);
    expect(moved.snappedX).toBe(true);
    expect(moved.snappedY).toBe(false);
  });

  it("a centre-to-centre click-in wins when it is the closest candidate", () => {
    const centreIndex = buildSnapIndex(docWith(layer("a", 0, 0, 100, 100)));
    // Box centre x=52 vs target centre x=50 → delta −2 (centre beats edges).
    const moved = snapBoxToIndex({ x: 27, y: 400, width: 50, height: 50 }, centreIndex);
    expect(moved.dx).toBe(-2);
    // Guides explain the snap: one alignment line for x.
    expect(moved.guides.length).toBeGreaterThanOrEqual(1);
  });
});

describe("equalSpacingGuides", () => {
  const middle: Rect = { x: 200, y: 0, width: 50, height: 50 };
  const left: Rect = { x: 0, y: 10, width: 50, height: 30 };
  const right: Rect = { x: 400, y: 10, width: 50, height: 30 };

  it("shows the two gap measurements when both gaps match", () => {
    const guides = equalSpacingGuides(middle, [left, right], { axis: "x" });
    expect(guides).toHaveLength(2);
    expect(guides[0].kind).toBe("spacing");
    expect(guides[0].label).toBe("150");
    expect(guides[1].label).toBe("150");
  });

  it("stays silent when the gaps differ", () => {
    const guides = equalSpacingGuides({ ...middle, x: 210 }, [left, right], { axis: "x" });
    expect(guides).toHaveLength(0);
  });

  it("needs boxes on BOTH sides", () => {
    expect(equalSpacingGuides(middle, [left], { axis: "x" })).toHaveLength(0);
  });
});

describe("measureBetween", () => {
  it("reports dx, dy, distance and a labelled readout", () => {
    const measured = measureBetween({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(measured.dx).toBe(30);
    expect(measured.dy).toBe(40);
    expect(measured.distance).toBe(50);
    expect(measured.label).toBe("50 px");
    expect(measured.guides.length).toBe(2);
  });
});

describe("engine snapping integration", () => {
  it("smartSnapPoint snaps to another layer's edge and reports a guide", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 100), layer("b", 102, 0, 50, 50)));
    // Far below the boxes, so only the x edge line can claim it.
    const result = engine.smartSnapPoint({ x: 99, y: 400 }, { excludeIds: ["b"] });
    expect(result.x).toBe(100);
    expect(result.snappedX).toBe(true);
    expect(result.snappedY).toBe(false);
    expect(result.guides).toHaveLength(1);
  });

  it("setSnapping(false) disables and drops any live guides", () => {
    const engine = new EditorEngine(docWith(layer("a", 0, 0, 100, 100)));
    engine.publishSnapGuides([{ axis: "x", at: 50, from: 0, to: 100, kind: "align" }]);
    expect(engine.getState().snapGuides).toHaveLength(1);
    engine.setSnapping(false);
    expect(engine.getState().snapGuides).toHaveLength(0);
    // Snapped point result no longer moves… the helper still returns raw geometry.
    expect(engine.getState().snapping).toBe(false);
  });

  it("spacingGuides finds the equal-gap configuration from live layers", () => {
    const engine = new EditorEngine(
      docWith(layer("left", 0, 10, 50, 30), layer("middle", 200, 0, 50, 50), layer("right", 400, 10, 50, 30)),
    );
    const guides = engine.spacingGuides({ x: 200, y: 0, width: 50, height: 50 }, { excludeIds: ["middle"], axis: "x" });
    expect(guides).toHaveLength(2);
  });

  it("measure publishes the readout guides into view state", () => {
    const engine = new EditorEngine(docWith());
    const measured = engine.measure({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(measured.distance).toBe(50);
    expect(engine.getState().snapGuides.length).toBe(2);
    engine.clearSnapGuides();
    expect(engine.getState().snapGuides).toHaveLength(0);
  });
});

describe("module surface", () => {
  it("keeps the default tolerance exported for UI parity", () => {
    expect(SNAP_TOLERANCE_DEFAULT).toBe(6);
  });
});
