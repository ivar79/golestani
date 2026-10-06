import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import {
  flattenSubPaths,
  layerAnchorsFromGeometry,
  nearestPointOnLayerPath,
  resolvePathGeometry,
} from "../geometry/canonical";
import type { Pt } from "../geometry/pathData";
import { resolveLayerPathD } from "../path";

/**
 * BEND ANYWHERE — the contract behind "grab any point of a line and curve that
 * spot".
 *
 * The bug this pins: a legacy two-point `bend` arc DRAWS a circle through its two
 * anchors, so the point editor used to show nodes on the CHORD and every press on
 * the visible curve missed the geometry (the line could only be curved at its
 * apex). The fix reads the anchors off the drawn cubics, so ONE hit test on the
 * drawn shape drives ONE loss-less insert.
 */

function docWith(layers: PathLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

function pathLayer(id: string, overrides: Partial<PathLayer> = {}): PathLayer {
  return {
    id,
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
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    ...overrides,
  } as PathLayer;
}

/** A two-point line on the legacy SAGITTA arc model. */
const legacyArc = (bend = 0.5, overrides: Partial<PathLayer> = {}) => pathLayer("arc", { bend, ...overrides });

/** A plain two-point line drawn straight from its anchors. */
const straightLine = () => pathLayer("line", { bend: undefined });

function layer(engine: EditorEngine, id: string): PathLayer {
  const found = engine.snapshot().doc.layers.find((item) => item.id === id);
  if (!found || found.kind !== "path") throw new Error("expected a path layer");
  return found;
}

/** Polyline samples of everything a layer DRAWS, in ARTBOARD space.
 *
 * World space on purpose: `commitPathEdit` re-origins the layer box, so the same
 * drawing has different LOCAL coordinates before and after a gesture and a local
 * comparison would report a jump that never happened. */
function drawnPolyline(target: PathLayer): Pt[][] {
  return flattenSubPaths(resolvePathGeometry(target), 0.2).map((poly) =>
    poly.points.map((point) => ({ x: point.x + target.x, y: point.y + target.y })),
  );
}

function flatten(polylines: Pt[][]): Pt[] {
  return polylines.flatMap((line) => line);
}

function distanceToPolylines(point: Pt, polylines: Pt[][]): number {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
      best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
    }
  }
  return best;
}

/** Farthest distance from any sample of `samples` to the polyline `shape`. */
function maxDeviationFrom(samples: Pt[], shape: Pt[][]): number {
  let worst = 0;
  for (const point of samples) worst = Math.max(worst, distanceToPolylines(point, shape));
  return worst;
}

/** Every anchor of a layer, in ARTBOARD space. */
function anchorPoints(target: PathLayer): Pt[] {
  return target.points.map((point) => ({ x: point.x + target.x, y: point.y + target.y }));
}

/** A point that is genuinely ON the layer's drawn shape (artboard space). */
function pointOnShape(target: PathLayer, at = 0.5): Pt {
  const poly = drawnPolyline(target)[0];
  if (!poly) throw new Error("expected the layer to have geometry");
  return poly[Math.max(0, Math.min(poly.length - 1, Math.round(at * (poly.length - 1))))];
}

/** Artboard point → the layer-local space the engine's pointer API speaks. */
function toLocal(target: PathLayer, point: Pt): Pt {
  return { x: point.x - target.x, y: point.y - target.y };
}

describe("legacy arc → editable anchors", () => {
  it("reads the anchors off the DRAWN arc, not off the chord", () => {
    const arc = legacyArc();
    const geometry = layerAnchorsFromGeometry(arc);
    expect(geometry.points.length).toBeGreaterThan(2);
    expect(geometry.closed).toBe(false);

    const shape = drawnPolyline(arc);
    const world = (point: Pt): Pt => ({ x: point.x + arc.x, y: point.y + arc.y });
    // Every reconstructed anchor lies on the circle the layer draws.
    for (const point of geometry.points) expect(distanceToPolylines(world(point), shape)).toBeLessThan(0.6);
    // The chord's midpoint is 125px off the arc — the old model put nodes there.
    expect(distanceToPolylines(world({ x: 250, y: 50 }), shape)).toBeGreaterThan(100);
  });

  it("preserves the drawn shape for straight, minor and major arcs", () => {
    for (const bend of [0, 0.25, 0.5, -0.5, 1.2]) {
      const arc = legacyArc(bend);
      const geometry = layerAnchorsFromGeometry(arc);
      const rebuilt = { ...arc, points: geometry.points, closed: geometry.closed, bend: undefined } as PathLayer;
      expect(maxDeviationFrom(anchorPoints(rebuilt), drawnPolyline(arc))).toBeLessThan(0.6);
    }
  });

  it("keeps the arc while the user is only LOOKING at the nodes, and converts on the first bend", () => {
    const engine = new EditorEngine(docWith([legacyArc()]));
    expect(resolveLayerPathD(layer(engine, "arc"))).toContain(" A ");

    // Entering the mode must not destroy the parametric line: the arc slider
    // survives a click-through, and the two nodes it shows are the arc's ends.
    engine.setPathEditing("arc");
    expect(layer(engine, "arc").bend).toBe(0.5);
    expect(layer(engine, "arc").points).toHaveLength(2);

    // The FIRST structural edit is what converts, losslessly.
    const onArc = pointOnShape(layer(engine, "arc"), 0.4);
    engine.beginTransient();
    const started = engine.beginBend("arc", toLocal(layer(engine, "arc"), onArc), 9);
    engine.commitPathEdit("arc");
    const edited = layer(engine, "arc");
    expect(started).not.toBeNull();
    expect(edited.bend).toBeUndefined();
    expect(edited.points.length).toBeGreaterThan(2);

    // The whole point of the fix: no anchor sits in mid-air off the drawn line.
    const shape = drawnPolyline(edited);
    for (const point of anchorPoints(edited)) expect(distanceToPolylines(point, shape)).toBeLessThan(0.6);
  });

  it("converts the arc on an EXPLICIT request, and one undo brings it back", () => {
    const engine = new EditorEngine(docWith([legacyArc()]));
    const before = drawnPolyline(layer(engine, "arc"));
    expect(engine.freezeBendArc("arc")).toBe(true);

    const frozen = layer(engine, "arc");
    expect(frozen.bend).toBeUndefined();
    expect(maxDeviationFrom(flatten(drawnPolyline(frozen)), before)).toBeLessThan(0.6);

    engine.undo();
    expect(layer(engine, "arc").bend).toBe(0.5);
    expect(layer(engine, "arc").points).toHaveLength(2);
  });

  it("stops a node edit from being shadowed by the arc model", () => {
    const engine = new EditorEngine(docWith([legacyArc()]));
    const before = resolveLayerPathD(layer(engine, "arc"));

    engine.insertAnchorAt("arc", 0, 0.5);
    const edited = layer(engine, "arc");
    expect(edited.bend).toBeUndefined();
    expect(edited.points).toHaveLength(3);
    // A stale `bend` would have kept drawing the old circle and hidden the edit.
    expect(resolveLayerPathD(edited)).not.toBe(before);
  });
});

describe("bendPointAt — the hit test behind the bend dot", () => {
  it("finds a point ON the arc for a pointer on the arc, and nothing far from it", () => {
    const engine = new EditorEngine(docWith([legacyArc()]));
    // The apex of a bend 0.5 arc on a 500px chord is 125px off the chord, and the
    // engine edits in layer-local coordinates.
    const apex = { x: 250, y: 175 };
    const hit = engine.bendPointAt("arc", apex, 9);
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit!.point.x - apex.x, hit!.point.y - apex.y)).toBeLessThan(0.5);

    // 100px inside the arc is on the chord side of the line: nothing is near.
    expect(engine.bendPointAt("arc", { x: 250, y: 60 }, 9)).toBeNull();
  });

  it("hit-tests a parametric curve through its spec geometry", () => {
    const engine = new EditorEngine(docWith([straightLine()]));
    expect(engine.setCurveProfile("line", "sine")).toBe(true);
    const current = layer(engine, "line");
    const local = toLocal(current, pointOnShape(current));
    const hit = engine.bendPointAt("line", local, 9);
    expect(hit).not.toBeNull();
    // Everything the engine reports as "on the line" is, in fact, ON the drawn
    // line (artboard space here: the engine answers in layer-local space).
    const world = { x: hit!.point.x + current.x, y: hit!.point.y + current.y };
    expect(distanceToPolylines(world, drawnPolyline(current))).toBeLessThan(0.5);
    expect(nearestPointOnLayerPath(current, local, 64)?.distance).toBeLessThan(0.5);
  });
});

describe("beginBend — one gesture, one node, one record", () => {
  it("inserts the node where the pointer touched the line, without moving it", () => {
    const engine = new EditorEngine(docWith([straightLine()]));
    const before = drawnPolyline(layer(engine, "line"));
    const pressed = { x: layer(engine, "line").x + 125, y: layer(engine, "line").y + 50 };

    engine.beginTransient();
    const started = engine.beginBend("line", { x: 125, y: 50 }, 9);
    engine.commitPathEdit("line");

    expect(started).not.toBeNull();
    const edited = layer(engine, "line");
    expect(edited.points).toHaveLength(3);
    expect(started!.index).toBe(1);
    // A loss-less split: the drawing did not move by a pixel, and the new node
    // sits exactly under the pointer.
    expect(maxDeviationFrom(flatten(drawnPolyline(edited)), before)).toBeLessThan(0.05);
    expect(Math.hypot(anchorPoints(edited)[1].x - pressed.x, anchorPoints(edited)[1].y - pressed.y)).toBeLessThan(0.05);
  });

  it("freezes an arc and curves EXACTLY where the pointer pressed", () => {
    const engine = new EditorEngine(docWith([legacyArc()]));
    const before = drawnPolyline(layer(engine, "arc"));
    const onArc = pointOnShape(layer(engine, "arc"), 0.3);

    engine.beginTransient();
    const started = engine.beginBend("arc", toLocal(layer(engine, "arc"), onArc), 9);
    expect(started).not.toBeNull();

    const inserted = layer(engine, "arc");
    expect(inserted.bend).toBeUndefined();
    expect(inserted.points.length).toBeGreaterThan(2);
    expect(maxDeviationFrom(flatten(drawnPolyline(inserted)), before)).toBeLessThan(0.6);
    // The new node is the GRABBED SPOT, not the middle of a chord.
    const node = anchorPoints(inserted)[started!.index];
    expect(Math.hypot(node.x - onArc.x, node.y - onArc.y)).toBeLessThan(1);

    // Drag it and release: ONE history record for insert + move, so a single undo
    // brings the intact circular arc back.
    engine.transientMoveAnchor("arc", started!.index, {
      x: inserted.points[started!.index].x - 60,
      y: inserted.points[started!.index].y - 60,
    });
    engine.commitPathEdit("arc");
    expect(anchorPoints(layer(engine, "arc"))[started!.index].y).toBeLessThan(node.y);

    engine.undo();
    const restored = layer(engine, "arc");
    expect(restored.bend).toBe(0.5);
    expect(restored.points).toHaveLength(2);
    expect(resolveLayerPathD(restored)).toContain(" A ");
  });

  it("drops a parametric spec on the first bend, like every other node edit", () => {
    const engine = new EditorEngine(docWith([straightLine()]));
    engine.setCurveProfile("line", "sine");
    expect(layer(engine, "line").curve?.kind).toBe("sine");

    const before = drawnPolyline(layer(engine, "line"));
    const onCurve = pointOnShape(layer(engine, "line"));
    engine.beginTransient();
    const started = engine.beginBend("line", toLocal(layer(engine, "line"), onCurve), 9);
    engine.commitPathEdit("line");

    expect(started).not.toBeNull();
    const edited = layer(engine, "line");
    expect(edited.curve).toBeUndefined();
    expect(maxDeviationFrom(flatten(drawnPolyline(edited)), before)).toBeLessThan(0.6);
  });

  it("adopts a single-contour rawD shape (the seeded paths the inspector shows)", () => {
    // The realistic case: the layer DRAWS `rawD` (so its anchor list is not the
    // line the user sees), which is why pressing the visible line did nothing.
    const engine = new EditorEngine(
      docWith([
        pathLayer("arc", {
          bend: undefined,
          points: [
            { x: 0, y: 40, hIn: null, hOut: null },
            { x: 400, y: 40, hIn: null, hOut: null },
          ],
          rawD: "M 0 0 C 130 0 270 0 400 0",
        }),
      ]),
    );

    engine.beginTransient();
    const started = engine.beginBend("arc", { x: 200, y: 0 }, 9);
    expect(started).not.toBeNull();
    const adopted = layer(engine, "arc");
    // `rawD` stops shadowing the anchors and the node lands on the drawn line.
    expect(adopted.rawD).toBeUndefined();
    expect(adopted.points.length).toBeGreaterThan(2);
    expect(anchorPoints(adopted)[started!.index].y).toBeCloseTo(adopted.y, 1);
  });

  it("refuses a multi-contour ornament and a pointer that is nowhere near the line", () => {
    const ornament = new EditorEngine(
      docWith([pathLayer("arc", { bend: undefined, points: [], rawD: "M 0 0 L 400 0 M 0 40 L 400 40" })]),
    );
    expect(ornament.beginBend("arc", { x: 200, y: 0 }, 9)).toBeNull();
    expect(layer(ornament, "arc").rawD).toBe("M 0 0 L 400 0 M 0 40 L 400 40");

    const plain = new EditorEngine(docWith([straightLine()]));
    expect(plain.beginBend("line", { x: 250, y: 400 }, 9)).toBeNull();
    expect(layer(plain, "line").points).toHaveLength(2);
  });
});
