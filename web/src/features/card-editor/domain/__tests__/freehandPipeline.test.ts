import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer, type PathPoint } from "../document";
import {
  DEFAULT_FREEHAND_OPTIONS,
  effectiveSmoothing,
  freehandPipeline,
  normalizeFreehandOptions,
  simplifyAnchors,
  simplifyEpsilonFor,
  smoothSamples,
  straightModePath,
} from "../freehandModes";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

/** A shaky 45° run whose samples wobble around the ideal line. */
function shakyDiagonal(count = 24, step = 6, wobble = 1.2, angle = 43): { x: number; y: number }[] {
  const rad = (angle * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => ({
    x: i * step * Math.cos(rad) + (i % 2 === 0 ? wobble : -wobble),
    y: i * step * Math.sin(rad) + (i % 3 === 0 ? -wobble : wobble),
  }));
}

describe("freehand pipeline (pure)", () => {
  it("normalizes options and falls back to a sane snapping grid", () => {
    const options = normalizeFreehandOptions({ mode: "constrained", angleIncrements: [], smoothing: 4, fidelity: -1 });
    expect(options.mode).toBe("constrained");
    expect(options.angleIncrements).toEqual([45]);
    expect(options.smoothing).toBe(1);
    expect(options.fidelity).toBe(0);
  });

  it("smoothing averages jitter but never moves the two ends", () => {
    const samples = shakyDiagonal();
    const smoothed = smoothSamples(samples, 0.5);
    expect(smoothed[0]).toEqual(samples[0]);
    expect(smoothed.at(-1)).toEqual(samples.at(-1));
    const jitter = (points: { x: number; y: number }[]) => {
      let total = 0;
      for (let i = 1; i < points.length; i += 1) {
        total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
      }
      return total;
    };
    expect(jitter(smoothed)).toBeLessThan(jitter(samples));
  });

  it("fidelity drives simplification and caps the smoothing it allows", () => {
    expect(simplifyEpsilonFor(0.75)).toBeCloseTo(2.5, 6); // historical default
    expect(simplifyEpsilonFor(1)).toBeLessThan(simplifyEpsilonFor(0.2));
    expect(effectiveSmoothing(1, 1)).toBeLessThan(effectiveSmoothing(1, 0.2));
  });

  it("free mode produces an editable Bezier path that keeps both ends", () => {
    // A genuinely curved stroke (a jittery half-circle): a straight run is
    // correctly simplified down to two anchors, so it cannot prove the fit.
    const samples = Array.from({ length: 30 }, (_, i) => {
      const a = (i / 29) * Math.PI;
      return {
        x: 200 - Math.cos(a) * 120 + (i % 2 === 0 ? 1.1 : -1.1),
        y: 200 - Math.sin(a) * 90 + (i % 3 === 0 ? -1.3 : 1.3),
      };
    });
    const fit = freehandPipeline(samples, { mode: "free" });
    expect(fit.degenerate).toBe(false);
    expect(fit.points.length).toBeGreaterThan(2);
    expect(fit.points[0]).toMatchObject({ x: samples[0].x, y: samples[0].y });
    const last = fit.points.at(-1)!;
    expect(last.x).toBeCloseTo(samples.at(-1)!.x, 5);
    const interior = fit.points.slice(1, -1);
    expect(interior.every((point) => point.hIn !== null && point.hOut !== null)).toBe(true);
    expect(fit.closed).toBe(false);
  });

  it("a coarser fidelity yields fewer anchors for the same stroke", () => {
    const samples = shakyDiagonal(60, 3, 2.5);
    const detailed = freehandPipeline(samples, { mode: "free", fidelity: 1, smoothing: 0.1 });
    const cheap = freehandPipeline(samples, { mode: "free", fidelity: 0.1, smoothing: 0.9 });
    expect(cheap.points.length).toBeLessThanOrEqual(detailed.points.length);
  });

  it("straight mode is exactly two anchors and respects the axis lock", () => {
    const horizontal = [
      { x: 0, y: 100 },
      { x: 50, y: 103 },
      { x: 140, y: 98 },
    ];
    const path = straightModePath(horizontal, normalizeFreehandOptions({ mode: "straight" }));
    expect(path).toHaveLength(2);
    expect(path[1].y).toBe(path[0].y);

    const diagonal = straightModePath(shakyDiagonal(), normalizeFreehandOptions({ mode: "straight" }));
    expect(diagonal).toHaveLength(2);
    const angle = (Math.atan2(diagonal[1].y - diagonal[0].y, diagonal[1].x - diagonal[0].x) * 180) / Math.PI;
    expect(angle).toBeCloseTo(45, 4); // snapped from 43°
  });

  it("the pipeline honours straight mode too", () => {
    const fit = freehandPipeline(shakyDiagonal(), { mode: "straight" });
    expect(fit.points).toHaveLength(2);
    expect(fit.closed).toBe(false);
  });

  it("constrained mode snaps every segment onto the configured increments", () => {
    const fit = freehandPipeline(shakyDiagonal(), {
      mode: "constrained",
      angleIncrements: [45],
      angleTolerance: 8,
      axisLock: false,
      fidelity: 1,
    });
    expect(fit.points.length).toBeGreaterThan(2);
    for (let i = 1; i < fit.points.length; i += 1) {
      const dx = fit.points[i].x - fit.points[i - 1].x;
      const dy = fit.points[i].y - fit.points[i - 1].y;
      if (Math.hypot(dx, dy) < 1e-9) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const steps = angle / 45;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it("constrained mode can be locked to the axes", () => {
    const fit = freehandPipeline(
      [
        { x: 0, y: 0 },
        { x: 40, y: 2 },
        { x: 120, y: -3 },
      ],
      { mode: "constrained", angleIncrements: [90], angleTolerance: 10 },
    );
    expect(fit.points.every((point) => point.y === 0)).toBe(true);
  });

  it("closes the path when the stroke returns to its start", () => {
    const ring = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: 100 + Math.cos(a) * 60, y: 100 + Math.sin(a) * 60 };
    });
    const fit = freehandPipeline(ring, { mode: "free", closeTolerance: 12 });
    expect(fit.closed).toBe(true);
    const first = fit.points[0];
    const last = fit.points.at(-1)!;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(1);
  });

  it("drops a degenerate two-sample flick", () => {
    expect(freehandPipeline([{ x: 0, y: 0 }], {}).degenerate).toBe(true);
    expect(freehandPipeline([{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }], { mode: "straight" }).degenerate).toBe(true);
  });

  it("simplifyAnchors removes redundant anchors without losing the ends", () => {
    const points: PathPoint[] = Array.from({ length: 30 }, (_, i) => ({
      x: i * 5,
      y: i % 2 === 0 ? 0 : 0.4,
      hIn: null,
      hOut: null,
    }));
    const simplified = simplifyAnchors(points, DEFAULT_FREEHAND_OPTIONS.fidelity);
    expect(simplified.length).toBeLessThan(points.length);
    expect(simplified[0]).toMatchObject({ x: 0, y: 0 });
    expect(simplified.at(-1)!.x).toBe(points.at(-1)!.x);
  });
});

describe("freehand + path ops in the engine", () => {
  function stroke(engine: EditorEngine, samples: { x: number; y: number }[]): string | null {
    engine.setTool("draw");
    engine.beginFreehandStroke(samples[0]);
    for (const sample of samples.slice(1)) engine.extendFreehandStroke(sample);
    return engine.commitFreehandStroke({ color: "#0ea5e9", width: 6 });
  }

  it("commits a constrained stroke as grid-true geometry", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setFreehandMode("constrained");
    engine.setFreehandAngleSnapping([45]);
    engine.setFreehandTuning({ angleTolerance: 8, axisLock: false });
    const id = stroke(engine, shakyDiagonal());
    expect(id).not.toBeNull();
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    for (let i = 1; i < layer.points.length; i += 1) {
      const dx = layer.points[i].x - layer.points[i - 1].x;
      const dy = layer.points[i].y - layer.points[i - 1].y;
      if (Math.hypot(dx, dy) < 1e-9) continue;
      const steps = ((Math.atan2(dy, dx) * 180) / Math.PI) / 45;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it("commits a straight stroke as two anchors", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setFreehandMode("straight");
    const id = stroke(engine, shakyDiagonal());
    expect(id).not.toBeNull();
    expect((engine.snapshot().doc.layers[0] as PathLayer).points).toHaveLength(2);
  });

  it("extends an existing path with a new run that starts at its end", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setFreehandMode("straight");
    const id = stroke(engine, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])!;
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    const end = layer.points.at(-1)!;
    const extended = engine.extendPathWithStroke(id, [
      { x: end.x + layer.x, y: end.y + layer.y },
      { x: end.x + layer.x + 80, y: end.y + layer.y - 60 },
    ]);
    expect(extended).toBe(id);
    expect((engine.snapshot().doc.layers[0] as PathLayer).points.length).toBeGreaterThan(2);
  });

  it("refuses to extend with a run that starts far from either end", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setFreehandMode("straight");
    const id = stroke(engine, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])!;
    expect(
      engine.extendPathWithStroke(id, [
        { x: 700, y: 500 },
        { x: 760, y: 520 },
      ]),
    ).toBeNull();
  });

  it("reshapes a middle run and simplifies an existing path", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 400, amplitude: 60 });
    engine.convertCurveToPath(id);
    const before = (engine.snapshot().doc.layers[0] as PathLayer).points.length;

    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    const from = layer.points[2];
    const to = layer.points[4];
    const reshaped = engine.reshapePathRun(id, 2, 4, [
      { x: from.x + layer.x, y: from.y + layer.y - 50 },
      { x: to.x + layer.x, y: to.y + layer.y - 10 },
    ]);
    expect(reshaped).toBe(true);
    expect((engine.snapshot().doc.layers[0] as PathLayer).points.length).toBe(before - 1);

    engine.simplifyPathLayer(id, 0.6);
    expect((engine.snapshot().doc.layers[0] as PathLayer).points.length).toBeLessThan(before);
  });

  it("auto-closes an open path whose ends already touch", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 300, amplitude: 40 });
    engine.convertCurveToPath(id);
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    const points: PathPoint[] = [
      { x: 10, y: 10, hIn: null, hOut: null },
      { x: 90, y: 10, hIn: null, hOut: null },
      { x: 90, y: 70, hIn: null, hOut: null },
      { x: 12, y: 12, hIn: null, hOut: null },
    ];
    engine.updateLayer(id, { points, closed: false } as Partial<PathLayer>);
    expect(engine.autoClosePath(id)).toBe(true);
    const closed = engine.snapshot().doc.layers[0] as PathLayer;
    expect(closed.closed).toBe(true);
    expect(closed.points.length).toBe(3);
    void layer;
  });
});
