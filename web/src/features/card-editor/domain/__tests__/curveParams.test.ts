import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../document";
import {
  DEFAULT_CURVE_SPEC,
  bakeCurve,
  curveAnchors,
  curveChordLength,
  curvePointAt,
  curveSpanX,
  normalizeCurveSpec,
  polylineLength,
  reverseCurveSpec,
  type CurveSpec,
} from "../curveGeometry";
import { resolveLayerPathD } from "../path";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

function spec(partial: Partial<CurveSpec> = {}): CurveSpec {
  return normalizeCurveSpec({ ...DEFAULT_CURVE_SPEC, ...partial });
}

function anchorAt(specInput: Partial<CurveSpec>, index: number) {
  return curveAnchors(specInput)[index];
}

describe("parametric curve spec", () => {
  it("clamps every parameter and keeps a null tangent as 'natural'", () => {
    const clamped = normalizeCurveSpec({
      kind: "sine",
      length: 999_999,
      amplitude: -50,
      frequency: 500,
      phase: 10_000,
      symmetry: 4,
      startTangent: null,
      endTangent: 90,
    });
    expect(clamped.length).toBe(20000);
    expect(clamped.amplitude).toBe(0);
    expect(clamped.frequency).toBe(24);
    expect(clamped.phase).toBe(360);
    expect(clamped.symmetry).toBe(0.95);
    expect(clamped.startTangent).toBeNull();
    expect(clamped.endTangent).toBe(90);
  });

  it("falls back to a valid kind for unknown values", () => {
    const spec = normalizeCurveSpec({ kind: "nope" as CurveSpec["kind"] });
    expect(spec.kind).toBe("sine");
  });

  it("Length is the chord span and amplitude/frequency/phase/symmetry never move it", () => {
    const base = spec({ kind: "sine", length: 600, amplitude: 80, frequency: 2, phase: 0 });
    const baseSpan = curveSpanX(curveAnchors(base));
    expect(baseSpan).toBeCloseTo(600, 6);

    for (const patch of [
      { amplitude: 240 },
      { frequency: 4.5 },
      { phase: 137 },
      { symmetry: 0.15 },
      { symmetry: 0.9 },
      { kind: "wave" as const },
      { kind: "s" as const },
      { kind: "arc" as const },
      { kind: "sine-asymmetric" as const },
    ]) {
      expect(curveSpanX(curveAnchors({ ...base, ...patch }))).toBeCloseTo(600, 6);
    }
  });

  it("Frequency really adds cycles to the sine", () => {
    const one = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine", frequency: 1 });
    const two = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine", frequency: 2 });
    const zeroCrossings = (points: { y: number }[]) => {
      let count = 0;
      for (let i = 1; i < points.length; i += 1) {
        if (Math.sign(points[i].y) !== Math.sign(points[i - 1].y)) count += 1;
      }
      return count;
    };
    expect(zeroCrossings(two)).toBeGreaterThan(zeroCrossings(one));
  });

  it("asymmetric is genuinely not the mirrored sine", () => {
    const symmetric = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine" }).map((p) => p.y);
    const asymmetric = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine-asymmetric" }).map((p) => p.y);
    expect(asymmetric).not.toEqual(symmetric);
    // A symmetric sine is odd around the middle; the asymmetric blend is not.
    const mirrored = symmetric.map((_, i) => -symmetric[symmetric.length - 1 - i]);
    expect(Math.max(...mirrored.map((v, i) => Math.abs(v - symmetric[i])))).toBeLessThan(1e-6);
  });

  it("s-wave starts and ends on opposite sides, and arc stays level at the ends", () => {
    const s = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "s", amplitude: 100 });
    expect(s[0].y).toBeLessThan(0);
    expect(s[s.length - 1].y).toBeGreaterThan(0);
    const arc = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "arc", amplitude: 100 });
    expect(Math.abs(arc[0].y)).toBeLessThan(1e-9);
    expect(Math.abs(arc[arc.length - 1].y)).toBeLessThan(1e-9);
  });

  it("phase shifts the waveform without touching the span", () => {
    const a = curveAnchors({ ...DEFAULT_CURVE_SPEC, phase: 0 });
    const b = curveAnchors({ ...DEFAULT_CURVE_SPEC, phase: 90 });
    expect(b.map((p) => p.y)).not.toEqual(a.map((p) => p.y));
    expect(curveSpanX(b)).toBeCloseTo(curveSpanX(a), 6);
  });

  it("end tangent angles steer the two free handles", () => {
    const points = curveAnchors({ ...DEFAULT_CURVE_SPEC, startTangent: 45, endTangent: -30 });
    const start = points[0];
    const angle = (Math.atan2(start.hOut!.y - start.y, start.hOut!.x - start.x) * 180) / Math.PI;
    expect(angle).toBeCloseTo(45, 4);
    const last = points[points.length - 1];
    const endAngle = (Math.atan2(last.y - last.hIn!.y, last.x - last.hIn!.x) * 180) / Math.PI;
    expect(endAngle).toBeCloseTo(-30, 4);
  });

  it("a null tangent keeps the natural wave tangent", () => {
    const natural = curveAnchors({ ...DEFAULT_CURVE_SPEC, startTangent: null });
    expect(natural[0].hOut).not.toBeNull();
    expect(natural[0].hIn).toBeNull();
  });

  it("reverse mirrors the parameter axis, survives a double reverse and swaps end tangents", () => {
    const base = spec({ kind: "sine", frequency: 1.5, phase: 20, startTangent: 30, endTangent: 60 });
    const twice = reverseCurveSpec(reverseCurveSpec(base));
    expect(twice).toEqual(base);

    const forward = curveAnchors(base);
    const backward = curveAnchors(reverseCurveSpec(base));
    expect(backward.length).toBe(forward.length);
    // The anchor positions stay on the same t grid, so a reversed anchor is the
    // mirror of its counterpart: x mirrors about the chord centre, y is carried
    // over unchanged.
    backward.forEach((point, index) => {
      const mirror = forward[forward.length - 1 - index];
      expect(point.x + mirror.x).toBeCloseTo(base.length, 6);
      expect(point.y).toBeCloseTo(mirror.y, 6);
    });

    const reversed = reverseCurveSpec(base);
    expect(reversed.startTangent).toBeCloseTo(-120, 6); // old end (+180)
    expect(reversed.endTangent).toBeCloseTo(-150, 6); // old start (+180)
  });

  it("convert to path returns plain anchors with no spec left behind", () => {
    const baked = bakeCurve({ ...DEFAULT_CURVE_SPEC, kind: "sine", frequency: 3 });
    expect(baked).toEqual(curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine", frequency: 3 }));
    expect(curveChordLength(baked)).toBeGreaterThan(0);
  });

  it("polyline length of a generated wave is the arc length, not the chord", () => {
    const points = curveAnchors({ ...DEFAULT_CURVE_SPEC, kind: "sine", amplitude: 120 });
    expect(polylineLength(points)).toBeGreaterThan(600);
  });
});

describe("parametric curve in the engine", () => {
  it("creates a re-editable curve layer with a spec and generated anchors", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 90, frequency: 2 });
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    expect(layer.curve?.frequency).toBe(2);
    expect(layer.points.length).toBeGreaterThan(2);
    expect(layer.width).toBeGreaterThan(500);
    expect(engine.curveLength(id)).toBeCloseTo(500, 3);
  });

  it("re-derives geometry on every parameter change (one record per call)", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 40 });
    const before = resolveLayerPathD(engine.snapshot().doc.layers[0] as PathLayer);

    engine.setCurveParam(id, { amplitude: 160 });
    const after = resolveLayerPathD(engine.snapshot().doc.layers[0] as PathLayer);
    expect(after).not.toBe(before);
    expect(engine.curveLength(id)).toBeCloseTo(500, 3);

    engine.undo();
    expect(resolveLayerPathD(engine.snapshot().doc.layers[0] as PathLayer)).toBe(before);
  });

  it("rotation is exact decimals and never changes the length", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 640, amplitude: 70 });
    for (const angle of [0.1, 0.37, 12.5, -33.3, 180]) {
      engine.updateLayer(id, { angle });
      const layer = engine.snapshot().doc.layers[0] as PathLayer;
      expect(layer.angle).toBe(angle);
      expect(engine.curveLength(id)).toBeCloseTo(640, 3);
    }
  });

  it("resizing scales the SPEC so Length and Amplitude stay truthful", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 400, amplitude: 50, frequency: 3 });
    const before = engine.curveSpec(id)!;
    const layer = engine.snapshot().doc.layers[0] as PathLayer;

    // Drag the south-east handle to double the width, keeping the height.
    engine.transientResize(id, "se", {
      x: layer.x + layer.width / 2 + 1.5 * layer.width,
      y: layer.y + layer.height / 2 + layer.height / 2,
    });
    engine.commitTransform();

    const after = engine.curveSpec(id)!;
    expect(after.length / before.length).toBeCloseTo(2, 1);
    expect(after.amplitude).toBeCloseTo(before.amplitude, 4);
    expect(after.frequency).toBe(before.frequency);
    expect(engine.curveLength(id)).toBeCloseTo(before.length * (after.length / before.length), 1);
  });

  it("convertCurveToPath freezes the parameters into a plain editable path", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("wave", { length: 420, amplitude: 60 });
    engine.convertCurveToPath(id);
    const layer = engine.snapshot().doc.layers[0] as PathLayer;
    expect(layer.curve).toBeUndefined();
    expect(layer.points.length).toBeGreaterThan(2);
    expect(layer.pathMode).toBe("pen");
    expect(engine.curveSpec(id)).toBeNull();
    // Still fully editable geometry: the resolver draws the same curve.
    expect(resolveLayerPathD(layer)).toContain("C");
  });

  it("reverseCurve keeps every other parameter and reverses through the spec", () => {
    const engine = new EditorEngine(emptyDoc());
    const id = engine.addCurve("sine", { length: 500, amplitude: 60, frequency: 2, phase: 30 });
    const before = engine.curveSpec(id)!;
    engine.reverseCurve(id);
    const after = engine.curveSpec(id)!;
    expect(after.reversed).toBe(!before.reversed);
    expect(after.length).toBe(before.length);
    expect(after.frequency).toBe(before.frequency);
    expect(after.amplitude).toBe(before.amplitude);
    engine.reverseCurve(id);
    expect(engine.curveSpec(id)).toEqual(before);
  });

  it("curvePointAt covers the whole chord at t=0 and t=1", () => {
    const s = spec({ length: 333 });
    expect(curvePointAt(s, 0).x).toBe(0);
    expect(curvePointAt(s, 1).x).toBe(333);
    expect(curvePointAt(s, 0.5).x).toBeCloseTo(166.5, 6);
    expect(anchorAt(s, 0).x).toBe(0);
  });
});
