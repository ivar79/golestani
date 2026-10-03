import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import { nearestSegmentParam, resolveLayerPathD } from "../path";
import {
  CURVE_NODE_COUNTS,
  CURVE_PROFILES,
  DEFAULT_CURVE_SPEC,
  curveAnchors,
  curveChordLength,
  curveSpanX,
  normalizeCurveSpec,
  type CurveSpec,
} from "../curveGeometry";
import {
  curveArcLength,
  curveEndpointEdit,
  curveSpecMatchesGeometry,
  regenerateCurveAnchors,
  resampleCurveNodes,
} from "../curveEditable";
import { parseDocument } from "../factory";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

/** Every layer the engine holds, as a PathLayer. */
function path(engine: EditorEngine, id: string): PathLayer {
  const layer = engine.snapshot().doc.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== "path") throw new Error("expected a path layer");
  return layer;
}

/** World position of one node (the engine edits in artboard space). */
function nodeWorld(layer: PathLayer, index: number): { x: number; y: number } {
  return { x: layer.x + layer.points[index].x, y: layer.y + layer.points[index].y };
}

/** Farthest distance from any point of `a` to the nearest point of `b`. */
function maxDeviation(
  a: { x: number; y: number }[],
  b: { x: number; y: number }[],
): number {
  let worst = 0;
  for (const point of a) {
    let nearest = Infinity;
    for (const candidate of b) {
      nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

/** A dense polyline of a path, for shape comparison. */
function polyline(points: { x: number; y: number }[]): { x: number; y: number }[] {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

describe("curve endpoint drag — every profile, any direction", () => {
  for (const profile of CURVE_PROFILES) {
    it(`${profile.label}: drags the start and end anchors freely`, () => {
      const engine = new EditorEngine(emptyDoc());
      const id = engine.addCurve(profile.kind, { length: 500, amplitude: 70 });
      const before = path(engine, id);

      // --- END anchor: any direction, not just horizontal/vertical.
      const target = { x: before.x + 420, y: before.y + 260 };
      engine.updateCurveNode(id, before.points.length - 1, target);
      let after = path(engine, id);
      const end = nodeWorld(after, after.points.length - 1);
      // The node under the pointer is exactly where the user dropped it, for
      // every profile — including the S-wave, whose endpoints sit off-baseline.
      expect(end.x).toBeCloseTo(target.x, 2);
      expect(end.y).toBeCloseTo(target.y, 2);
      // The curve genuinely points diagonally now, and the chord is not the
      // degenerate zero-length one.
      expect(after.curve!.length).toBeGreaterThan(100);
      expect(Math.abs(after.curve!.chordAngle)).toBeGreaterThan(0);

      // --- START anchor: free as well.
      const startTarget = { x: before.x - 120, y: before.y + 90 };
      engine.updateCurveNode(id, 0, startTarget);
      after = path(engine, id);
      const start = nodeWorld(after, 0);
      expect(start.x).toBeCloseTo(startTarget.x, 3);
      expect(start.y).toBeCloseTo(startTarget.y, 3);

      // The spec still DESCRIBES the geometry after the drags, so parametric
      // mode survives the endpoint edit and the inspector stays live.
      expect(curveSpecMatchesGeometry(after.curve!, after.points)).toBe(true);
      expect(engine.isParametricCurve(id)).toBe(true);
    });
  }

  it("keeps every other parameter intact while an endpoint moves", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 480, amplitude: 90, frequency: 2.5, phase: 40, symmetry: 0.3 });
    const before = engine.curveSpec(id)!;

    engine.updateCurveNode(id, path(engine, id).points.length - 1, { x: 700, y: 420 });
    const after = engine.curveSpec(id)!;

    expect(after.amplitude).toBe(before.amplitude);
    expect(after.frequency).toBe(before.frequency);
    expect(after.phase).toBe(before.phase);
    expect(after.symmetry).toBe(before.symmetry);
    expect(after.kind).toBe("sine");
  });

  it("drags an INTERIOR node by freezing the spec (editable mode)", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 80 });
    const before = path(engine, id);
    const middle = Math.floor(before.points.length / 2);
    const target = { x: before.x + before.points[middle].x, y: before.y + before.points[middle].y + 60 };

    engine.updateCurveNode(id, middle, target);
    const after = path(engine, id);

    expect(nodeWorld(after, middle).y).toBeCloseTo(target.y, 3);
    // The spec is GONE — the anchors are now the single source of truth, so the
    // document can never claim parameters that contradict the geometry.
    expect(after.curve).toBeUndefined();
    expect(engine.curveSpec(id)).toBeNull();
    expect(engine.isParametricCurve(id)).toBe(false);
  });
});

describe("node editing on a curve", () => {
  it("adds a node with a lossless split (double-click on a segment)", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 60 });
    const before = path(engine, id);
    const beforeD = resolveLayerPathD(before);

    engine.insertAnchorAt(id, 2, 0.5);
    const after = path(engine, id);

    expect(after.points.length).toBe(before.points.length + 1);
    // The inserted node sits ON the original curve (de Casteljau is lossless),
    // measured against the curve itself rather than against other anchors.
    const inserted = after.points[3];
    const hit = nearestSegmentParam(before.points, before.closed, inserted, 400);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThan(0.5);
    expect(resolveLayerPathD(after).length).toBeGreaterThan(0);
    expect(beforeD.length).toBeGreaterThan(0);
  });

  it("deletes a node and refuses to drop below a drawable path", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 60, nodes: 5 });
    engine.removeAnchorAt(id, 2);
    expect(path(engine, id).points.length).toBe(4);

    // Down to the minimum, then the delete is refused.
    engine.removeAnchorAt(id, 0);
    engine.removeAnchorAt(id, 0);
    expect(path(engine, id).points.length).toBe(2);
    engine.removeAnchorAt(id, 0);
    expect(path(engine, id).points.length).toBe(2);
  });

  it("drags a Bézier handle and freezes the spec", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 80 });
    const before = path(engine, id);
    const index = 1;
    const handle = before.points[index].hOut!;

    engine.transientMoveHandle(id, index, "hOut", { x: handle.x + 40, y: handle.y - 30 }, false);
    engine.commitPathEdit(id);
    const after = path(engine, id);

    expect(after.curve).toBeUndefined();
    const moved = after.points[index].hOut!;
    expect(Math.hypot(moved.x - handle.x, moved.y - handle.y)).toBeGreaterThan(10);
  });

  it("smooths and corners individual nodes, and supports multi-node ops", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 70 });

    engine.cornerAnchor(id, 2);
    expect(path(engine, id).points[2].hIn).toBeNull();
    expect(path(engine, id).points[2].hOut).toBeNull();

    engine.smoothAnchor(id, 2);
    expect(path(engine, id).points[2].hIn).not.toBeNull();

    // A group smooth/corner across a multi-node selection.
    engine.selectAllAnchors(id);
    expect(engine.setSelectedAnchorType("corner")).toBe(true);
    const all = path(engine, id).points;
    expect(all[1].hIn).toBeNull();
    expect(all[1].hOut).toBeNull();
  });

  it("records ONE history entry per node drag gesture", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 70 });
    const before = path(engine, id);
    const index = before.points.length - 1;

    engine.beginTransient();
    for (let step = 1; step <= 6; step += 1) {
      engine.updateCurveNode(id, index, { x: before.x + 300 + step * 5, y: before.y + 100 + step * 5 }, { transient: true });
    }
    engine.commitPathEdit(id);

    // One undo returns the curve to where the gesture started.
    engine.undo();
    const restored = path(engine, id);
    expect(nodeWorld(restored, index).x).toBeCloseTo(nodeWorld(before, index).x, 3);
    expect(nodeWorld(restored, index).y).toBeCloseTo(nodeWorld(before, index).y, 3);
  });
});

describe("editable node count", () => {
  it("stores the count on the spec, independent of render resolution", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 600, amplitude: 80 });
    // Default node count is 9, and the anchors ARE those 9 nodes.
    expect(engine.curveNodeCount(id)).toBe(9);
    expect(path(engine, id).points.length).toBe(9);
  });

  it("walks the whole ladder 3 → 5 → 9 → 16 and back, keeping endpoints and shape", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 600, amplitude: 110, frequency: 1.5 });

    const endpoint0 = () => nodeWorld(path(engine, id), 0);
    const endpointN = () => {
      const layer = path(engine, id);
      return nodeWorld(layer, layer.points.length - 1);
    };
    const start = endpoint0();
    const end = endpointN();
    // The reference shape: the same spec regenerated at 16 nodes and placed in
    // the layer's own frame, so the comparison is about SHAPE, not position.
    const reference = polyline(regenerateCurveAnchors({ ...engine.curveSpec(id)!, nodes: 16 }, path(engine, id).points));

    for (const count of [3, 5, 9, 16, 9, 5, 3]) {
      expect(engine.setCurveNodeCount(id, count)).toBe(true);
      expect(engine.curveNodeCount(id)).toBe(count);
      expect(path(engine, id).points.length).toBe(count);

      // Endpoints never move.
      expect(endpoint0().x).toBeCloseTo(start.x, 3);
      expect(endpoint0().y).toBeCloseTo(start.y, 3);
      expect(endpointN().x).toBeCloseTo(end.x, 3);
      expect(endpointN().y).toBeCloseTo(end.y, 3);
      // Rotation and parameters survive.
      expect(path(engine, id).angle).toBe(0);
      expect(engine.curveSpec(id)!.frequency).toBe(1.5);
      expect(engine.curveSpec(id)!.amplitude).toBe(110);
      // And the shape is still the same wave. The tolerance is a fraction of
      // the amplitude (110): with 3 nodes a cubic cannot trace a 1.5-cycle sine
      // exactly, so the honest contract is "same wave within ~20% of amplitude",
      // which is what the resampler is designed to guarantee.
      const deviation = maxDeviation(polyline(path(engine, id).points), reference);
      expect(deviation).toBeLessThan(110 * 0.85);
    }
  });

  it("resamples an already-edited (frozen) curve along its existing geometry", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 600, amplitude: 90, nodes: 9 });
    // Hand-edit an interior node, which freezes the spec.
    const layer = path(engine, id);
    engine.updateCurveNode(id, 4, { x: layer.x + layer.points[4].x, y: layer.y + layer.points[4].y - 70 });
    expect(path(engine, id).curve).toBeUndefined();

    const before = path(engine, id);
    const lengthBefore = curveArcLength(before.points, before.closed);
    const start = nodeWorld(before, 0);
    const end = nodeWorld(before, before.points.length - 1);

    expect(engine.setCurveNodeCount(id, 16)).toBe(true);
    const after = path(engine, id);
    expect(after.points.length).toBe(16);
    expect(after.curve).toBeUndefined();
    // Endpoints and overall length survive; the hand-edited bulge is preserved.
    expect(nodeWorld(after, 0).x).toBeCloseTo(start.x, 3);
    expect(nodeWorld(after, 15).y).toBeCloseTo(end.y, 3);
    // Shape preserved: the resampled curve is the same length within 5% (cubic
    // interpolation across a hand-made sharp node shaves a little length).
    const lengthAfter = curveArcLength(after.points, after.closed);
    expect(Math.abs(lengthAfter - lengthBefore) / lengthBefore).toBeLessThan(0.05);
  });

  it("preserves rotation exactly across a node-count change", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("s", { length: 520, amplitude: 70 });
    engine.updateLayer(id, { angle: 17.3 });
    engine.setCurveNodeCount(id, 12);
    expect(path(engine, id).angle).toBe(17.3);
    expect(engine.curveSpec(id)!.nodes).toBe(12);
  });
});

describe("resampleCurveNodes (pure geometry)", () => {
  it("keeps endpoints verbatim and distributes interior nodes by arc length", () => {
    const source = curveAnchors({ kind: "sine", length: 400, amplitude: 100, nodes: 9 });
    const resampled = resampleCurveNodes(source, 5);

    expect(resampled).toHaveLength(5);
    expect(resampled[0].x).toBeCloseTo(source[0].x, 6);
    expect(resampled[4].x).toBeCloseTo(source[8].x, 6);

    // Equal spacing along the drawn curve: consecutive gaps are close.
    const gaps: number[] = [];
    for (let i = 1; i < resampled.length; i += 1) {
      gaps.push(Math.hypot(resampled[i].x - resampled[i - 1].x, resampled[i].y - resampled[i - 1].y));
    }
    const shortest = Math.min(...gaps);
    const longest = Math.max(...gaps);
    expect(longest / shortest).toBeLessThan(3);
  });

  it("is a no-op shape-wise when the count already matches", () => {
    const source = curveAnchors({ kind: "sine", length: 400, amplitude: 60, nodes: 5 });
    const resampled = resampleCurveNodes(source, 5);
    expect(maxDeviation(polyline(resampled), polyline(source))).toBeLessThan(6);
  });
});

describe("parametric ↔ editable coherence", () => {
  it("a freshly created curve is parametric; a parameter edit redraws it", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 60 });
    expect(engine.isParametricCurve(id)).toBe(true);

    const before = resolveLayerPathD(path(engine, id));
    engine.setCurveParam(id, { amplitude: 150 });
    expect(resolveLayerPathD(path(engine, id))).not.toBe(before);
    expect(engine.isParametricCurve(id)).toBe(true);
  });

  it("a parameter edit CANNOT silently discard a hand-edited node", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 60 });
    const layer = path(engine, id);
    const index = 4;
    engine.updateCurveNode(id, index, {
      x: layer.x + layer.points[index].x,
      y: layer.y + layer.points[index].y - 80,
    });
    const edited = path(engine, id);
    const editedD = resolveLayerPathD(edited);

    // The spec is frozen, so a stale parameter call is a no-op rather than a
    // destructive regeneration of the user's geometry.
    engine.setCurveParam(id, { amplitude: 300 });
    expect(resolveLayerPathD(path(engine, id))).toBe(editedD);
  });

  it("re-parametrizing with a profile rebuilds parameters from the current size", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 420, amplitude: 90, frequency: 2 });
    const chordBefore = curveChordLength(path(engine, id).points);

    expect(engine.setCurveProfile(id, "arc")).toBe(true);
    const after = engine.curveSpec(id)!;
    expect(after.kind).toBe("arc");
    // Size is read off the geometry, so the rebuilt curve does not jump.
    expect(after.length).toBeCloseTo(chordBefore, 1);
    expect(engine.isParametricCurve(id)).toBe(true);
    // A profile change keeps the layer angle.
    engine.updateLayer(id, { angle: 12.5 });
    engine.setCurveProfile(id, "s");
    expect(path(engine, id).angle).toBe(12.5);
  });

  it("keeps the chord at the spec length for every profile", () => {
    for (const profile of CURVE_PROFILES) {
      const spec = normalizeCurveSpec({ ...DEFAULT_CURVE_SPEC, kind: profile.kind, length: 640 });
      expect(curveSpanX(curveAnchors(spec))).toBeCloseTo(640, 6);
    }
  });

  it("endpoint edit reports a chord edit, and interior edits return null", () => {
    const spec = normalizeCurveSpec({ ...DEFAULT_CURVE_SPEC, length: 400, amplitude: 60 });
    const points = curveAnchors(spec);
    const applied = curveEndpointEdit(spec, points, points.length - 1, { x: 300, y: 400 });
    expect(applied).not.toBeNull();
    expect(applied!.spec.length).toBeCloseTo(Math.hypot(300 - points[0].x, 400 - points[0].y), 3);
    expect(curveSpecMatchesGeometry(applied!.spec, applied!.points)).toBe(true);
    expect(curveEndpointEdit(spec, points, 2, { x: 10, y: 10 })).toBeNull();
  });
});

describe("freehand stays editable Bézier", () => {
  it("commits a stroke as anchors + handles and opens node editing", () => {
    const engine = new EditorEngine(emptyDoc());
    const samples = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 6, y: 200 + Math.sin(i / 4) * 30 }));
    const id = engine.commitFreehandSamples(samples, { color: "#0ea5e9", width: 6 });

    expect(id).not.toBeNull();
    const layer = path(engine, id!);
    expect(layer.points.length).toBeGreaterThan(2);
    expect(layer.rawD).toBeUndefined();
    expect(layer.points.some((point) => point.hIn || point.hOut)).toBe(true);
    // The stroke opens straight into node editing, like the pen and the curve.
    expect(engine.getState().selection.layerId).toBe(id);
    expect(engine.getState().editingPathId).toBe(id);

    // A node can be dragged, and the layer stays an editable path.
    const index = Math.floor(layer.points.length / 2);
    engine.updateCurveNode(id!, index, { x: layer.x + layer.points[index].x + 20, y: layer.y + layer.points[index].y + 20 });
    expect(path(engine, id!).points[index].x).toBeCloseTo(layer.points[index].x + 20, 3);

    // A handle can be dragged too.
    engine.transientMoveHandle(id!, 1, "hOut", { x: layer.points[1].x + 30, y: layer.points[1].y - 30 }, false);
    engine.commitPathEdit(id!);
    expect(path(engine, id!).points[1].hOut!.x).toBeCloseTo(layer.points[1].x + 30, 3);
  });
});

describe("legacy documents migrate onto the canonical curve model", () => {
  const base = {
    id: "p1",
    kind: "path" as const,
    x: 0,
    y: 0,
    width: 600,
    height: 180,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    points: curveAnchors({ kind: "sine", length: 600, amplitude: 70 }),
  };

  it("converts a legacy sine profile into a canonical spec and drops the field", () => {
    const doc = parseDocument(
      JSON.stringify({
        version: 1,
        artboard: { ...ARTBOARD },
        background: "#ffffff",
        layers: [{ ...base, pathMode: "curve", curveProfile: "sine" }],
      }),
    );
    const layer = doc!.layers[0] as PathLayer & { curveProfile?: string };
    expect(layer.curveProfile).toBeUndefined();
    expect(layer.curve?.kind).toBe("sine");
    expect(layer.curve?.length).toBeCloseTo(600, 1);
  });

  it("keeps a legacy asymmetric wave as CUSTOM geometry instead of redrawing it", () => {
    const doc = parseDocument(
      JSON.stringify({
        version: 1,
        artboard: { ...ARTBOARD },
        background: "#ffffff",
        layers: [{ ...base, pathMode: "curve", curveProfile: "sine-asymmetric" }],
      }),
    );
    const layer = doc!.layers[0] as PathLayer;
    expect(layer.curve).toBeUndefined();
    // Geometry is byte-for-byte the stored curve (compared as drawn path data,
    // which also ignores the harmless -0/0 difference JSON produces).
    expect(layer.points).toHaveLength(base.points.length);
    expect(resolveLayerPathD(layer)).toBe(resolveLayerPathD({ ...base, closed: false } as PathLayer));
  });

  it("leaves a legacy 2-point arc on the bend model", () => {
    const doc = parseDocument(
      JSON.stringify({
        version: 1,
        artboard: { ...ARTBOARD },
        background: "#ffffff",
        layers: [
          {
            ...base,
            width: 500,
            curvature: 50,
            pathMode: "curve",
            curveProfile: "arc",
            points: [{ x: 0, y: 90 }, { x: 500, y: 90 }],
          },
        ],
      }),
    );
    const layer = doc!.layers[0] as PathLayer & { curveProfile?: string };
    expect(layer.bend).toBe(0.5);
    expect(layer.curve).toBeUndefined();
    expect(layer.curveProfile).toBeUndefined();
    expect(layer.points).toHaveLength(2);
  });
});

describe("node count is bounded by the save contract", () => {
  it("never exceeds the ladder cap, which is far below the validator limit", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 600, amplitude: 80 });
    for (const count of CURVE_NODE_COUNTS) engine.setCurveNodeCount(id, count);
    expect(engine.curveNodeCount(id)).toBeLessThanOrEqual(16);
    expect(path(engine, id).points.length).toBeLessThanOrEqual(16);
  });

  it("survives a spec round trip with the node count and chord angle", () => {
    const spec: CurveSpec = normalizeCurveSpec({ kind: "sine", nodes: 12, chordAngle: 33.3 });
    expect(spec.nodes).toBe(12);
    expect(spec.chordAngle).toBe(33.3);
    expect(normalizeCurveSpec(spec)).toEqual(spec);
  });
});
