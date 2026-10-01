/**
 * Document ⇄ region projection.
 *
 * The planar-graph engine in `regions.ts` knows nothing about documents; this
 * module is the ONE place a `CardDocument` becomes faces and a `RegionStyleEntry`
 * becomes paint. The canvas renderer, the SVG/PDF export and the editing engine
 * all read it, so a painted face cannot look different in the preview than it
 * does in the exported card.
 *
 * Pure: no DOM, no React.
 */

import type { CardDocument, FillRuleKind, PathLayer, RegionStyleEntry } from "../document";
import { DEFAULT_REGION_SETTINGS } from "../document";
import type { SvgGradientSpec } from "../svgGradient";
import { toWorldSubPaths } from "./canonical";
import { buildRegions, type RegionFace, type RegionOptions } from "./regions";

/** Every path layer that participates in region detection, in z-order. */
export function regionSourcesFor(doc: CardDocument): PathLayer[] {
  return doc.layers.filter(
    (layer): layer is PathLayer => layer.kind === "path" && !layer.hidden && layer.opacity > 0,
  );
}

/** All faces discovered in a document, honouring its gap tolerance. */
export function regionsForDocument(doc: CardDocument, options: RegionOptions = {}): RegionFace[] {
  const settings = doc.regionSettings ?? DEFAULT_REGION_SETTINGS;
  const sources = regionSourcesFor(doc).map((layer) => ({
    id: layer.id,
    geometry: toWorldSubPaths(layer),
  }));
  if (sources.length === 0) return [];
  return buildRegions(sources, {
    gapTolerance: settings.gapTolerance,
    fillRule: settings.fillRule,
    ...options,
  });
}

/** A face together with the paint attached to it. */
export type PaintedRegion = { face: RegionFace; style: RegionStyleEntry };

/**
 * The painted faces of a document, innermost first so a nested face paints over
 * the face that contains it (the same order the hit test resolves in).
 */
export function paintedRegions(doc: CardDocument): PaintedRegion[] {
  const styles = doc.regions ?? [];
  if (styles.length === 0) return [];
  const byKey = new Map(styles.map((style) => [style.key, style]));
  const out: PaintedRegion[] = [];
  for (const face of regionsForDocument(doc)) {
    const style = byKey.get(face.id);
    if (style) out.push({ face, style });
  }
  return out.sort((a, b) => a.face.depth - b.face.depth);
}

function loopD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (const point of rest) d += ` L ${point.x} ${point.y}`;
  return `${d} Z`;
}

/**
 * SVG `d` for a face: the outer loop plus its holes as extra subpaths.
 *
 * Faces are ALWAYS rendered with `fill-rule="evenodd"` (see `regionFillRule`),
 * which is what makes a hole a hole while keeping one single path per face.
 */
export function regionFacePathD(face: RegionFace): string {
  return [loopD(face.points), ...face.holes.map(loopD)].filter(Boolean).join(" ");
}

/**
 * The fill rule region faces are PAINTED with.
 *
 * It is the document's own rule (§13), not a hardcoded even-odd: under
 * `nonzero` an inner loop still fills, which is exactly what the user asked for
 * when they chose it — and the hit test (`regionAt`) uses the same rule, so what
 * you can click is what you can see.
 */
export function regionFillRule(doc: CardDocument): FillRuleKind {
  return (doc.regionSettings ?? DEFAULT_REGION_SETTINGS).fillRule;
}

/**
 * Paint for a region style: a solid colour or a real gradient spec.
 * Gradients are built here (not by the caller) so preview and export share the
 * exact same stop geometry.
 */
export function regionStylePaint(style: RegionStyleEntry): {
  fill: string;
  gradient: SvgGradientSpec | null;
} {
  if (style.fill === "linear" || style.fill === "radial") {
    const second = style.color2 ?? style.color;
    return {
      fill: style.fill,
      gradient: {
        type: style.fill,
        angle: style.angle ?? 0,
        stops: [
          { offset: 0, color: style.color },
          { offset: 100, color: second },
        ],
      },
    };
  }
  return { fill: style.color, gradient: null };
}
