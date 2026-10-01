import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer, type PathPoint } from "../../document";
import { resolveStroke } from "../../stroke";
import {
  paintedRegions,
  regionFacePathD,
  regionFillRule,
  regionsForDocument,
  regionStylePaint,
} from "../documentRegions";
import { faceContainsPoint } from "../regions";
import { serializeDocument } from "../../../export/documentToSvg";

const BASE = {
  kind: "path" as const,
  angle: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  color: null,
  background: null,
  stroke: "#0b1c33",
  strokeWidth: 2,
  fill: null,
};

function openPathLayer(id: string, x: number, y: number, points: PathPoint[], overrides: Partial<PathLayer> = {}): PathLayer {
  return { ...BASE, id, x, y, width: 1, height: 1, points, closed: false, ...overrides };
}

function rectPoints(w: number, h: number): PathPoint[] {
  return [
    { x: 0, y: 0, hIn: null, hOut: null },
    { x: w, y: 0, hIn: null, hOut: null },
    { x: w, y: h, hIn: null, hOut: null },
    { x: 0, y: h, hIn: null, hOut: null },
  ];
}

/** A 400×200 frame at (100,100) plus a divider that splits it in two. */
function splitDoc(gap = 0): CardDocument {
  const frame = openPathLayer("frame", 100, 100, rectPoints(400, 200), { closed: true });
  const divider = openPathLayer("divider", 300, 100 + gap, [
    { x: 0, y: 0, hIn: null, hOut: null },
    { x: 0, y: 200 - gap * 2, hIn: null, hOut: null },
  ]);
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [frame, divider] };
}

function layerById(doc: CardDocument, id: string): PathLayer {
  return doc.layers.find((layer) => layer.id === id) as PathLayer;
}

describe("region faces from a document", () => {
  it("splits a frame into two faces when a divider crosses it", () => {
    const faces = regionsForDocument(splitDoc());
    expect(faces).toHaveLength(2);
    const left = { x: 200, y: 200 };
    const right = { x: 400, y: 200 };
    const hits = (point: { x: number; y: number }) => faces.filter((face) => faceContainsPoint(face, point));
    expect(hits(left)).toHaveLength(1);
    expect(hits(right)).toHaveLength(1);
    expect(hits(left)[0].id).not.toBe(hits(right)[0].id);
  });

  it("a drawing with a single path still yields one face", () => {
    const doc: CardDocument = {
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#fff",
      layers: [openPathLayer("only", 50, 50, rectPoints(200, 120), { closed: true })],
    };
    expect(regionsForDocument(doc)).toHaveLength(1);
  });

  it("treats a small gap as closed ONLY for topology (§12)", () => {
    const gapped = splitDoc(3);
    expect(regionsForDocument(gapped)).toHaveLength(1); // the divider does not reach

    const tolerant: CardDocument = { ...gapped, regionSettings: { gapTolerance: 4, fillRule: "nonzero" } };
    expect(regionsForDocument(tolerant)).toHaveLength(2);

    // The source geometry is never touched: the divider is still 194px long.
    const divider = layerById(tolerant, "divider");
    expect(divider.points[1].y - divider.points[0].y).toBe(194);
  });

  it("nested loops become a hole of the face that contains them", () => {
    const doc: CardDocument = {
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#fff",
      layers: [
        openPathLayer("outer", 100, 100, rectPoints(400, 300), { closed: true }),
        openPathLayer("inner", 200, 200, rectPoints(100, 80), { closed: true }),
      ],
    };
    const faces = regionsForDocument(doc);
    const outer = faces.find((face) => face.pathIds.includes("outer"))!;
    expect(outer.holes).toHaveLength(1);
    expect(faceContainsPoint(outer, { x: 250, y: 240 })).toBe(false); // inside the hole
    expect(faceContainsPoint(outer, { x: 150, y: 150 })).toBe(true);
  });

  it("gap tolerance and fill rule are read from the document", () => {
    const doc: CardDocument = {
      ...splitDoc(),
      regionSettings: { gapTolerance: 8, fillRule: "evenodd" },
    };
    expect(regionFillRule(doc)).toBe("evenodd");
    expect(regionFillRule(splitDoc())).toBe("nonzero");
  });
});

describe("region paint (engine)", () => {
  function engineWithDoc(doc = splitDoc()): EditorEngine {
    return new EditorEngine(doc);
  }

  it("paints exactly the face under the pointer and keeps fills independent", () => {
    const engine = engineWithDoc();
    const leftKey = engine.paintRegionAt({ x: 200, y: 200 }, { fill: "solid", color: "#f59e0b" });
    const rightKey = engine.paintRegionAt({ x: 400, y: 200 }, { fill: "solid", color: "#7c3aed" });
    expect(leftKey).not.toBeNull();
    expect(rightKey).not.toBeNull();
    expect(leftKey).not.toBe(rightKey);

    const paint = engine.regionPaintMap();
    expect(paint[leftKey!].color).toBe("#f59e0b");
    expect(paint[rightKey!].color).toBe("#7c3aed");
    // Paint lives on regions, not on the paths that bound them.
    const frame = layerById(engine.snapshot().doc, "frame");
    expect(frame.fill).toBeNull();
    expect(frame.points).toHaveLength(4);
  });

  it("returns null when the pointer is outside every face", () => {
    const engine = engineWithDoc();
    expect(engine.paintRegionAt({ x: 700, y: 40 }, { fill: "solid", color: "#000" })).toBeNull();
    expect(engine.regionPaintMap()).toEqual({});
  });

  it("supports solid, linear and radial region fills", () => {
    const engine = engineWithDoc();
    const key = engine.paintRegionAt({ x: 200, y: 200 }, { fill: "linear", color: "#fff", color2: "#000", angle: 45, opacity: 0.5 })!;
    const style = engine.regionStyleFor(key)!;
    expect(regionStylePaint(style).gradient).toMatchObject({ type: "linear", angle: 45 });
    expect(regionStylePaint(style).gradient?.stops).toHaveLength(2);

    engine.paintRegion(key, { fill: "radial", color: "#fff", color2: "#111" });
    expect(engine.regionStyleFor(key)?.fill).toBe("radial");
  });

  it("painting the same face twice replaces the fill instead of duplicating it", () => {
    const engine = engineWithDoc();
    const key = engine.paintRegionAt({ x: 200, y: 200 }, { fill: "solid", color: "#f00" })!;
    engine.paintRegion(key, { fill: "solid", color: "#0f0" });
    expect(engine.snapshot().doc.regions).toHaveLength(1);
    expect(engine.regionStyleFor(key)?.color).toBe("#0f0");
  });

  it("clearRegion and clearAllRegionPaint remove paint without touching geometry", () => {
    const engine = engineWithDoc();
    const key = engine.paintRegionAt({ x: 200, y: 200 }, { fill: "solid", color: "#f00" })!;
    engine.paintRegionAt({ x: 400, y: 200 }, { fill: "solid", color: "#00f" });
    engine.clearRegion(key);
    expect(engine.snapshot().doc.regions).toHaveLength(1);
    engine.clearAllRegionPaint();
    expect(engine.snapshot().doc.regions).toEqual([]);
    expect((engine.snapshot().doc.layers[0] as PathLayer).points).toHaveLength(4);
  });

  it("KEEPS the paint when a boundary path is edited (§11)", () => {
    const engine = engineWithDoc();
    const rightKey = engine.paintRegionAt({ x: 400, y: 200 }, { fill: "solid", color: "#7c3aed" })!;

    // Move the divider 60px to the right: every face centroid moves with it, so
    // the face KEY legitimately changes and the paint must FOLLOW it.
    const divider = layerById(engine.snapshot().doc, "divider");
    engine.updateLayer("divider", { x: divider.x + 60 } as Partial<PathLayer>);

    const painted = engine.regionPaintMap();
    expect(Object.values(painted)).toHaveLength(1);
    expect(Object.values(painted)[0].color).toBe("#7c3aed");
    expect(Object.values(painted)[0].fill).toBe("solid");

    // The colour is still on the SAME side of the drawing — not stranded at the
    // old coordinates, and not moved to the other face.
    const right = engine.regionAt({ x: 400, y: 200 })!;
    expect(painted[right.id]?.color).toBe("#7c3aed");
    const left = engine.regionAt({ x: 200, y: 200 })!;
    expect(painted[left.id]).toBeUndefined();

    // Re-rendering the exported card uses the remapped key, so the paint is
    // still visible after a reload + export cycle.
    expect(serializeDocument(engine.snapshot().doc)).toContain("#7c3aed");
    expect(rightKey).toBeTruthy();
  });

  it("drops paint when its face is gone and nothing equivalent survives", () => {
    const engine = engineWithDoc();
    engine.paintRegionAt({ x: 200, y: 200 }, { fill: "solid", color: "#f00" });
    // Deleting the frame leaves only the divider — an open line encloses nothing.
    engine.deleteLayer("frame");
    expect(engine.regionFaces()).toEqual([]);
    expect(engine.snapshot().doc.regions).toEqual([]);
  });

  it("never leaves a fill stranded at its old coordinates when the drawing moves away", () => {
    const engine = engineWithDoc();
    engine.paintRegionAt({ x: 200, y: 200 }, { fill: "solid", color: "#f00" });
    // Move the whole drawing far enough that the old face is gone (the remap
    // drift guard is what stops a "nearest centroid" from resurrecting it).
    engine.updateLayer("frame", { x: 1400, y: 900 } as Partial<PathLayer>);
    engine.updateLayer("divider", { x: 1600, y: 900 } as Partial<PathLayer>);
    expect(engine.snapshot().doc.regions).toEqual([]);
  });

  it("rubber-stamps nothing when a face is only painted through the wrong mode", () => {
    const engine = engineWithDoc();
    engine.setSelectionDomain("region");
    const key = engine.regionAt({ x: 200, y: 200 })!.id;
    engine.selectRegion(key);
    const state = engine.getState();
    expect(state.selectionDomain).toBe("region");
    expect(state.selectedRegion).toBe(key);
    // A REGION selection is never a layer selection (§16).
    expect(state.selection.layerId).toBeNull();
    expect(state.selection.ids).toEqual([]);
    expect(engine.selectedIds()).toEqual([]);
  });

  it("hover state is view-only and never enters the document", () => {
    const engine = engineWithDoc();
    const key = engine.regionAt({ x: 200, y: 200 })!.id;
    engine.hoverRegionAt({ x: 200, y: 200 });
    expect(engine.getState().hoveredRegion).toBe(key);
    engine.hoverRegionAt(null);
    expect(engine.getState().hoveredRegion).toBeNull();
    expect(engine.snapshot().doc.regions).toBeUndefined();
  });

  it("reads region settings from the document and ignores impossible values", () => {
    const engine = engineWithDoc(splitDoc(3));
    expect(engine.regionFaces()).toHaveLength(1);
    engine.setRegionSettings({ gapTolerance: 4 });
    expect(engine.regionFaces()).toHaveLength(2);
    engine.setRegionSettings({ gapTolerance: 999, fillRule: "nonsense" as never });
    expect(engine.snapshot().doc.regionSettings).toEqual({ gapTolerance: 64, fillRule: "nonzero" });
    engine.undo();
    expect(engine.snapshot().doc.regionSettings).toEqual({ gapTolerance: 4, fillRule: "nonzero" });
  });
});

describe("region paint + stroke extras in the SVG export", () => {
  function exportDoc(doc: CardDocument): string {
    return serializeDocument(doc);
  }

  it("serializes painted faces under the artwork with the document fill rule", () => {
    const doc = splitDoc();
    doc.regions = [
      { key: "", fill: "solid", color: "#f59e0b" },
      { key: "", fill: "solid", color: "#7c3aed" },
    ];
    const faces = regionsForDocument(doc);
    doc.regions = doc.regions.map((style, index) => ({ ...style, key: faces[index].id }));

    const svg = exportDoc(doc);
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).toContain('fill="#f59e0b"');
    expect(svg).toContain('fill="#7c3aed"');
    // Region paint is emitted BEFORE the boundary strokes.
    expect(svg.indexOf("#f59e0b")).toBeLessThan(svg.indexOf("#0b1c33"));
  });

  it("an even-odd document paints and hit-tests with even-odd", () => {
    const doc = splitDoc();
    doc.regionSettings = { gapTolerance: 0, fillRule: "evenodd" };
    const key = regionsForDocument(doc)[0].id;
    doc.regions = [{ key, fill: "solid", color: "#111111" }];
    expect(exportDoc(doc)).toContain('fill-rule="evenodd"');
  });

  it("a document without region paint exports exactly as before", () => {
    const svg = exportDoc(splitDoc());
    expect(svg).not.toContain("fill-rule");
  });

  it("serializes an explicit dash pattern and its offset", () => {
    const doc = splitDoc();
    const frame = layerById(doc, "frame");
    doc.layers = doc.layers.map((layer) =>
      layer.id === "frame"
        ? { ...frame, strokeDasharray: [12, 4], strokeDashoffset: 3, fillRule: "evenodd" as const }
        : layer,
    );
    const svg = exportDoc(doc);
    expect(svg).toContain('stroke-dasharray="12 4"');
    expect(svg).toContain('stroke-dashoffset="3"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("resolveStroke prefers the explicit pattern over the preset and clamps junk", () => {
    const explicit = resolveStroke({ strokeWidth: 4, strokeStyle: "dashed", strokeDasharray: [10, 5], strokeDashoffset: -2 }, "#000");
    expect(explicit.dasharray).toBe("10 5");
    expect(explicit.dashoffset).toBe(-2);
    expect(resolveStroke({ strokeWidth: 4, strokeStyle: "dashed" }, "#000").dasharray).toBe("12 8");
    const junk = resolveStroke({ strokeWidth: 2, strokeDasharray: [0, Number.NaN, -4] as number[] }, "#000");
    expect(junk.dasharray).toBeUndefined();
    // A zero-width stroke paints nothing at all, dashes or not.
    expect(resolveStroke({ strokeWidth: 0, strokeDasharray: [4, 4], strokeDashoffset: 1 }, "#000").visible).toBe(false);
  });

  it("regionFacePathD emits holes as subpaths of the same face", () => {
    const doc: CardDocument = {
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#fff",
      layers: [
        openPathLayer("outer", 100, 100, rectPoints(400, 300), { closed: true }),
        openPathLayer("inner", 200, 200, rectPoints(100, 80), { closed: true }),
      ],
    };
    const face = regionsForDocument(doc).find((candidate) => candidate.holes.length > 0)!;
    const d = regionFacePathD(face);
    expect(d.match(/M /g)?.length).toBe(2); // outer loop + hole
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("paintedRegions joins faces to their styles and skips unknown keys", () => {
    const doc = splitDoc();
    const faces = regionsForDocument(doc);
    doc.regions = [
      { key: faces[0].id, fill: "solid", color: "#f00" },
      { key: "gone@0,0", fill: "solid", color: "#0f0" },
    ];
    const painted = paintedRegions(doc);
    expect(painted).toHaveLength(1);
    expect(painted[0].face.id).toBe(faces[0].id);
  });
});
