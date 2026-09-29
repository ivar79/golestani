"use client";

/**
 * exportCard — the four real output formats, from ONE document.
 *
 * WHY THIS SHAPE: the card is drawn twice in a user's life — once by React on
 * screen, once by a serializer on export. If those two disagree the user sees
 * a lie. So the vector formats are produced from `serializeDocument()`, which
 * shares its geometry with the on-screen renderer (`domain/shapes.ts`,
 * `domain/path.ts`), and the raster formats come from the very same DOM the
 * user is looking at.
 *
 * Honest capability matrix (no control here is decorative):
 *   png / jpg  ← rasterized from the live artboard element at 1×/2×/4×
 *   svg        ← pure vector; fonts embedded as base64 woff2
 *   pdf        ← jsPDF page sized exactly to the card; shapes and paths stay
 *                vector (`svg2pdf.js`), while assets (photos, QR) are embedded
 *                as high-resolution PNGs because PDF has no SVG image type.
 *
 * Everything here runs in the browser and returns a Blob/DataURL; nothing is
 * faked or silently downgraded.
 */

import { toJpeg, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import "svg2pdf.js";
import type { BadgeLayer, CardDocument, TextLayer } from "../domain/document";
import { mediaSrc } from "@/lib/media";
import { RTL_CHARACTERS, badgeTextLayout, serializeDocument, svgColor, type SvgAssetMap } from "./documentToSvg";
import { exportFileName } from "./formats";

/* --------------------------------- formats --------------------------------- */

// The format catalog lives in the dependency-free `formats` module so it can be
// unit-tested without pulling jsPDF or the DOM into the test environment.
export {
  EXPORT_FORMATS,
  RASTER_FORMATS,
  RASTER_SCALES,
  exportFileName,
  formatInfo,
  isVectorFormat,
} from "./formats";
export type { ExportFormat, ExportFormatInfo, RasterScale } from "./formats";

import {
  formatInfo,
  isVectorFormat,
  type ExportFormat,
  type RasterScale,
} from "./formats";

/* ---------------------------------- fonts ---------------------------------- */

const FONT_DIR = "/fonts";
/** Weights that exist as files. Keys are the CSS `font-weight` values. */
const VAZIR_WEIGHTS: readonly { file: string; weight: number }[] = [
  { file: "Vazirmatn-Regular", weight: 400 },
  { file: "Vazirmatn-Medium", weight: 500 },
  { file: "Vazirmatn-SemiBold", weight: 600 },
  { file: "Vazirmatn-Bold", weight: 700 },
  { file: "Vazirmatn-Black", weight: 900 },
];

/**
 * Exported files carry their OWN copy of the font, so Persian text keeps its
 * glyph shapes on a machine that has never seen Vazirmatn. Without this the
 * vector formats would be "correct" but visually different from the canvas.
 */
async function fetchBase64(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  } catch {
    return null;
  }
}

let fontCssPromise: Promise<string> | null = null;

/** `@font-face` rules with base64 woff2 — cached for the page's lifetime. */
export function loadFontCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const loaded = await Promise.all(
        VAZIR_WEIGHTS.map(async ({ file, weight }) => {
          const base64 = await fetchBase64(`${FONT_DIR}/${file}.woff2`);
          if (!base64) return null;
          return (
            `@font-face{font-family:"Vazirmatn";font-style:normal;font-weight:${weight};` +
            `font-display:block;src:url(data:font/woff2;base64,${base64}) format("woff2");}`
          );
        }),
      );
      return loaded.filter((rule): rule is string => rule !== null).join("");
    })();
  }
  return fontCssPromise;
}

/**
 * RTL text runs are rasterized from the browser's own shaper (see
 * `rasterizeRtlTextRuns`), so jsPDF needs no font registration — which is just
 * as well, because jsPDF's text API has no Arabic shaping and would render
 * Persian with disconnected glyphs.
 */

/* --------------------------------- assets ---------------------------------- */

type AssetRequest = { key: string; url: string; targetWidth: number };

/** Every external pixel the document references, with the resolution it needs. */
function assetRequests(doc: CardDocument, scale: number): AssetRequest[] {
  const requests: AssetRequest[] = [];
  for (const layer of doc.layers) {
    if (layer.kind === "image" && layer.src) {
      const url = mediaSrc(layer.src);
      if (url) requests.push({ key: layer.src, url, targetWidth: Math.ceil(layer.width * scale) });
    } else if (layer.kind === "qr") {
      const slug = layer.payload.trim();
      if (slug) {
        requests.push({
          key: slug,
          url: `/api/qr/${encodeURIComponent(slug)}`,
          targetWidth: Math.ceil(layer.width * scale),
        });
      }
    }
  }
  return requests;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable blob"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Normalize any referenced image to a PNG data URI at (up to) the requested
 * width. `svg2pdf.js` can only place raster images, so a photo that the browser
 * would happily show as WebP/AVIF must become PNG before it can enter a PDF.
 * Vector sources (our QR SVG) are rasterized at the requested size, which is
 * several times the on-card size — so it stays sharp.
 */
async function rasterizeToPngDataUrl(url: string, targetWidth: number): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return null;
    const dataUrl = await blobToDataUrl(await res.blob());
    const img = await loadImage(dataUrl);
    const natural = img.naturalWidth || img.width || targetWidth;
    const width = Math.max(1, Math.min(natural, targetWidth || natural));
    const height = Math.max(1, Math.round((img.naturalHeight / natural) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Assets for the SVG export: original bytes as data URIs, so vector sources
 * (our own QR route) stay VECTOR inside the exported file.
 */
export async function collectVectorAssets(doc: CardDocument): Promise<SvgAssetMap> {
  const requests = assetRequests(doc, 1);
  const results = await Promise.all(
    requests.map(async (request) => {
      try {
        const res = await fetch(request.url, { credentials: "same-origin" });
        if (!res.ok) return null;
        return [request.key, await blobToDataUrl(await res.blob())] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(results.filter((entry): entry is readonly [string, string] => entry !== null));
}

/** Assets for the PDF export: everything normalized to PNG (jsPDF-compatible). */
async function collectPdfAssets(doc: CardDocument, scale: number): Promise<SvgAssetMap> {
  const requests = assetRequests(doc, scale);
  const results = await Promise.all(
    requests.map(async (request) => {
      const png = await rasterizeToPngDataUrl(request.url, request.targetWidth);
      return png ? ([request.key, png] as const) : null;
    }),
  );
  return Object.fromEntries(results.filter((entry): entry is readonly [string, string] => entry !== null));
}

/* --------------------------------- download --------------------------------- */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  // Revoke on the next tick: Safari needs the URL alive until the click is
  // handled, but it must not leak for the rest of the session.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/* ---------------------------------- raster ---------------------------------- */

/** The card's own aspect box, so a raster export is never rescaled by CSS. */
const RASTER_PIXEL_RATIO: Record<RasterScale, number> = { 1: 1, 2: 2, 4: 4 };

/**
 * Rasterize the live artboard. `pixelRatio` is the only knob that changes real
 * output resolution — the artboard is a fixed 1050×600 CSS box, so 1× is
 * exactly card-sized and 4× is print-grade.
 */
export async function exportRaster(
  node: HTMLElement,
  format: Extract<ExportFormat, "png" | "jpg">,
  scale: RasterScale,
): Promise<string> {
  const options = {
    pixelRatio: RASTER_PIXEL_RATIO[scale],
    cacheBust: true,
    // PNG keeps the artboard's own background painted by the renderer itself;
    // JPG has no alpha channel, so give it an explicit white ground rather than
    // letting it composite to black.
    backgroundColor: format === "jpg" ? "#ffffff" : undefined,
    quality: 0.98,
  };
  return format === "png" ? toPng(node, options) : toJpeg(node, { ...options, quality: 0.95 });
}

/* ----------------------------------- svg ----------------------------------- */

export async function buildSvg(doc: CardDocument, withFonts = true): Promise<string> {
  const [fontCss, assets] = await Promise.all([
    withFonts ? loadFontCss() : Promise.resolve(""),
    collectVectorAssets(doc),
  ]);
  return serializeDocument(doc, { fontCss, assets });
}

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

export async function exportSvgFile(doc: CardDocument, slug: string): Promise<void> {
  downloadBlob(exportFileName(slug, "svg"), svgBlob(await buildSvg(doc)));
}

/* ----------------------------------- pdf ----------------------------------- */

/** 96 CSS px per inch — the artboard is defined in CSS px. */
const CSS_PX_PER_INCH = 96;

/** How much larger than the card the text snapshots are rasterized at. */
const PDF_TEXT_DPI = 4;

/**
 * jsPDF has no Arabic/Persian SHAPING engine: a TTF gets embedded but the text
 * renders with disconnected isolated glyphs — unreadable for the primary
 * audience of this product. Browsers DO shape correctly (HarfBuzz), so the
 * honest engineering trade-off is:
 *
 *   - every shape, path, gradient and stroke stays TRUE VECTOR in the PDF
 *   - only RTL text runs become high-DPI images (4× ≈ 384 dpi at print size),
 *     rendered by the same engine the canvas uses, so the glyphs match the
 *     preview exactly.
 *
 * The swap happens on the serialized SVG BEFORE svg2pdf sees it, so the PDF
 * geometry and the exported SVG stay one implementation.
 */
async function rasterizeRtlTextRuns(svg: string, doc: CardDocument, embeddedVazir: boolean): Promise<string> {
  const textLayers = doc.layers.filter(
    (layer): layer is TextLayer => layer.kind === "text" && RTL_CHARACTERS.test(layer.text ?? "") && !layer.hidden,
  );
  const badgeLayers = doc.layers.filter(
    (layer): layer is BadgeLayer => layer.kind === "badge" && RTL_CHARACTERS.test(layer.text ?? "") && !layer.hidden,
  );
  if (textLayers.length === 0 && badgeLayers.length === 0) return svg;

  await ensureFontsLoaded();
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;

  /** Replace one <text> with a high-DPI canvas snapshot of the same run. */
  const swap = (
    text: SVGElement,
    layer: TextLayer | BadgeLayer,
    draw: (ctx: CanvasRenderingContext2D) => void,
    box: { pad: number; width: number; height: number },
  ) => {
    const { pad, width, height } = box;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * PDF_TEXT_DPI);
    canvas.height = Math.ceil(height * PDF_TEXT_DPI);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(PDF_TEXT_DPI, PDF_TEXT_DPI);
    ctx.translate(pad, pad);
    ctx.direction = "rtl"; // the app root is dir=rtl; shaping must match
    draw(ctx);

    const image = parsed.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("x", String(-pad));
    image.setAttribute("y", String(-pad));
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("href", canvas.toDataURL("image/png"));
    image.setAttribute("preserveAspectRatio", "none");
    text.replaceWith(image);
  };

  const family = embeddedVazir ? '"Vazirmatn", sans-serif' : "Tahoma, Arial, sans-serif";

  for (const layer of textLayers) {
    const group = root.querySelector(`g[data-layer="${CSS.escape(layer.id)}"]`);
    const text = group?.querySelector("text");
    if (!group || !text) continue;

    const fontSize = layer.fontSize;
    const pad = Math.ceil(fontSize * 0.35);
    const width = layer.width + pad * 2;
    const height = layer.height + pad * 2;

    swap(text as unknown as SVGElement, layer, (ctx) => {
      // The same text composition the canvas uses: centred block, per-line
      // alignment, Vazirmatn when embedded.
      const lineStep = fontSize * (layer.lineHeight ?? 1.25);
      const lines = String(layer.text ?? "").split("\n");
      ctx.textAlign = layer.align === "center" ? "center" : layer.align === "end" ? "left" : "right";
      ctx.textBaseline = "middle";
      lines.forEach((line, index) => {
        ctx.font = `${layer.fontWeight} ${fontSize}px ${family}`;
        const y = (layer.height - lines.length * lineStep) / 2 + lineStep * (index + 0.5);
        const x = layer.align === "center" ? layer.width / 2 : layer.align === "end" ? 0 : layer.width;
        ctx.fillStyle = layer.color ?? "#000000";
        ctx.fillText(line, x, y);
      });
    }, { pad, width, height });
  }

  // Badge labels are RTL <text> too — svg2pdf would render them unshaped.
  for (const layer of badgeLayers) {
    const group = root.querySelector(`g[data-layer="${CSS.escape(layer.id)}"]`);
    const text = group?.querySelector("text");
    if (!group || !text) continue;

    const { fontSize, textWidth, left, baseline } = badgeTextLayout(layer);
    // Rasterize against the WHOLE layer box: the 0.58em advance estimate can
    // undershoot the shaped word, so the label is anchored at its RIGHT edge
    // (exactly where the SVG `start` anchor puts it in RTL) and any overflow
    // extends leftward into padding instead of being clipped by the canvas.
    const pad = Math.max(10, Math.ceil(fontSize * 0.6));
    const width = layer.width + pad * 2;
    const height = layer.height + pad * 2;

    swap(text as unknown as SVGElement, layer, (ctx) => {
      ctx.font = `700 ${fontSize}px ${family}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic"; // same baseline convention as SVG
      ctx.fillStyle = svgColor(layer.color ?? "#ffffff");
      ctx.fillText(String(layer.text ?? ""), left + textWidth, baseline);
    }, { pad, width, height });
  }

  return new XMLSerializer().serializeToString(root);
}

/**
 * Make the embedded woff2 available to CANVAS text as well — the rasterized
 * text runs must use the real glyph shapes, not a fallback.
 */
let fontsLoadedPromise: Promise<void> | null = null;
async function ensureFontsLoaded(): Promise<void> {
  if (!fontsLoadedPromise) {
    fontsLoadedPromise = (async () => {
      const css = await loadFontCss();
      if (!css) return;
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      await document.fonts.ready;
      // Force-load every weight we registered; `fonts.ready` only waits for
      // fonts the page has actually USED.
      await Promise.all(
        VAZIR_WEIGHTS.map(({ weight }) => document.fonts.load(`${weight} 16px "Vazirmatn"`)),
      );
    })();
  }
  return fontsLoadedPromise;
}

/**
 * Build the PDF as a Blob. Split from the download so the same bytes can be
 * inspected (or handed to another consumer) without triggering a save.
 */
export async function buildPdf(doc: CardDocument): Promise<Blob> {
  const { width, height } = doc.artboard;
  // A PDF page is physical, so honour the card's real size (1050×600 px ≈
  // 10.94×6.25 in) instead of pretending a pixel is a point.
  const pageWidth = (width / CSS_PX_PER_INCH) * 25.4;
  const pageHeight = (height / CSS_PX_PER_INCH) * 25.4;

  const pdf = new jsPDF({
    unit: "mm",
    format: [pageWidth, pageHeight],
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    compress: true,
  });

  const [fontCss, assets] = await Promise.all([loadFontCss(), collectPdfAssets(doc, 4)]);
  const rawSvg = serializeDocument(doc, { fontCss, assets });

  // RTL text → 4× snapshots (shaped by the browser), everything else vector.
  const svg = await rasterizeRtlTextRuns(rawSvg, doc, Boolean(fontCss));

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.nodeName === "parsererror" || parsed.querySelector("parsererror")) {
    throw new Error("سند SVG برای خروجی PDF نامعتبر است.");
  }

  await pdf.svg(root as unknown as SVGElement, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  return pdf.output("blob");
}

export async function exportPdfFile(doc: CardDocument, slug: string): Promise<void> {
  downloadBlob(exportFileName(slug, "pdf"), await buildPdf(doc));
}

/* -------------------------------- dispatcher -------------------------------- */

/**
 * One entry point for the export menu. `node` is required for raster formats
 * (the live artboard); vector formats only need the document.
 */
export async function exportCardFile({
  format,
  doc,
  node,
  slug,
  scale = 2,
}: {
  format: ExportFormat;
  doc: CardDocument | null;
  node: HTMLElement | null;
  slug: string;
  scale?: RasterScale;
}): Promise<void> {
  if (isVectorFormat(format)) {
    if (!doc) throw new Error(`${formatInfo(format).label}: سند طرح در دسترس نیست.`);
    if (format === "svg") return exportSvgFile(doc, slug);
    return exportPdfFile(doc, slug);
  }
  if (!node) throw new Error("سطح خروجی تصویری در دسترس نیست.");
  if (format !== "png" && format !== "jpg") throw new Error(`unsupported raster format: ${format}`);
  downloadDataUrl(exportFileName(slug, format), await exportRaster(node, format, scale));
}
