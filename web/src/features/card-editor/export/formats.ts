/**
 * Export format metadata — deliberately dependency-free.
 *
 * The menu, the filename contract and the "which formats need a document"
 * partition all live here, with no browser API and no jsPDF import, so the
 * inventory of what the product offers can be unit-tested directly. `exportCard`
 * re-exports these for its callers.
 *
 * Raster formats come from the live DOM; vector formats come from the document.
 * That split is the reason `needsDocument` exists as data rather than as a
 * branch scattered through the UI.
 */

export type ExportFormat = "png" | "jpg" | "svg" | "pdf";

/** Raster supersampling. `1` = 1050×600 px, `4` = 4200×2400 px. */
export type RasterScale = 1 | 2 | 4;

export const RASTER_SCALES: readonly RasterScale[] = [1, 2, 4];

export type ExportFormatInfo = {
  key: ExportFormat;
  /** Short label shown on the button. */
  label: string;
  hint: string;
  extension: string;
  /** True when the format needs the layered DOCUMENT, not just the rendered DOM. */
  needsDocument: boolean;
  mime: string;
};

export const EXPORT_FORMATS: readonly ExportFormatInfo[] = [
  {
    key: "png",
    label: "PNG",
    hint: "تصویر با کیفیت بالا، مناسب وب",
    extension: "png",
    needsDocument: false,
    mime: "image/png",
  },
  {
    key: "jpg",
    label: "JPG",
    hint: "تصویر کم‌حجم، مناسب اشتراک‌گذاری",
    extension: "jpg",
    needsDocument: false,
    mime: "image/jpeg",
  },
  {
    key: "svg",
    label: "SVG",
    hint: "برداری و بی‌نهایت بزرگ‌پذیر، مناسب چاپ و نرم‌افزار طراحی",
    extension: "svg",
    needsDocument: true,
    mime: "image/svg+xml",
  },
  {
    key: "pdf",
    label: "PDF",
    hint: "سند چاپی با ابعاد دقیق کارت",
    extension: "pdf",
    needsDocument: true,
    mime: "application/pdf",
  },
];

export const RASTER_FORMATS: readonly ExportFormat[] = EXPORT_FORMATS.filter((f) => !f.needsDocument).map(
  (f) => f.key,
);

export function formatInfo(format: ExportFormat): ExportFormatInfo {
  const found = EXPORT_FORMATS.find((entry) => entry.key === format);
  if (!found) throw new Error(`unknown export format: ${format}`);
  return found;
}

/** True when this format is produced from the document rather than the DOM. */
export function isVectorFormat(format: ExportFormat): boolean {
  return formatInfo(format).needsDocument;
}

/** The image scale is meaningless for vector output, so it is settled here. */
export function isScalableFormat(format: ExportFormat): boolean {
  return !isVectorFormat(format);
}

/**
 * `inkart-<slug>.<ext>` — one place decides how an exported file is named.
 * A Persian (or otherwise unsafe) slug falls back to `card` rather than
 * producing a filename some operating systems will refuse.
 */
export function exportFileName(slug: string, format: ExportFormat): string {
  const safe = slug.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `inkart-${safe || "card"}.${formatInfo(format).extension}`;
}
