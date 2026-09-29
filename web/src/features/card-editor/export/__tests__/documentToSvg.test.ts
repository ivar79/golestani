import { describe, expect, it } from "vitest";
import type {
  BadgeLayer,
  CardDocument,
  CardLayer,
  ImageLayer,
  PathLayer,
  QrLayer,
  ShapeLayer,
  TextLayer,
} from "../../domain/document";
import { serializeDocument } from "../documentToSvg";

/**
 * These tests exist to prove the EXPORT is the same drawing as the canvas.
 *
 * The failure mode they are guarding against is specific and nasty: a vector
 * export can look "fine" while quietly dropping the very features the UI offers
 * (dashes, caps, joins, corner radius, polygon sides, gradients). A user only
 * finds out at the printer. So every assertion here ties a DOCUMENT FIELD to an
 * observable SVG attribute.
 */

const BASE = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  angle: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  color: null,
  background: null,
};

function shapeLayer(overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return { ...BASE, id: "s1", kind: "shape", background: "#0ea5e9", shape: "rect", radius: 0, ...overrides };
}

function pathLayer(overrides: Partial<PathLayer> = {}): PathLayer {
  return {
    ...BASE,
    id: "p1",
    kind: "path",
    width: 100,
    height: 50,
    closed: false,
    points: [
      { x: 0, y: 0, hIn: null, hOut: null },
      { x: 100, y: 50, hIn: null, hOut: null },
    ],
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    ...overrides,
  };
}

function textLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    ...BASE,
    id: "t1",
    kind: "text",
    text: "کسب‌وکار من",
    fontSize: 32,
    fontWeight: 700,
    align: "start",
    fontFamily: "vazir",
    ...overrides,
  };
}

function imageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    ...BASE,
    id: "i1",
    kind: "image",
    src: "/storage/cards/logo.png",
    radius: 0,
    objectFit: "cover",
    ...overrides,
  };
}

function qrLayer(overrides: Partial<QrLayer> = {}): QrLayer {
  return { ...BASE, id: "q1", kind: "qr", width: 120, height: 120, payload: "my-shop", dark: "#000000", light: "#ffffff", ...overrides };
}

function badgeLayer(overrides: Partial<BadgeLayer> = {}): BadgeLayer {
  return { ...BASE, id: "b1", kind: "badge", width: 140, height: 36, style: "verified", text: "تأییدشده", ...overrides };
}

function doc(layers: CardLayer[], overrides: Partial<CardDocument> = {}): CardDocument {
  return { version: 1, artboard: { width: 1050, height: 600 }, background: "#ffffff", layers, ...overrides };
}

/** Every opening `<g …>` attribute list in the output. */
function groupAttrs(svg: string): string[] {
  return [...svg.matchAll(/<g\b([^>]*)>/g)].map((match) => match[1]);
}

describe("serializeDocument — document frame", () => {
  it("emits a standalone SVG sized to the artboard, with no foreignObject", () => {
    const svg = serializeDocument(doc([shapeLayer()]));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1050"');
    expect(svg).toContain('height="600"');
    expect(svg).toContain('viewBox="0 0 1050 600"');
    // A <foreignObject> would make the file unreadable for design tools and for
    // the PDF converter, and would defeat the whole point of a vector export.
    expect(svg).not.toContain("foreignObject");
  });

  it("paints the artboard background and skips hidden layers", () => {
    const svg = serializeDocument(doc([shapeLayer({ id: "shown" }), shapeLayer({ id: "gone", hidden: true })]));
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('data-layer="shown"');
    expect(svg).not.toContain('data-layer="gone"');
  });

  it("turns a gradient artboard background into real <defs>", () => {
    const svg = serializeDocument(
      doc([shapeLayer()], { background: "linear-gradient(135deg, #0ea5e9 0%, #1e3a8a 100%)" }),
    );
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('stop-color="#0ea5e9"');
    expect(svg).toContain("url(#grad-artboard)");
  });

  it("emits balanced groups and never a duplicated transform attribute", () => {
    const svg = serializeDocument(
      doc([shapeLayer({ angle: 30, x: 10, y: 20 }), textLayer({ angle: 0 }), pathLayer({ angle: -15 })]),
    );
    expect((svg.match(/<g\b/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
    for (const attrs of groupAttrs(svg)) {
      expect((attrs.match(/transform=/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("serializeDocument — layer frame", () => {
  it("positions a layer with a translate and rotates about its own centre", () => {
    const svg = serializeDocument(doc([shapeLayer({ x: 40, y: 25, width: 200, height: 100, angle: 30 })]));
    expect(svg).toContain('transform="translate(40 25) rotate(30 100 50)"');
  });

  it("omits the rotation when the layer is not rotated", () => {
    const svg = serializeDocument(doc([shapeLayer({ x: 7, y: 8, angle: 0 })]));
    expect(svg).toContain('transform="translate(7 8)"');
    expect(svg).not.toContain("rotate(");
  });

  it("carries the layer opacity onto the group, and drops it when opaque", () => {
    const faded = serializeDocument(doc([shapeLayer({ opacity: 0.35 })]));
    expect(groupAttrs(faded).some((attrs) => attrs.includes('opacity="0.35"'))).toBe(true);
    expect(groupAttrs(serializeDocument(doc([shapeLayer({ opacity: 1 })]))).some((a) => a.includes("opacity="))).toBe(false);
  });
});

describe("serializeDocument — shapes", () => {
  it("writes the full stroke model (dash, cap, join, opacity, colour)", () => {
    const svg = serializeDocument(
      doc([
        shapeLayer({
          stroke: "#e11d48",
          strokeWidth: 6,
          strokeStyle: "dashed",
          strokeLinecap: "square",
          strokeLinejoin: "bevel",
          strokeOpacity: 0.4,
        }),
      ]),
    );
    expect(svg).toContain('stroke="#e11d48"');
    expect(svg).toContain('stroke-width="6"');
    expect(svg).toContain('stroke-dasharray="18 12"');
    expect(svg).toContain('stroke-linecap="square"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-opacity="0.4"');
  });

  it("keeps a dotted stroke dotted by forcing round caps", () => {
    const svg = serializeDocument(
      doc([shapeLayer({ stroke: "#111111", strokeWidth: 4, strokeStyle: "dotted", strokeLinecap: "butt" })]),
    );
    expect(svg).toContain('stroke-dasharray="0.04 8"');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it("renders a fill-only shape with no stroke attributes at all", () => {
    const svg = serializeDocument(doc([shapeLayer({ strokeWidth: 0 })]));
    expect(svg).toContain('fill="#0ea5e9"');
    expect(svg).not.toContain("stroke-width");
    expect(svg).not.toContain("stroke-linecap");
  });

  it("keeps the corner radius of a rectangle", () => {
    const svg = serializeDocument(doc([shapeLayer({ radius: 12 })]));
    expect(svg).toContain('rx="12"');
    expect(svg).toContain('ry="12"');
  });

  it("renders a polygon with exactly the requested sides", () => {
    const svg = serializeDocument(doc([shapeLayer({ shape: "polygon", sides: 7, width: 100, height: 100 })]));
    const points = /points="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(points.split(" ")).toHaveLength(7);
  });

  it("defaults a polygon to 6 sides when the field is absent", () => {
    const svg = serializeDocument(doc([shapeLayer({ shape: "polygon", sides: undefined, width: 100, height: 100 })]));
    expect((/points="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ")).toHaveLength(6);
  });

  it("gives a line a real thickness from strokeWidth, and no fill", () => {
    const svg = serializeDocument(doc([shapeLayer({ shape: "line", height: 40, stroke: "#123456", strokeWidth: 3 })]));
    expect(svg).toContain("<line");
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('fill="none"');
  });

  it("keeps a LEGACY line (no stroke fields) exactly as it looked before", () => {
    const svg = serializeDocument(
      doc([shapeLayer({ shape: "line", height: 40, stroke: undefined, strokeWidth: undefined, background: "#123456" })]),
    );
    expect(svg).toContain('stroke-width="40"');
    expect(svg).toContain('stroke="#123456"');
  });

  it("converts an editor gradient fill into <defs> + url(#…)", () => {
    const svg = serializeDocument(
      doc([shapeLayer({ background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" })]),
    );
    expect(svg).toContain("<defs>");
    expect(svg).toContain('id="shape-grad-s1"');
    expect(svg).toContain('fill="url(#shape-grad-s1)"');
  });

  it("emits no layer group for a degenerate box", () => {
    // (The artboard background is itself a <rect>, so assert on the layer.)
    const svg = serializeDocument(doc([shapeLayer({ width: 0 })]));
    expect(svg).not.toContain('data-layer="s1"');
  });
});

describe("serializeDocument — paths", () => {
  it("serializes cubic curves with the shared stroke model", () => {
    const svg = serializeDocument(
      doc([pathLayer({ strokeStyle: "dashed", strokeLinecap: "butt", strokeLinejoin: "miter" })]),
    );
    expect(svg).toContain("<path");
    expect(svg).toContain(" C ");
    expect(svg).toContain('stroke-dasharray="12 8"');
    expect(svg).toContain('stroke-linecap="butt"');
    expect(svg).toContain('stroke-linejoin="miter"');
  });

  it("closes the path and honours the fill when the layer says so", () => {
    const svg = serializeDocument(
      doc([
        pathLayer({
          closed: true,
          fill: "#fde68a",
          points: [
            { x: 0, y: 0, hIn: null, hOut: null },
            { x: 100, y: 0, hIn: null, hOut: null },
            { x: 100, y: 50, hIn: null, hOut: null },
          ],
        }),
      ]),
    );
    expect(svg).toContain("Z");
    expect(svg).toContain('fill="#fde68a"');
  });

  it("emits no fill for an open unfilled path", () => {
    expect(serializeDocument(doc([pathLayer()]))).toContain('fill="none"');
  });
});

describe("serializeDocument — text", () => {
  it("marks Persian text as RTL and anchors it on the correct edge", () => {
    const svg = serializeDocument(doc([textLayer({ align: "start" })]), { fontCss: "@font-face{}" });
    expect(svg).toContain("<text");
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('font-family="Vazirmatn, sans-serif"');
  });

  it("uses a machine-independent font stack when the font is NOT embedded", () => {
    const svg = serializeDocument(doc([textLayer({ fontFamily: "vazir" })]));
    expect(svg).toContain('font-family="Tahoma, Arial, sans-serif"');
  });

  it("maps alignment to a text-anchor and keeps each line as its own tspan", () => {
    const svg = serializeDocument(doc([textLayer({ align: "center", text: "خط اول\nخط دوم" })]));
    expect(svg).toContain('text-anchor="middle"');
    expect((svg.match(/<tspan/g) ?? []).length).toBe(2);
    expect(svg).toContain("خط اول");
    expect(svg).toContain("خط دوم");
  });

  it("does not force RTL on Latin text", () => {
    const svg = serializeDocument(doc([textLayer({ text: "InKart" })]));
    expect(svg).not.toContain('direction="rtl"');
  });

  it("renders nothing for a whitespace-only text layer", () => {
    expect(serializeDocument(doc([textLayer({ text: "   " })]))).not.toContain("<text");
  });

  it("embeds the supplied @font-face CSS in a style block", () => {
    const svg = serializeDocument(doc([textLayer()]), { fontCss: "@font-face{font-family:\"Vazirmatn\";}" });
    expect(svg).toContain("<style type=\"text/css\">");
    expect(svg).toContain("@font-face");
  });
});

describe("serializeDocument — media", () => {
  it("embeds a supplied data URI as an <image>", () => {
    const svg = serializeDocument(doc([imageLayer()]), {
      assets: { "/storage/cards/logo.png": "data:image/png;base64,AAAA" },
    });
    expect(svg).toContain("<image");
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it("shows an honest placeholder when the asset could not be fetched", () => {
    const svg = serializeDocument(doc([imageLayer()]));
    expect(svg).not.toContain("<image");
    expect(svg).toContain("rgba(148,163,184,0.25)");
  });

  it("clips a rounded image through a real clipPath", () => {
    const svg = serializeDocument(doc([imageLayer({ radius: 16 })]), {
      assets: { "/storage/cards/logo.png": "data:image/png;base64,AAAA" },
    });
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("clip-path=\"url(#clip-i1)\"");
  });

  it("mirrors an image with a transform instead of ignoring the flip flags", () => {
    const svg = serializeDocument(doc([imageLayer({ flipX: true })]), {
      assets: { "/storage/cards/logo.png": "data:image/png;base64,AAAA" },
    });
    expect(svg).toContain("scale(-1 1)");
  });

  it("draws a QR frame always, and the code itself when the asset exists", () => {
    const bare = serializeDocument(doc([qrLayer()]));
    expect(bare).toContain('fill="#ffffff"');
    expect(bare).not.toContain("<image");

    const withCode = serializeDocument(doc([qrLayer()]), { assets: { "my-shop": "data:image/svg+xml;base64,BBBB" } });
    expect(withCode).toContain('href="data:image/svg+xml;base64,BBBB"');
  });
});

describe("serializeDocument — badges", () => {
  // A badge is a DOM-flex visual on the canvas. An earlier version of the
  // serializer simply omitted it, which handed the user a file that disagreed
  // with the screen — the exact failure this suite exists to prevent.
  it("rebuilds the pill, the glyph and the label as real primitives", () => {
    const svg = serializeDocument(doc([badgeLayer()]), { fontCss: "@font-face{}" });
    expect(svg).toContain('data-layer="b1"');
    // Pill: full-round corners, badge background.
    expect(svg).toContain('rx="18"');
    expect(svg).toContain("#0ea5e9");
    // Verified glyph is the check mark, drawn as a stroked path.
    expect(svg).toContain("M20 6L9 17l-5-5");
    // The label itself, marked RTL.
    expect(svg).toContain("تأییدشده");
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('font-weight="700"');
  });

  it("uses the filled star for a promoted badge", () => {
    const svg = serializeDocument(doc([badgeLayer({ style: "promoted", text: "ویژه" })]));
    expect(svg).toContain("M12 2l2.9 5.9");
  });

  it("keeps the label inside the pill for a long text", () => {
    const svg = serializeDocument(doc([badgeLayer({ text: "یک برچسب بسیار بسیار طولانی برای آزمون" })]));
    const x = Number(/<text x="([-\.0-9]+)"/.exec(svg)?.[1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(140);
  });

  it("renders one group per visible layer", () => {
    const svg = serializeDocument(doc([badgeLayer(), shapeLayer()]));
    expect(svg).toContain('data-layer="b1"');
    expect(svg).toContain('data-layer="s1"');
  });
});
