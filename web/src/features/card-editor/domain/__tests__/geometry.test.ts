/**
 * Snapping + geometry contracts.
 */
import { describe, expect, it } from "vitest";
import { ARTBOARD, type CardDocument } from "../document";
import { clampZoom, fitZoom, framesBounds, keepInside, MAX_ZOOM, MIN_ZOOM, panForZoomAtPoint, snapCenter, snapCoordinate, snapLayerPosition } from "../geometry";

function makeDoc(layers: { x: number; y: number; width: number; height: number }[]): CardDocument {
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: layers.map((l, i) => ({
      id: `layer-${i}`,
      kind: "shape",
      shape: "rect",
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      angle: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      color: null,
      background: "#000000",
      radius: 0,
    })),
  } as unknown as CardDocument;
}

describe("fitZoom", () => {
  it("fits a smaller container by scaling down", () => {
    expect(fitZoom(500, 300)).toBeLessThan(1);
    expect(fitZoom(500, 300)).toBeCloseTo(500 / ARTBOARD.width);
  });

  it("returns the raw fit ratio for a huge container (zoom above 1 is allowed)", () => {
    expect(fitZoom(100000, 100000)).toBe(100000 / ARTBOARD.width);
  });
});

describe("keepInside", () => {
  it("clamps a layer to the artboard margins", () => {
    const r = keepInside(-9999, -9999, 100, 60);
    expect(r.x).toBe(-100 + 12);
    expect(r.y).toBe(-60 + 12);
  });

  it("keeps at least a 12px margin reachable on the far side", () => {
    const r = keepInside(99999, 99999, 100, 60);
    expect(r.x).toBe(ARTBOARD.width - 12);
    expect(r.y).toBe(ARTBOARD.height - 12);
  });
});

describe("snapCenter", () => {
  it("snaps X to artboard center within threshold", () => {
    const target = ARTBOARD.width / 2;
    const r = snapCenter(target - 100 + 4, 200);
    expect(r.snapped).toBe(true);
    expect(r.value).toBe(target - 100);
  });

  it("leaves a far position alone", () => {
    const r = snapCenter(10, 200);
    expect(r.snapped).toBe(false);
    expect(r.value).toBe(10);
  });

  it("can snap Y to the vertical center too", () => {
    const target = ARTBOARD.height / 2;
    const r = snapCenter(target - 100 + 3, 200, "y");
    expect(r.snapped).toBe(true);
    expect(r.value).toBe(target - 100);
  });
});

describe("snapLayerPosition", () => {
  it("snaps to the artboard vertical center line", () => {
    const doc = makeDoc([]);
    const target = ARTBOARD.width / 2;
    const res = snapLayerPosition(doc, "drag", { x: target - 100 - 4, y: 50 }, { width: 200, height: 40 });
    expect(res.pos.x).toBe(target - 100);
    expect(res.guides.length).toBe(1);
    expect(res.guides[0].axis).toBe("x");
  });

  it("snaps to another layer's left edge", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    const res = snapLayerPosition(doc, "drag", { x: 500 - 6, y: 300 }, { width: 120, height: 40 });
    expect(res.pos.x).toBe(500);
    expect(res.guides.some((g) => g.axis === "x" && g.at === 500)).toBe(true);
  });

  it("snaps to another layer's horizontal center", () => {
    const other = { x: 400, y: 100, width: 200, height: 60 };
    const doc = makeDoc([other]);
    const center = other.x + other.width / 2; // 500
    const res = snapLayerPosition(doc, "drag", { x: center - 60 + 3, y: 300 }, { width: 120, height: 40 });
    expect(res.pos.x).toBe(center - 60);
  });

  it("snaps Y against another layer's top edge", () => {
    const doc = makeDoc([{ x: 100, y: 400, width: 200, height: 60 }]);
    const res = snapLayerPosition(doc, "drag", { x: 100, y: 400 - 5 }, { width: 120, height: 40 });
    expect(res.pos.y).toBe(400);
  });

  it("ignores hidden layers as snap sources", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    doc.layers[0].hidden = true;
    // Far from every artboard guide so a hidden layer is the only candidate.
    const res = snapLayerPosition(doc, "drag", { x: 500 - 6, y: 410 }, { width: 120, height: 40 });
    expect(res.guides.length).toBe(0);
  });

  it("never snaps the dragged layer against itself", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    const res = snapLayerPosition(doc, "layer-0", { x: 500 - 6, y: 100 }, { width: 200, height: 60 });
    expect(res.guides.length).toBe(0);
  });

  it("does not move the position when nothing is close", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    // (42,470): its y-center is 490 — clear of every guide incl. the other layer.
    const res = snapLayerPosition(doc, "drag", { x: 42, y: 470 }, { width: 120, height: 40 });
    expect(res.pos.x).toBe(42);
    expect(res.pos.y).toBe(470);
    expect(res.guides.length).toBe(0);
  });
});

/**
 * Resize snapping: the dragged EDGE is the pointer coordinate, so snapping the
 * coordinate lands the edge on the guide.
 */
describe("snapCoordinate", () => {
  it("snaps to an artboard edge and reports the guide", () => {
    const doc = makeDoc([]);
    const res = snapCoordinate(doc, "drag", 3, "x");
    expect(res.value).toBe(0);
    expect(res.guide).toMatchObject({ axis: "x", at: 0 });
  });

  it("snaps to the artboard centre line", () => {
    const doc = makeDoc([]);
    const res = snapCoordinate(doc, "drag", ARTBOARD.width / 2 + 4, "x");
    expect(res.value).toBe(ARTBOARD.width / 2);
  });

  it("snaps to another visible layer's edges and centre", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    // 699 is 1px from the other layer's right edge (700).
    expect(snapCoordinate(doc, "drag", 699, "x").value).toBe(700);
    // 601 is 1px from its centre (600).
    expect(snapCoordinate(doc, "drag", 601, "x").value).toBe(600);
    // 498 is 2px from its left edge (500).
    expect(snapCoordinate(doc, "drag", 498, "x").value).toBe(500);
  });

  it("never snaps an edge against its own layer", () => {
    const doc = makeDoc([{ x: 500, y: 100, width: 200, height: 60 }]);
    const res = snapCoordinate(doc, "layer-0", 501, "x");
    expect(res.value).toBe(501);
    expect(res.guide).toBeNull();
  });

  it("leaves a value alone when nothing is within the threshold", () => {
    const doc = makeDoc([]);
    const res = snapCoordinate(doc, "drag", 137, "y");
    expect(res.value).toBe(137);
    expect(res.guide).toBeNull();
  });
});

/** Group frame derivation (never stored on the document). */
describe("framesBounds", () => {
  it("returns null for an empty set", () => {
    expect(framesBounds([])).toBeNull();
  });

  it("wraps every frame", () => {
    expect(framesBounds([
      { x: 100, y: 100, width: 200, height: 100 },
      { x: 400, y: 200, width: 100, height: 50 },
    ])).toEqual({ x: 100, y: 100, width: 400, height: 150 });
  });
});

/**
 * Zoom-at-cursor: the pan correction must keep the point under the pointer
 * fixed, which is what makes wheel zoom feel anchored. `pan' = pan +
 * (cursor - origin)(1 - next/zoom)`.
 */
describe("zoom", () => {
  it("clamps zoom to the shared limits", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1.23456)).toBe(1.235);
  });

  it("keeps the point under the cursor fixed while zooming in", () => {
    const zoom = 1;
    const nextZoom = 2;
    const origin = { x: 100, y: 50 };
    const cursor = { x: 300, y: 250 };
    const pan = { x: 0, y: 0 };

    // Artboard point under the cursor before the zoom.
    const content = { x: (cursor.x - origin.x) / zoom, y: (cursor.y - origin.y) / zoom };
    const nextPan = panForZoomAtPoint(pan, origin, cursor, zoom, nextZoom);
    const nextOrigin = { x: origin.x + nextPan.x, y: origin.y + nextPan.y };

    // The same artboard point must sit under the cursor afterwards.
    expect((cursor.x - nextOrigin.x) / nextZoom).toBeCloseTo(content.x, 6);
    expect((cursor.y - nextOrigin.y) / nextZoom).toBeCloseTo(content.y, 6);
  });

  it("does not move the pan when the zoom is unchanged", () => {
    const pan = { x: 12, y: -8 };
    expect(panForZoomAtPoint(pan, { x: 0, y: 0 }, { x: 200, y: 200 }, 1.5, 1.5)).toEqual(pan);
  });
});


describe("user-guide snapping for layers", () => {
  it("snaps layer positions to vertical and horizontal user guides regardless of layer kind", () => {
    const doc = makeDoc([{ x: 0, y: 0, width: 20, height: 20 }]);
    const vertical = snapLayerPosition(doc, "layer-0", { x: 97, y: 40 }, { width: 20, height: 20 }, 6, [{ axis: "x", at: 100 }]);
    expect(vertical.pos.x).toBe(100);
    expect(vertical.guides).toContainEqual({ axis: "x", at: 100, edge: "start" });

    const horizontal = snapLayerPosition(doc, "layer-0", { x: 40, y: 147 }, { width: 20, height: 20 }, 6, [{ axis: "y", at: 150 }]);
    expect(horizontal.pos.y).toBe(150);
    expect(horizontal.guides).toContainEqual({ axis: "y", at: 150, edge: "start" });
  });
});
