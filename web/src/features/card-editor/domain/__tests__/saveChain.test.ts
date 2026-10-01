/**
 * Save-chain contract — the editor must only ever emit documents the
 * backend whitelist (CardDesignValidator) accepts.
 *
 * The chain is: EditorAction → in-memory document → design_json → API →
 * Laravel whitelist → database → reload → same document. A field the
 * frontend carries but the whitelist rebuild DROPS is a partial save; a
 * document that breaks a whitelist rule is a 422 ("بخشی از طرح ذخیره نشد").
 * This test pins the invariants the whitelist actually enforces, built from
 * the REAL domain generators (factory, catalog templates, freehand brush,
 * curved line, pen tool) rather than hand-written fixtures.
 */
import { describe, expect, it } from "vitest";
import { ARTBOARD, type CardDocument, type CardLayer, type PathLayer } from "../document";
import { EditorEngine } from "../../engine/EditorEngine";
import { createDocumentFromBusiness, parseDocument } from "../factory";
import { TEMPLATES_CATALOG } from "../templatesCatalog";
import { getBrushStrokeOutline } from "../freehand";
import { createCurvedLineLayer } from "../luxuryMaterials";
import { MAX_PATH_POINTS } from "../saveLimits";
import { resolveLayerPathD } from "../path";
import type { Business } from "@/lib/businesses";

const MAX_DOC_BYTES = 100_000; // backend MAX_BYTES cap

const business = {
  id: 1,
  slug: "contract-shop",
  name: "فروشگاه قراردادی",
  category: "صوتی و تصویری",
  phone: "09120000000",
  city: "تهران",
  neighborhood: "سعادت‌آباد",
  address: "خیابان نمونه",
  logo: "storage/cards/logo.png",
  social_links: { instagram: "@x", telegram: "@x", website: "x.test" },
  license_verified: true,
  is_promoted: true,
  status: "approved",
} as unknown as Business;

function docOf(background: string, layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background, layers };
}

/** A REAL long brush stroke (perfect-freehand, variable pressure). */
function brushDocument(): CardDocument {
  const engine = new EditorEngine(docOf("#0d2342", []));
  const pts = [];
  for (let i = 0; i < 120; i++) {
    pts.push({
      x: 120 + i * 5.5,
      y: 300 + Math.sin(i / 6) * 60 + Math.cos(i / 11) * 20,
      p: 0.4 + 0.6 * Math.abs(Math.sin(i / 9)),
    });
  }
  const outline = getBrushStrokeOutline(pts, {
    size: 16,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.35,
    simulatePressure: true,
    last: true,
  });
  expect(engine.addBrushLayer(outline, "#22d3ee")).not.toBeNull();
  return engine.getState().doc;
}

describe("save chain — document invariants the backend whitelist enforces", () => {
  const documents: Record<string, () => CardDocument> = {
    "factory business card": () =>
      createDocumentFromBusiness(business, { template: "midnight", theme: "navy", fontFamily: "vazir" }),
    "brush stroke": brushDocument,
    "curved line (bend)": () => docOf("#0d2342", [createCurvedLineLayer(100, 280, 500, 80, 60)]),
  };
  for (const template of TEMPLATES_CATALOG) {
    documents[`catalog template: ${template.id}`] = () => docOf(template.background, template.buildLayers(business));
  }

  for (const [name, build] of Object.entries(documents)) {
    it(`${name}: serializes inside the document budget`, () => {
      const doc = build();
      const json = JSON.stringify(doc);
      expect(json.length).toBeLessThan(MAX_DOC_BYTES);
    });

    it(`${name}: every path layer is drawable (>=2 anchors OR rawD)`, () => {
      for (const layer of build().layers) {
        if (layer.kind !== "path") continue;
        const hasAnchors = layer.points.length >= 2;
        const hasRaw = typeof layer.rawD === "string" && layer.rawD.length > 0;
        expect(hasAnchors || hasRaw).toBe(true);
      }
    });

    it(`${name}: rawD stays inside the SVG grammar and the 20KB cap`, () => {
      for (const layer of build().layers) {
        if (layer.kind !== "path") continue;
        const rawD = layer.rawD;
        if (typeof rawD !== "string" || rawD === "") continue;
        expect(rawD.length).toBeLessThanOrEqual(20_000);
        // Only command letters + numbers/separators may appear (the whitelist
        // blocks <, >, quotes, ;, #, url(), script: at the grammar level).
        expect(rawD).toMatch(/^[MmZzLlHhVvCcSsQqTtAa0-9 ,.eE+-]+$/);
        // Must open with a moveto, like the parser requires.
        expect(rawD.trim()[0]).toMatch(/[Mm]/);
      }
    });

    it(`${name}: image sources are system storage paths only`, () => {
      for (const layer of build().layers) {
        if (layer.kind !== "image") continue;
        expect(layer.src.startsWith("storage/") || layer.src.startsWith("/storage/")).toBe(true);
      }
    });

    it(`${name}: colors and gradients are whitelist-clean`, () => {
      const isColor = (v: string | null | undefined): boolean =>
        /^#[0-9a-fA-F]{3,8}$/.test(v ?? "") || /^rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(,\s*[0-9.]+\s*)?\)$/.test(v ?? "");
      const isGradient = (v: string | null | undefined): boolean =>
        /^linear-gradient\(/i.test(v ?? "") || /^radial-gradient\(/i.test(v ?? "");
      for (const layer of build().layers) {
        const fills: (string | null | undefined)[] = [layer.color, layer.background];
        if (layer.kind === "shape" || layer.kind === "path") fills.push(layer.stroke);
        if (layer.kind === "path") fills.push(layer.fill);
        for (const fill of fills) {
          if (fill === null || fill === undefined || fill === "") continue;
          expect(isColor(fill) || isGradient(fill)).toBe(true);
        }
      }
    });

    it(`${name}: round-trips through parseDocument without loss`, () => {
      const doc = build();
      const reloaded = parseDocument(JSON.stringify(doc));
      expect(reloaded).not.toBeNull();
      // The load path may normalize LEGACY curvature onto bend; after it, a
      // re-serialization must be stable (a second pass changes nothing).
      const once = JSON.stringify(reloaded);
      const twice = JSON.stringify(parseDocument(once));
      expect(twice).toBe(once);
    });
  }

  it("a luxury material effect survives parseDocument (no partial save)", () => {
    const engine = new EditorEngine(docOf("#0d2342", []));
    const id = engine.addLayer("shape");
    engine.select(id);
    engine.applyLuxuryMaterial(id, "gold");
    const saved = engine.getState().doc;
    expect(saved.layers[0].effect).toBe("gold");

    // The whitelist (server) rebuilds layers — the frontend contract is that
    // the field it DOES carry round-trips the local load path unchanged.
    const reloaded = parseDocument(JSON.stringify(saved));
    expect(reloaded?.layers[0].effect).toBe("gold");
  });

  it("a huge committed brush stroke stays inside the structural anchor budget", () => {
    // A pathological ribbon (thousands of outline points) — the engine's
    // tier-aware fit must simplify it down to the anchor cap WITHOUT
    // truncating the subpath (still a single closed contour).
    const outline: number[][] = [];
    for (let i = 0; i < 4000; i++) {
      const t = (i / 3999) * Math.PI * 6;
      outline.push([500 + Math.cos(t) * 380 + (i % 7) * 0.4, 300 + Math.sin(t) * 220 + (i % 5) * 0.3]);
    }
    const engine = new EditorEngine(docOf("#0d2342", []));
    expect(engine.addBrushLayer(outline, "#22d3ee")).not.toBeNull();
    const layer = engine.getState().doc.layers[0];
    if (layer.kind !== "path") return;
    // The brush pipeline commits editable anchors (not a rawD shadow), so the
    // budget that governs it is the per-path ANCHOR cap.
    expect(layer.points.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
    const d = resolveLayerPathD(layer);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("repeated group rotations wrap stored angles into the validator's ±360 clamp", () => {
    const engine = new EditorEngine(docOf("#0d2342", []));
    const a = engine.addLayer("text");
    const b = engine.addLayer("shape");
    engine.select(a);
    engine.select(b, true);
    // Rotate hard through several full turns (each gesture ±~170°+).
    for (let i = 0; i < 6; i++) {
      engine.transientGroupRotate({ x: 900, y: 500 }, false);
      engine.commitTransform();
    }
    for (const layer of engine.getState().doc.layers) {
      expect(Math.abs(layer.angle)).toBeLessThanOrEqual(180);
    }
  });

  it("a legacy curvature document is normalized onto bend exactly once", () => {
    const legacy = docOf("#0d2342", [createCurvedLineLayer(100, 280, 500, 80, 60)]);
    // Strip the canonical field: as-saved by the previous build.
    delete (legacy.layers[0] as Partial<PathLayer>).bend;
    expect((legacy.layers[0] as PathLayer).curvature).toBe(60);

    const loaded = parseDocument(JSON.stringify(legacy));
    expect(loaded?.layers[0].kind).toBe("path");
    if (loaded?.layers[0].kind !== "path") return;
    expect(loaded.layers[0].bend).toBe(0.6);
    // Idempotent: loading the normalized document again does not move it.
    const reloaded = parseDocument(JSON.stringify(loaded));
    expect((reloaded?.layers[0] as PathLayer)?.bend).toBe(0.6);
  });
});
