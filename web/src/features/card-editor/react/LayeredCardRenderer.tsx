"use client";

/**
 * LayeredCardRenderer — pure projection of the card document to DOM.
 *
 * THE RENDERING CONTRACT (one projection, three consumers):
 *   `LayerBox` is the SINGLE implementation of how a document layer becomes
 *   DOM — its frame (position/size/opacity/rotation/z-order) plus its visual.
 *   It is consumed by:
 *     1. the editor stage      (interaction overlays sit ABOVE it)
 *     2. the export surface    (hidden 1:1 artboard, rasterized by html-to-image)
 *     3. the public card page  (read-only, scaled)
 *   Previously the stage carried its own copy (`StageLayerVisual`) which had
 *   already drifted from this file (different image placeholder tone, text
 *   glyphs); sharing `LayerBox` removes that whole class of bug.
 *
 * State-first: this renders whatever the document says, nothing more.
 * Everything is an escaped React child — there is no raw HTML injection.
 *
 * Media contract: document media is resolved through `mediaSrc` (same-origin
 * `/api/media/…` proxy) rather than straight to the API origin, because export
 * rasterization must be able to READ the pixels (cross-origin pixels need CORS,
 * which static storage files never get). QR uses our own cached `/api/qr/…`
 * route for the same reason.
 *
 * RTL-safe: dir=rtl root, semantic align maps to flexbox, phone-like tokens are
 * isolated by the caller's own typography.
 */

import { memo, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { CardDocument, CardLayer, ImageLayer, QrLayer, ShapeLayer, TextLayer, BadgeLayer, PathLayer } from "../domain/document";
import { layerZ } from "../domain/document";
import { mediaSrc } from "@/lib/media";
import { fetchPrivateAssetUrl, isPrivateAssetSrc, releasePrivateAssetUrl } from "@/lib/privateAsset";
import { resolveLayerPathD } from "../domain/path";
import { resolveShapePaint, type SvgPrimitive } from "../domain/shapes";
import { resolveStroke, type ResolvedStroke } from "../domain/stroke";
import { qrSrcFor } from "../domain/qrAssets";
import { gradientLine, gradientRadius, isGradientCss, parseGradientCss, svgColor, type SvgGradientSpec } from "../domain/svgGradient";
import {
  paintedRegions,
  regionFacePathD,
  regionFillRule,
  regionStylePaint,
} from "../domain/geometry/documentRegions";

/**
 * The layer FRAME — the only place a layer's geometry becomes CSS.
 * `pointerEvents: none` keeps the projection inert; interactive surfaces add
 * their own hit areas on top.
 */
export function layerStyle(layer: CardLayer, z: number): CSSProperties {
  let backdropFilter: string | undefined;
  let boxShadow: string | undefined;
  let filter: string | undefined;

  if (layer.effect === "glass") {
    backdropFilter = "blur(12px)";
    boxShadow = "0 8px 32px 0 rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.25)";
  } else if (layer.effect === "neon") {
    filter = "drop-shadow(0 0 6px #00f2fe) drop-shadow(0 0 18px rgba(0, 242, 254, 0.6))";
  } else if (layer.effect === "velvet") {
    boxShadow = "inset 0 0 35px rgba(0, 0, 0, 0.6), 0 4px 15px rgba(0, 0, 0, 0.35)";
  } else if (layer.effect === "gold") {
    filter = "drop-shadow(0 2px 8px rgba(191, 149, 63, 0.45))";
  } else if (layer.effect === "silver") {
    filter = "drop-shadow(0 2px 8px rgba(200, 200, 200, 0.35))";
  }

  // FRAME TRANSFORMS: rotation and mirroring are applied ONCE here, about the
  // layer's own centre (CSS default transform-origin), so every kind mirrors
  // identically and the SVG/PDF exporter reproduces the exact same matrix.
  const flipX = layer.flipX ? -1 : 1;
  const flipY = layer.flipY ? -1 : 1;
  const rotation = layer.angle ? `rotate(${layer.angle}deg)` : "";
  const mirror = flipX === -1 || flipY === -1 ? `scale(${flipX}, ${flipY})` : "";
  const transform = `${rotation} ${mirror}`.trim();

  return {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    opacity: layer.hidden ? 0 : layer.opacity,
    transform: transform === "" ? undefined : transform,
    zIndex: z,
    pointerEvents: "none",
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    boxShadow,
    filter,
  };
}

function resolveFontStack(fontFamily: string | undefined): string {
  switch (fontFamily) {
    case "serif":
      return "var(--font-serif, serif)";
    case "sans":
      return "var(--font-sans, sans-serif)";
    case "monospace":
      return "ui-monospace, SFMono-Regular, Menlo, monospace";
    default:
      return "Vazirmatn, var(--font-sans, sans-serif)";
  }
}

const alignToFlex: Record<TextLayer["align"], string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

/**
 * Stroke attributes shared by EVERY SVG primitive — one implementation, so no
 * element can quietly keep a hardcoded round cap (which is exactly how the
 * dashed/dotted/cap/join controls used to be silently ignored).
 */
function strokeAttrs(stroke: ResolvedStroke) {
  return {
    stroke: stroke.color,
    strokeWidth: stroke.width,
    strokeDasharray: stroke.dasharray,
    strokeDashoffset: stroke.dashoffset,
    strokeLinecap: stroke.linecap,
    strokeLinejoin: stroke.linejoin,
    strokeOpacity: stroke.opacity,
  };
}

/** Native `<defs>` for an editor gradient, in the shape's own box units. */
function GradientDefs({ id, spec, width, height }: { id: string; spec: SvgGradientSpec; width: number; height: number }) {
  const stops = spec.stops.map((stop, index) => (
    <stop key={index} offset={`${stop.offset}%`} stopColor={stop.color} />
  ));
  if (spec.type === "radial") {
    return (
      <radialGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        cx={width / 2}
        cy={height / 2}
        r={gradientRadius(width, height)}
      >
        {stops}
      </radialGradient>
    );
  }
  const line = gradientLine(spec, width, height);
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
      {stops}
    </linearGradient>
  );
}

/**
 * Renders a shape from the SHARED pure geometry (`domain/shapes.ts`) — the same
 * primitives the SVG/PDF exporter serializes, so the preview and the export are
 * the same drawing rather than two implementations that can drift.
 *
 * Rectangles and ellipses are SVG here too: they used to be CSS `background` +
 * `border`, which gave them a different stroke geometry from every other shape
 * and made dashes impossible on them.
 */
export function ShapeSvg({ layer }: { layer: ShapeLayer }) {
  const paint = resolveShapePaint(layer);
  if (paint.primitives.length === 0) return null;

  const gradientId = paint.fill.kind === "gradient" ? `shape-grad-${layer.id}` : null;
  const fill =
    paint.fill.kind === "none"
      ? "none"
      : paint.fill.kind === "solid"
        ? paint.fill.color
        : `url(#${gradientId})`;

  return (
    <svg
      width={layer.width}
      height={layer.height}
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      className="h-full w-full"
    >
      {gradientId && paint.fill.kind === "gradient" ? (
        <defs>
          <GradientDefs id={gradientId} spec={paint.fill.spec} width={layer.width} height={layer.height} />
        </defs>
      ) : null}
      {paint.primitives.map((primitive, index) => (
        <ShapePrimitive key={index} primitive={primitive} fill={fill} stroke={paint.stroke} />
      ))}
    </svg>
  );
}

/** One geometry primitive + the shared paint. */
function ShapePrimitive({
  primitive,
  fill,
  stroke,
}: {
  primitive: SvgPrimitive;
  fill: string;
  stroke: ResolvedStroke;
}) {
  // No stroke requested → emit NO stroke attributes at all (the SVG default is
  // `stroke: none`), so a fill-only shape renders exactly as it always did.
  const paint = stroke.visible ? { fill, ...strokeAttrs(stroke) } : { fill };
  switch (primitive.tag) {
    case "rect":
      return <rect {...primitive.attrs} {...paint} />;
    case "ellipse":
      return <ellipse {...primitive.attrs} {...paint} />;
    case "polygon":
      return <polygon {...primitive.attrs} {...paint} />;
    case "line":
      // A line has no interior: the stroke IS the ink.
      return <line {...primitive.attrs} {...paint} fill="none" />;
    case "path":
      return <path {...primitive.attrs} {...paint} />;
    default:
      return null;
  }
}

/* ------------------------------- visuals ------------------------------- */
/* Each visual fills its frame (100% × 100%) and never positions itself. */

function TextVisual({ layer }: { layer: TextLayer }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: alignToFlex[layer.align],
        color: layer.color ?? "inherit",
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        fontFamily: resolveFontStack(layer.fontFamily),
        fontStyle: layer.italic ? "italic" : undefined,
        lineHeight: layer.lineHeight ?? 1.25,
        letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
        textDecoration: layer.underline
          ? layer.strikethrough
            ? "underline line-through"
            : "underline"
          : layer.strikethrough
            ? "line-through"
            : undefined,
        overflow: "hidden",
        whiteSpace: "pre-wrap",
      }}
    >
      <span
        style={{
          width: "100%",
          textAlign: layer.align === "center" ? "center" : layer.align === "end" ? "end" : "start",
        }}
      >
        {layer.text}
      </span>
    </div>
  );
}

function ImageVisual({ layer }: { layer: ImageLayer }) {
  const srcRef = layer.src;
  const isPrivate = isPrivateAssetSrc(srcRef);
  // Both states are TAGGED with the src they belong to, so switching layers can
  // never display stale bytes and no state has to be reset synchronously.
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // PRIVATE artwork (personal templates, review-stage submissions) is fetched
  // with the session credential and handed to the DOM as a document-local blob
  // URL, so the token never appears in markup and the bytes are revoked when
  // this layer unmounts. Public media keeps using the same-origin proxy.
  useEffect(() => {
    if (!isPrivate || typeof srcRef !== "string") return;

    let cancelled = false;
    const controller = new AbortController();

    void fetchPrivateAssetUrl(srcRef, controller.signal).then((url) => {
      if (cancelled) {
        if (url) releasePrivateAssetUrl(srcRef);

        return;
      }
      if (url) {
        setLoaded({ src: srcRef, url });
      } else {
        setFailedSrc(srcRef);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
      releasePrivateAssetUrl(srcRef);
    };
  }, [isPrivate, srcRef]);

  // Same-origin proxy: rasterizable by html-to-image AND displayable publicly.
  // Mirroring is NOT applied here — the layer frame owns it for every kind.
  const src = isPrivate ? (loaded?.src === srcRef ? loaded.url : null) : mediaSrc(srcRef);
  const broken = failedSrc === srcRef;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: layer.radius,
        overflow: "hidden",
        background: "rgba(148,163,184,0.25)",
      }}
    >
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- rasterized by html-to-image via the same-origin proxy
        <img
          src={src}
          alt=""
          className="h-full w-full"
          style={{ objectFit: layer.objectFit }}
          onError={() => setFailedSrc(srcRef)}
        />
      ) : null}
    </div>
  );
}

/**
 * Same-origin QR. The project's own `/api/qr/{slug}` route is edge-cached and
 * emits the SVG, so this is a plain <img> — no authenticated client call and no
 * raw HTML injection. A draft (not-yet-approved) business has no public QR, so
 * the placeholder is the honest state rather than a broken image.
 */
const QrVisual = memo(function QrVisual({ payload, light }: {
  payload: string;
  light: string;
  /**
   * Owner-session asset revision (from `useQrAssets`). It is read while
   * rendering — `qrSrcFor` consults a MODULE-level registry, not props — so
   * React's default shallow prop comparison is the only thing that can tell
   * this memoized component that the registry changed underneath it. Without a
   * prop that actually moves, the layer keeps rendering the fallback
   * `/api/qr/{slug}` forever and a draft business shows an empty QR box.
   * Declared in the type only (never destructured) — it carries no value here.
   */
  qrRevision?: number;
}) {
  // WHICH source failed — not a boolean. A QR that failed before its
  // authenticated asset arrived (draft business) is retried automatically the
  // moment the source changes, with no state-adjusting effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Owner-session override first (a draft business has no public QR), then the
  // cached same-origin proxy. Both are OUR endpoint — never a third party.
  const src = qrSrcFor(payload);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: light,
        borderRadius: 10,
        padding: 4,
        border: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src && failedSrc !== src ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin SVG or owner-session data URL, inlined on export
        <img
          src={src}
          alt=""
          className="h-full w-full"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span style={{ fontSize: 10, color: "#94a3b8" }}>QR</span>
      )}
    </div>
  );
});

function BadgeVisual({ layer }: { layer: BadgeLayer }) {
  // Distinct glyph per badge style so the renderer reflects the real state.
  const glyph =
    layer.style === "promoted" ? (
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "1em", height: "1em" }} aria-hidden="true">
        <path d="M12 2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 16.8 6.2 19.9l1.1-6.5L2.6 8.8l6.5-.9L12 2z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} style={{ width: "1em", height: "1em" }} aria-hidden="true">
        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        background: layer.background ?? "#0ea5e9",
        color: layer.color ?? "#ffffff",
        borderRadius: 999,
        fontSize: Math.min(20, layer.height * 0.5),
        fontWeight: 700,
      }}
    >
      {glyph}
      <span>{layer.text}</span>
    </div>
  );
}

/** Every shape is a first-class SVG primitive now — one code path, no CSS twin. */
function ShapeVisual({ layer }: { layer: ShapeLayer }) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ShapeSvg layer={layer} />
    </div>
  );
}

/**
 * A path runs through the SHARED resolver (`resolveLayerPathD`) — the same
 * contract the SVG/PDF exporter and the public card use — so a ribbon, an arc
 * and an ornament render identically everywhere. The `rawD`/`bend` models are
 * treated as opaque geometry here; this layer must never recompute them.
 */
function PathVisual({ layer }: { layer: PathLayer }) {
  const stroke = resolveStroke(layer, "#0ea5e9");
  // Ornaments carry their fill as an editor gradient string; SVG `fill` cannot
  // take CSS text, so it becomes a real <defs> gradient in the layer's own box
  // (the same projection the shape visual uses).
  const gradient = isGradientCss(layer.fill) ? parseGradientCss(layer.fill) : null;
  const gradientId = gradient ? `path-grad-${layer.id}` : null;
  const fill = !layer.fill
    ? "none"
    : gradient
      ? `url(#${gradientId})`
      : svgColor(layer.fill);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* `overflow: visible` lets a live-previewed stroke/curve show while it is
          being dragged, before the layer box is re-derived on commit. */}
      <svg
        style={{ width: "100%", height: "100%", overflow: "visible" }}
        viewBox={`0 0 ${layer.width} ${layer.height}`}
      >
        {gradient && gradientId ? (
          <defs>
            <GradientDefs id={gradientId} spec={gradient} width={layer.width} height={layer.height} />
          </defs>
        ) : null}
        <path
          d={resolveLayerPathD(layer)}
          fill={fill}
          fillRule={layer.fillRule ?? undefined}
          {...strokeAttrs(stroke)}
        />
      </svg>
    </div>
  );
}

/** Per-layer visual dispatch. Unknown kinds render nothing (forward-compatible). */
export function LayerVisual({ layer, qrRevision }: { layer: CardLayer; qrRevision?: number }) {
  switch (layer.kind) {
    case "text":
      return <TextVisual layer={layer} />;
    case "image":
      return <ImageVisual layer={layer} />;
    case "qr":
      return (
        <QrVisual
          payload={(layer as QrLayer).payload}
          light={(layer as QrLayer).light}
          qrRevision={qrRevision}
        />
      );
    case "badge":
      return <BadgeVisual layer={layer} />;
    case "shape":
      return <ShapeVisual layer={layer} />;
    case "path":
      return <PathVisual layer={layer} />;
    default:
      return null;
  }
}

/**
 * LIVE-PAINT REGION FILLS (§10).
 *
 * Region paint is attached to FACES, not to the paths that bound them, so it
 * gets its own SVG pass: one `<path>` per painted face, drawn UNDER the layer
 * stack (zIndex 0) so the boundary strokes the user drew stay visible on top.
 *
 * Nothing here is layer state — a face has no id in `doc.layers` and cannot be
 * selected, moved or deleted by accident. Removing the paint removes the whole
 * pass, and every pre-region document renders exactly as it did before.
 */
function RegionPaintVisual({ doc }: { doc: CardDocument }) {
  const painted = paintedRegions(doc);
  if (painted.length === 0) return null;
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
      viewBox={`0 0 ${doc.artboard.width} ${doc.artboard.height}`}
    >
      <defs>
        {painted.map(({ face, style }) => {
          const paint = regionStylePaint(style);
          if (!paint.gradient) return null;
          return (
            <GradientDefs
              key={`region-grad-${face.id}`}
              id={`region-grad-${face.id}`}
              spec={paint.gradient}
              width={doc.artboard.width}
              height={doc.artboard.height}
            />
          );
        })}
      </defs>
      {painted.map(({ face, style }) => {
        const paint = regionStylePaint(style);
        return (
          <path
            key={face.id}
            d={regionFacePathD(face)}
            fill={paint.gradient ? `url(#region-grad-${face.id})` : svgColor(paint.fill)}
            fillRule={regionFillRule(doc)}
            opacity={style.opacity ?? 1}
          />
        );
      })}
    </svg>
  );
}

/**
 * The shared layer projection: frame + visual in one place. Every consumer of
 * the document (stage, export, public card) renders layers through this.
 */
export function LayerBox({
  layer,
  z,
  qrRevision,
}: {
  layer: CardLayer;
  z: number;
  qrRevision?: number;
}) {
  return (
    <div style={layerStyle(layer, z)}>
      <LayerVisual layer={layer} qrRevision={qrRevision} />
    </div>
  );
}

/**
 * The whole artboard visual. `scale` fits the 1050×600 design into the
 * container. Document order IS the z-order (`layerZ`).
 */
export function LayeredCard({
  doc,
  scale = 1,
  qrRevision,
}: {
  doc: CardDocument;
  scale?: number;
  qrRevision?: number;
}) {
  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-black/10 shadow-xl select-none"
      style={{
        width: doc.artboard.width,
        height: doc.artboard.height,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        background: doc.background,
      }}
    >
      <RegionPaintVisual doc={doc} />
      {doc.layers.map((layer, index) => (
        <LayerBox key={layer.id} layer={layer} z={layerZ(index)} qrRevision={qrRevision} />
      ))}
    </div>
  );
}

export default LayeredCard;
