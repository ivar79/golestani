import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMATS,
  RASTER_FORMATS,
  RASTER_SCALES,
  exportFileName,
  formatInfo,
  isScalableFormat,
  isVectorFormat,
  type ExportFormat,
} from "../formats";

/**
 * The "no fake controls" contract, as a test.
 *
 * Every format the menu offers must be one this product can actually produce,
 * with a real extension, a real MIME type and an unambiguous input
 * (DOM or document). If someone adds a fifth button without implementing it,
 * this suite is what stops the UI from promising something that does not exist.
 */
describe("export format inventory", () => {
  const keys = EXPORT_FORMATS.map((format) => format.key);

  it("offers exactly the four implemented formats", () => {
    expect(keys).toEqual<ExportFormat[]>(["png", "jpg", "svg", "pdf"]);
  });

  it("has a unique extension and a real MIME type for every format", () => {
    const extensions = EXPORT_FORMATS.map((format) => format.extension);
    expect(new Set(extensions).size).toBe(extensions.length);
    for (const format of EXPORT_FORMATS) {
      expect(format.extension).toMatch(/^[a-z0-9]+$/);
      expect(format.mime).toMatch(/^[\w.+-]+\/[\w.+-]+$/);
      // A hint is user-facing copy; an empty one would render as a blank row.
      expect(format.hint.length).toBeGreaterThan(4);
    }
  });

  it("declares an input for every format: raster needs the DOM, vector the document", () => {
    expect(EXPORT_FORMATS.filter((format) => !format.needsDocument).map((format) => format.key)).toEqual([
      "png",
      "jpg",
    ]);
    expect(isVectorFormat("svg")).toBe(true);
    expect(isVectorFormat("pdf")).toBe(true);
    expect(isVectorFormat("png")).toBe(false);
  });

  it("keeps PNG and JPEG the only scalable formats", () => {
    expect([...RASTER_FORMATS]).toEqual(["png", "jpg"]);
    expect(isScalableFormat("jpg")).toBe(true);
    expect(isScalableFormat("svg")).toBe(false);
  });

  it("orders raster scales smallest first", () => {
    expect([...RASTER_SCALES]).toEqual([1, 2, 4]);
  });

  it("throws on an unknown format instead of inventing one", () => {
    expect(() => formatInfo("webp" as ExportFormat)).toThrow(/unknown export format/);
  });
});

describe("exportFileName", () => {
  it("uses the format's own extension", () => {
    expect(exportFileName("my-shop", "svg")).toBe("inkart-my-shop.svg");
    expect(exportFileName("my-shop", "jpg")).toBe("inkart-my-shop.jpg");
  });

  it("keeps a URL-safe slug intact", () => {
    expect(exportFileName("inkart.studio-2", "pdf")).toBe("inkart-inkart.studio-2.pdf");
  });

  it("falls back to a generic name for a Persian slug", () => {
    expect(exportFileName("فروشگاه من", "png")).toBe("inkart-card.png");
  });

  it("strips characters an operating system would refuse", () => {
    expect(exportFileName("  a/b:c*d?  ", "png")).toBe("inkart-a-b-c-d.png");
    expect(exportFileName("", "png")).toBe("inkart-card.png");
  });
});
