/**
 * documentToSvg — the VECTOR serializer for the card document.
 *
 * WHY THIS EXISTS: rasterizing the DOM (html-to-image) can never be truly
 * sharp. Every consumer of the document already shares one geometry layer
 * (`domain/shapes.ts`, `domain/path.ts`, `domain/stroke.ts`); this file turns
 * that same geometry into native SVG markup, so an exported card is the SAME
 * drawing as the canvas — as vectors that stay sharp at any size.
 *
 * Design rules:
 *   - No `<foreignObject>`. Shapes, paths and text are real SVG primitives, so
 *     Illustrator/Inkscape/svg2pdf can all read them.
 *   - Pure and deterministic (no DOM, no network): fonts and media arrive as
 *     pre-fetched inputs, which is what makes it unit-testable.
 *   - Hidden layers are omitted (the canvas renders them at opacity 0, which is
 *     the same thing on a flat export).
 */

import type {
  BadgeLayer,
  CardDocument,
  CardLayer,
  ImageLayer,
  PathLayer,
  QrLayer,
  ShapeLayer,
  TextLayer,
} from "../domain/document";
import { resolveLayerPathD } from "../domain/path";
import {
  paintedRegions,
  regionFacePathD,
  regionFillRule,
  regionStylePaint,
} from "../domain/geometry/documentRegions";
import { resolveShapePaint, type SvgPrimitive } from "../domain/shapes";
import { resolveStroke } from "../domain/stroke";
import {
  gradientLine,
  gradientRadius,
  isGradientCss,
  parseGradientCss,
  svgColor,
  type SvgGradientSpec,
} from "../domain/svgGradient";

export { svgColor };

/** Media data URIs, keyed by the document's own `src` / QR slug. */
export type SvgAssetMap = Record<string, string>;

export type SerializeOptions = {
  /**
   * `@font-face` CSS to embed (base64 woff2). Without it the SVG still renders,
   * but Persian glyph shapes depend on the viewer's own fonts.
   */
  fontCss?: string;
  assets?: SvgAssetMap;
};

export const RTL_CHARACTERS = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function n(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The font stack an EXPORTED file can rely on.
 *
 * The app's own stack is built from `next/font` CSS variables, which do not
 * exist outside the page — so the exporter names concrete families. Only
 * Vazirmatn ships as a file, which is why `vazir`/`sans` collapse onto it (in
 * the app `--font-sans` IS Vazirmatn) and only when it is actually embedded.
 */
export function exportFontStack(family: string | undefined, embeddedVazir: boolean): string {
  switch (family) {
    case "serif":
      return 'Georgia, "Times New Roman", serif';
    case "monospace":
      return 'ui-monospace, "Courier New", monospace';
    default:
      return embeddedVazir ? "Vazirmatn, sans-serif" : "Tahoma, Arial, sans-serif";
  }
}

/* -------------------------------- gradients -------------------------------- */

function gradientMarkup(id: string, spec: SvgGradientSpec, width: number, height: number): string {
  const stops = spec.stops
    .map((stop) => `<stop offset="${n(stop.offset)}%" stop-color="${escapeXml(stop.color)}"/>`)
    .join("");

  if (spec.type === "radial") {
    return (
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${n(width / 2)}" cy="${n(height / 2)}" r="${gradientRadius(width, height)}">${stops}</radialGradient>`
    );
  }
  const line = gradientLine(spec, width, height);
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">${stops}</linearGradient>`
  );
}

/** A paint value (solid colour or `url(#id)`) plus the gradient to declare. */
type GradientBundle = { paint: string; defs: string };

function resolveBackgroundPaint(value: string | null, width: number, height: number, id: string): GradientBundle {
  if (!value) return { paint: "none", defs: "" };
  if (isGradientCss(value)) {
    const spec = parseGradientCss(value);
    if (spec) return { paint: `url(#${id})`, defs: gradientMarkup(id, spec, width, height) };
  }
  return { paint: escapeXml(svgColor(value)), defs: "" };
}

/* ---------------------------------- layers --------------------------------- */

const PRIMITIVE_TAGS: Record<SvgPrimitive["tag"], string> = {
  rect: "rect",
  ellipse: "ellipse",
  polygon: "polygon",
  line: "line",
  path: "path",
};

function primitiveAttrs(primitive: SvgPrimitive): string {
  switch (primitive.tag) {
    case "rect":
      return `x="${n(primitive.attrs.x)}" y="${n(primitive.attrs.y)}" width="${n(primitive.attrs.width)}" height="${n(primitive.attrs.height)}" rx="${n(primitive.attrs.rx)}" ry="${n(primitive.attrs.ry)}"`;
    case "ellipse":
      return `cx="${n(primitive.attrs.cx)}" cy="${n(primitive.attrs.cy)}" rx="${n(primitive.attrs.rx)}" ry="${n(primitive.attrs.ry)}"`;
    case "polygon":
      return `points="${primitive.attrs.points}"`;
    case "line":
      return `x1="${n(primitive.attrs.x1)}" y1="${n(primitive.attrs.y1)}" x2="${n(primitive.attrs.x2)}" y2="${n(primitive.attrs.y2)}"`;
    case "path":
      return `d="${primitive.attrs.d}"`;
  }
}

/** The stroke presentation attributes, shared with the on-screen renderer. */
function strokeAttrs(stroke: ReturnType<typeof resolveStroke>): string {
  if (!stroke.visible) return "";
  const parts = [
    `stroke="${escapeXml(stroke.color)}"`,
    `stroke-width="${n(stroke.width)}"`,
    `stroke-linecap="${stroke.linecap}"`,
    `stroke-linejoin="${stroke.linejoin}"`,
    `stroke-opacity="${stroke.opacity}"`,
  ];
  if (stroke.dasharray) parts.push(`stroke-dasharray="${stroke.dasharray}"`);
  if (stroke.dasharray && stroke.dashoffset !== undefined) {
    parts.push(`stroke-dashoffset="${n(stroke.dashoffset)}"`);
  }
  return ` ${parts.join(" ")}`;
}

function shapeMarkup(layer: ShapeLayer, defs: string[]): string {
  const paint = resolveShapePaint(layer);
  if (paint.primitives.length === 0) return "";

  let fill = "none";
  if (paint.fill.kind === "gradient") {
    const id = `shape-grad-${layer.id}`;
    defs.push(gradientMarkup(id, paint.fill.spec, layer.width, layer.height));
    fill = `url(#${id})`;
  } else if (paint.fill.kind === "solid") {
    fill = escapeXml(paint.fill.color);
  }

  const stroke = strokeAttrs(paint.stroke);
  return paint.primitives
    .map((primitive) => {
      const fillAttr = primitive.tag === "line" ? 'fill="none"' : `fill="${fill}"`;
      return `<${PRIMITIVE_TAGS[primitive.tag]} ${primitiveAttrs(primitive)} ${fillAttr}${stroke}/>`;
    })
    .join("");
}

/**
 * Serialize the document's region paint (§10/§13).
 *
 * A face is ONE `<path>` whose subpaths are the outer loop plus its holes; the
 * document's fill rule decides how they combine. Region paint can be a solid
 * colour or a real gradient (built from the same `regionStylePaint` the canvas
 * uses), so nothing about it is preview-only.
 */
function regionMarkup(doc: CardDocument, defs: string[]): string {
  const painted = paintedRegions(doc);
  if (painted.length === 0) return "";
  const rule = regionFillRule(doc);
  return painted
    .map(({ face, style }) => {
      const paint = regionStylePaint(style);
      let fill = escapeXml(svgColor(paint.fill));
      if (paint.gradient) {
        const id = `region-grad-${face.id}`;
        defs.push(gradientMarkup(id, paint.gradient, doc.artboard.width, doc.artboard.height));
        fill = `url(#${id})`;
      }
      const d = regionFacePathD(face);
      if (!d) return "";
      const opacity = style.opacity !== undefined && style.opacity < 1 ? ` opacity="${n(style.opacity)}"` : "";
      return `<path d="${escapeXml(d)}" fill="${fill}" fill-rule="${rule}"${opacity}/>`;
    })
    .join("");
}

function pathMarkup(layer: PathLayer, defs: string[]): string {
  const stroke = resolveStroke(layer, "#0ea5e9");
  // The RESOLVER is the single geometry contract — rawD ornaments and
  // bend arcs serialize with exactly the same `d` the canvas renders.
  const d = resolveLayerPathD(layer);
  if (!d) return "";

  // A path fill may be a solid colour or an editor gradient (ornaments);
  // the gradient becomes a real <defs> entry like a shape fill.
  let fill = "none";
  if (layer.fill) {
    if (isGradientCss(layer.fill)) {
      const spec = parseGradientCss(layer.fill);
      if (spec) {
        const id = `path-grad-${layer.id}`;
        defs.push(gradientMarkup(id, spec, layer.width, layer.height));
        fill = `url(#${id})`;
      }
    } else {
      fill = escapeXml(svgColor(layer.fill));
    }
  }
  // Fill rule is serialized only when the layer actually sets a non-default one,
  // so pre-upgrade documents export byte-identically.
  const fillRule =
    layer.fillRule && layer.fillRule !== "nonzero" ? ` fill-rule="${layer.fillRule}"` : "";
  return `<path d="${escapeXml(d)}" fill="${fill}"${fillRule}${strokeAttrs(stroke)}/>`;
}

function textMarkup(layer: TextLayer, embeddedVazir: boolean): string {
  const lines = String(layer.text ?? "").split("\n");
  if (lines.every((line) => line.trim() === "")) return "";

  const lineStep = layer.fontSize * (layer.lineHeight ?? 1.25);
  const blockHeight = lines.length * lineStep;
  // The canvas centres the text block vertically; ~0.78em is the cap/ascent
  // offset that puts the first baseline in the same place.
  const startY = (layer.height - blockHeight) / 2 + lineStep * 0.78;

  const anchor = layer.align === "center" ? "middle" : layer.align === "end" ? "end" : "start";
  // The canvas renders inside a `dir=rtl` root, where `start` means RIGHT for
  // every script. Mirror that: RTL text uses SVG's direction-aware anchors
  // directly; LTR text must anchor its END at the right edge instead (an LTR
  // `start` anchor would flow the text off the right side of the box).
  const rtl = RTL_CHARACTERS.test(layer.text ?? "");
  const anchorForPainting = rtl ? anchor : layer.align === "center" ? "middle" : layer.align === "start" ? "end" : "start";
  const x = layer.align === "center" ? layer.width / 2 : layer.align === "end" ? 0 : layer.width;

  // Text colour: the layer's own `color` field. A MISSING colour is not an
  // excuse to emit black — inherit instead, so white-on-dark text that predates
  // the colour field stays white inside a standalone .svg file too.
  const fill = layer.color ? ` fill="${escapeXml(svgColor(layer.color))}"` : " fill=\"currentColor\"";

  const common =
    `font-family="${escapeXml(exportFontStack(layer.fontFamily, embeddedVazir))}" ` +
    `font-size="${n(layer.fontSize)}" font-weight="${layer.fontWeight}" ` +
    `text-anchor="${anchorForPainting}"${fill}` +
    (rtl ? " direction=\"rtl\"" : "") +
    (layer.letterSpacing ? ` letter-spacing="${n(layer.letterSpacing)}"` : "") +
    (layer.italic ? " font-style=\"italic\"" : "") +
    (layer.underline || layer.strikethrough ? ` text-decoration="${layer.underline ? "underline" : ""}${layer.underline && layer.strikethrough ? " " : ""}${layer.strikethrough ? "line-through" : ""}"` : "");

  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${n(x)}" dy="${index === 0 ? 0 : n(lineStep)}">${escapeXml(line || " ")}</tspan>`,
    )
    .join("");

  return `<text x="${n(x)}" y="${n(startY)}" ${common} xml:space="preserve">${spans}</text>`;
}

/**
 * Badges are a DOM-flex visual on the canvas (pill + glyph + label), so the
 * serializer rebuilds the same composition from primitives: a pill, the badge's
 * own glyph, and the label.
 *
 * HONEST LIMITATION: SVG has no text layout engine, so the gap between glyph
 * and label is computed from an estimated advance width. A badge is two or
 * three words long, so the error is sub-pixel in practice — and the alternative
 * (omitting the layer) would hand the user a file that disagrees with the
 * canvas, which is worse than an approximation.
 */
/**
 * The badge label's layout, shared by the serializer AND the PDF text
 * rasterizer — two consumers that must agree on where the label sits.
 */
export function badgeTextLayout(layer: BadgeLayer): {
  fontSize: number;
  textWidth: number;
  /** Left edge of the label box (RTL: the label sits left of the glyph). */
  left: number;
  /** Alphabetic baseline y of the label. */
  baseline: number;
} {
  const fontSize = Math.min(20, layer.height * 0.5);
  const glyph = fontSize;
  const gap = 6;
  const text = String(layer.text ?? "");
  // Persian glyph advances average ≈0.58em for Vazirmatn; 1em is the safe cap.
  const textWidth = Math.min(text.length * fontSize * 0.58, Math.max(0, layer.width - glyph - gap));
  const total = glyph + gap + textWidth;
  const left = Math.max(0, (layer.width - total) / 2);
  return { fontSize, textWidth, left, baseline: layer.height / 2 + fontSize * 0.35 };
}

function badgeMarkup(layer: BadgeLayer, embeddedVazir: boolean): string {
  const { fontSize, textWidth, left, baseline } = badgeTextLayout(layer);
  const glyph = fontSize;
  const gap = 6;
  const text = String(layer.text ?? "");

  const background = escapeXml(svgColor(layer.background ?? "#0ea5e9"));
  const color = escapeXml(svgColor(layer.color ?? "#ffffff"));
  const scale = glyph / 24;

  // Badges are drawn in an RTL artboard, so the glyph sits to the RIGHT of the
  // label (it is the flex row's first child).
  const glyphX = left + textWidth + gap;
  const glyphY = (layer.height - glyph) / 2;
  const glyphMarkup =
    layer.style === "promoted"
      ? `<path d="M12 2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 16.8 6.2 19.9l1.1-6.5L2.6 8.8l6.5-.9L12 2z" fill="${color}"/>`
      : `<path d="M20 6L9 17l-5-5" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;

  return (
    `<rect x="0" y="0" width="${n(layer.width)}" height="${n(layer.height)}" rx="${n(layer.height / 2)}" ry="${n(layer.height / 2)}" fill="${background}"/>` +
    `<g transform="translate(${n(glyphX)} ${n(glyphY)}) scale(${n(scale)})">${glyphMarkup}</g>` +
    `<text x="${n(left + textWidth)}" y="${n(baseline)}" fill="${color}" ` +
    `font-family="${escapeXml(exportFontStack(undefined, embeddedVazir))}" font-size="${n(fontSize)}" font-weight="700" ` +
    `text-anchor="start" direction="rtl" xml:space="preserve">${escapeXml(text)}</text>`
  );
}

function imageMarkup(layer: ImageLayer, assets: SvgAssetMap, defs: string[]): string {
  const href = assets[layer.src];
  const clip = layer.radius > 0 ? ` clip-path="url(#clip-${layer.id})"` : "";
  if (layer.radius > 0) {
    defs.push(
      `<clipPath id="clip-${layer.id}"><rect x="0" y="0" width="${n(layer.width)}" height="${n(layer.height)}" rx="${n(layer.radius)}" ry="${n(layer.radius)}"/></clipPath>`,
    );
  }

  const fit = layer.objectFit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
  const flipX = layer.flipX ? -1 : 1;
  const flipY = layer.flipY ? -1 : 1;
  const transform =
    flipX === 1 && flipY === 1
      ? ""
      : ` transform="translate(${flipX === -1 ? n(layer.width) : 0} ${flipY === -1 ? n(layer.height) : 0}) scale(${flipX} ${flipY})"`;

  if (!href) {
    // Honest placeholder: same tone as the canvas's "no image" state.
    return `<rect x="0" y="0" width="${n(layer.width)}" height="${n(layer.height)}" rx="${n(layer.radius)}" fill="rgba(148,163,184,0.25)"/>`;
  }

  return (
    `<image${transform}${clip} x="0" y="0" width="${n(layer.width)}" height="${n(layer.height)}" ` +
    `preserveAspectRatio="${fit}" href="${escapeXml(href)}" xlink:href="${escapeXml(href)}"/>`
  );
}

function qrMarkup(layer: QrLayer, assets: SvgAssetMap): string {
  const slug = layer.payload.trim();
  const href = slug ? assets[slug] : undefined;
  const frame =
    `<rect x="0" y="0" width="${n(layer.width)}" height="${n(layer.height)}" rx="10" fill="${escapeXml(svgColor(layer.light))}"/>`;
  if (!href) return frame;
  return (
    frame +
    `<image x="4" y="4" width="${n(Math.max(1, layer.width - 8))}" height="${n(Math.max(1, layer.height - 8))}" href="${escapeXml(href)}" xlink:href="${escapeXml(href)}"/>`
  );
}

/**
 * The layer's VISUAL, in its own local coordinates (origin at the layer's
 * top-left). Position, rotation and opacity are applied once, by the driver —
 * so there is exactly one place that knows how a layer becomes a frame, and no
 * markup is ever re-parsed to add a transform.
 */
function layerBody(
  layer: CardLayer,
  defs: string[],
  options: Required<Pick<SerializeOptions, "assets">> & { embeddedVazir: boolean },
): string {
  if (layer.hidden) return "";
  switch (layer.kind) {
    case "shape":
      return shapeMarkup(layer, defs);
    case "path":
      return pathMarkup(layer, defs);
    case "text":
      return textMarkup(layer, options.embeddedVazir);
    case "image":
      return imageMarkup(layer, options.assets, defs);
    case "qr":
      return qrMarkup(layer, options.assets);
    case "badge":
      return badgeMarkup(layer, options.embeddedVazir);
    default:
      return "";
  }
}

/**
 * The layer FRAME, mirroring `layerStyle()` in the React renderer: artboard
 * position as a `translate`, then rotation about the layer's centre (CSS
 * `transform-origin: 50% 50%`), then the layer opacity.
 */
function layerFrame(layer: CardLayer, body: string): string {
  const angle = layer.angle ?? 0;
  const transform =
    `translate(${n(layer.x)} ${n(layer.y)})` +
    (angle ? ` rotate(${n(angle)} ${n(layer.width / 2)} ${n(layer.height / 2)})` : "");
  const opacity = layer.opacity < 1 ? ` opacity="${n(layer.opacity)}"` : "";
  return `<g transform="${transform}"${opacity} data-layer="${escapeXml(layer.id)}">${body}</g>`;
}

/* ---------------------------------- driver --------------------------------- */

/**
 * Serialize a document to a standalone SVG string.
 *
 * The layer group carries the layer's ARTBOARD position as a `translate`, so
 * each visual is emitted in its own local coordinates — exactly like the React
 * renderer's absolutely-positioned layer box.
 */
export function serializeDocument(doc: CardDocument, options: SerializeOptions = {}): string {
  const width = doc.artboard.width;
  const height = doc.artboard.height;
  const assets = options.assets ?? {};
  const defs: string[] = [];
  const embeddedVazir = Boolean(options.fontCss);

  const background = resolveBackgroundPaint(doc.background, width, height, "grad-artboard");
  if (background.defs) defs.push(background.defs);

  // LIVE-PAINT REGION FILLS: painted faces are emitted BEFORE the layer stack
  // (under the artwork), exactly like the on-screen projection, so the boundary
  // strokes stay on top and the exported card matches the preview byte for bite.
  const regionPaint = regionMarkup(doc, defs);

  const body = doc.layers
    .map((layer) => {
      const inner = layerBody(layer, defs, { assets, embeddedVazir });
      return inner === "" ? "" : layerFrame(layer, inner);
    })
    .join("");

  const fontStyle = options.fontCss ? `<style type="text/css"><![CDATA[${options.fontCss}]]></style>` : "";
  const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">` +
    fontStyle +
    defsBlock +
    `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${background.paint}"/>` +
    regionPaint +
    body +
    `</svg>`
  );
}
