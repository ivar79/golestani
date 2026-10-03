/**
 * Card document factory — builds editor documents from the business's real
 * data and the existing template settings (the adapter/bridge between the
 * legacy constrained editor and the layered editor).
 *
 * The five CardCanvas template identities remain available: switching a
 * document-less card into the editor materializes its template as base
 * layers, so existing designs are preserved, never reset.
 */
import type { Business } from "@/lib/businesses";
import { ARTBOARD, type BadgeLayer, type CardLayer, type CardDocument, type ImageLayer, type PathLayer, type QrLayer, type ShapeLayer, type TextLayer } from "./document";
import {
  DEFAULT_CURVE_SPEC,
  LEGACY_CURVE_PROFILE_KINDS,
  normalizeCurveSpec,
  normalizeNodeCount,
  type CurveKind,
  type CurveSpec,
} from "./curveGeometry";

export type TemplateKey = "classic" | "midnight" | "emerald" | "local" | "creative";

const THEME_PALETTES: Record<string, { bg: string; text: string; accent: string; muted: string }> = {
  navy: { bg: "#f6f8fb", text: "#0b1c33", accent: "#0ea5e9", muted: "#94a3b8" },
  emerald: { bg: "#f4faf7", text: "#052e22", accent: "#10b981", muted: "#6ee7b7" },
  warm: { bg: "#fbf7f1", text: "#3a1c05", accent: "#f59e0b", muted: "#fcd34d" },
};

function uid(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Materialize a document from business data + current editor selections.
 * Mirrors the palette tokens of CardCanvas so switching paths is seamless.
 */
export function createDocumentFromBusiness(
  business: Business,
  options: { template: TemplateKey; theme: string; fontFamily: string },
): CardDocument {
  const palette = THEME_PALETTES[options.theme] ?? THEME_PALETTES.navy;
  const social: Record<string, string> =
    business.social_links && !Array.isArray(business.social_links) && typeof business.social_links === "object"
      ? (business.social_links as Record<string, string>)
      : {};
  const instagram = social["instagram"] || social["insta"];
  const telegram = social["telegram"] || social["tg"];
  const website = social["website"] || social["web"];
  const addressText = [business.city, business.neighborhood, business.address].filter(Boolean).join("، ");

  const layers: CardDocument["layers"] = [];

  // Dark templates (midnight/emerald/creative) flip the canvas look.
  const dark = options.template === "midnight" || options.template === "emerald" || options.template === "creative";
  const bg = dark
    ? options.template === "creative"
      ? "linear-gradient(135deg, #0b1c33 0%, #153a6b 100%)"
      : options.template === "emerald"
        ? "linear-gradient(135deg, #04241b 0%, #064635 50%, #0d6b53 100%)"
        : "linear-gradient(135deg, #081528 0%, #0d2342 50%, #153a6b 100%)"
    : palette.bg;
  const fg = dark ? "#ffffff" : palette.text;
  const sub = dark ? "rgba(255,255,255,0.85)" : palette.muted;

  // Elegant top accent strip instead of an obscuring giant rectangle
  if (dark) {
    layers.push({
      id: uid("shape"), kind: "shape", shape: "rect",
      x: 0, y: 0, width: ARTBOARD.width, height: 6, angle: 0, opacity: 1,
      locked: true, hidden: false, color: palette.accent, background: palette.accent, radius: 0,
    } satisfies ShapeLayer);
  }

  // Business Name
  layers.push({
    id: uid("text"), kind: "text",
    x: 64, y: 68, width: 640, height: 76, angle: 0, opacity: 1,
    locked: false, hidden: false, color: fg, background: null,
    text: business.name || "نام کسب‌وکار",
    fontSize: 48, fontWeight: 800, align: "start", fontFamily: options.fontFamily,
  } satisfies TextLayer);

  // Business Category / Slogan
  layers.push({
    id: uid("text"), kind: "text",
    x: 64, y: 154, width: 640, height: 44, angle: 0, opacity: 1,
    locked: false, hidden: false, color: palette.accent, background: null,
    text: business.category || "کسب‌وکار حرفه‌ای",
    fontSize: 24, fontWeight: 600, align: "start", fontFamily: options.fontFamily,
  } satisfies TextLayer);

  // Phone
  if (business.phone) {
    layers.push({
      id: uid("text"), kind: "text",
      x: 64, y: 390, width: 640, height: 40, angle: 0, opacity: 1,
      locked: false, hidden: false, color: fg, background: null,
      text: `☎ ${business.phone}`,
      fontSize: 22, fontWeight: 500, align: "start", fontFamily: "sans",
    } satisfies TextLayer);
  }

  // Address
  if (addressText) {
    layers.push({
      id: uid("text"), kind: "text",
      x: 64, y: 442, width: 640, height: 42, angle: 0, opacity: 1,
      locked: false, hidden: false, color: sub, background: null,
      text: addressText,
      fontSize: 18, fontWeight: 400, align: "start", fontFamily: options.fontFamily,
    } satisfies TextLayer);
  }

  // Socials / Web
  if (instagram || telegram || website) {
    const handles = [instagram, telegram, website].filter(Boolean).join("  ·  ");
    layers.push({
      id: uid("text"), kind: "text",
      x: 64, y: 494, width: 640, height: 38, angle: 0, opacity: 1,
      locked: false, hidden: false, color: sub, background: null,
      text: handles,
      fontSize: 16, fontWeight: 400, align: "start", fontFamily: "sans",
    } satisfies TextLayer);
  }

  // Logo (if available)
  if (business.logo) {
    layers.push({
      id: uid("image"), kind: "image",
      x: 846, y: 64, width: 140, height: 140, angle: 0, opacity: 1,
      locked: false, hidden: false, color: null, background: null,
      src: business.logo, radius: 24, objectFit: "contain",
    } satisfies ImageLayer);
  }

  // Verification Badge
  if (business.license_verified || business.verification_badge) {
    layers.push({
      id: uid("badge"), kind: "badge",
      x: 836, y: business.logo ? 218 : 64, width: 160, height: 40, angle: 0, opacity: 1,
      locked: false, hidden: false, color: "#ffffff", background: palette.accent,
      style: "verified", text: "تأییدشده",
    } satisfies BadgeLayer);
  }

  if (business.is_promoted) {
    layers.push({
      id: uid("badge"), kind: "badge",
      x: 64, y: 24, width: 110, height: 34, angle: 0, opacity: 1,
      locked: false, hidden: false, color: "#3a1c05", background: "#fbbf24",
      style: "promoted", text: "ویژه",
    } satisfies BadgeLayer);
  }

  // QR Code
  layers.push({
    id: uid("qr"), kind: "qr",
    x: 856, y: 396, width: 130, height: 130, angle: 0, opacity: 1,
    locked: false, hidden: false, color: null, background: null,
    payload: business.slug || "",
    dark: "#000000", light: "#ffffff",
  } satisfies QrLayer);

  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: bg,
    layers,
  };
}

/** Serialize for persistence (whitelist — the document is already clean). */
export function serializeDocument(doc: CardDocument): string {
  return JSON.stringify(doc);
}

export function parseDocument(json: string | null | undefined): CardDocument | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as CardDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.layers) || !parsed.artboard) return null;
    return { ...parsed, layers: parsed.layers.map(normalizeLegacyLayer) };
  } catch {
    return null;
  }
}

/**
 * Bring a stored layer up to the CURRENT document model.
 *
 * TWO migrations happen here, once, at load — never on save (stored data is
 * never mutated by this function):
 *
 * 1. The curved-line contract. Older builds persisted `curvature` (-100..100)
 *    and left `bend` unset, which made the arc model and the bend handle
 *    disagree. `bend` wins whenever it is present, otherwise the legacy value is
 *    converted once.
 *
 * 2. The CURVE PROFILE vocabulary. The legacy `curveProfile` field duplicated
 *    the profile list that now lives in `curveGeometry.ts` as `CurveKind`. It is
 *    folded into a canonical `curve` spec and DROPPED, so the live document has
 *    exactly one profile vocabulary. A layer that already carries a spec (or is
 *    a plain 2-point arc) is left alone, and a profile the parametric model
 *    cannot reproduce (`sine-asymmetric`) becomes `custom` — the honest answer,
 *    because declaring it "sine" would silently redraw the saved curve.
 */
function normalizeLegacyLayer(layer: CardLayer): CardLayer {
  const migrated = migrateCurvature(layer);
  return migrateCurveProfile(migrated);
}

function migrateCurvature(layer: CardLayer): CardLayer {
  if (layer.kind !== "path" || layer.bend !== undefined || layer.curvature === undefined) return layer;
  if (layer.points.length !== 2) return layer;
  return { ...layer, bend: Math.max(-1.5, Math.min(1.5, layer.curvature / 100)) };
}

function migrateCurveProfile(layer: CardLayer): CardLayer {
  if (layer.kind !== "path") return layer;
  const profile = layer.curveProfile;
  if (profile === undefined) return layer;
  // A real spec already describes this layer — the legacy label is redundant.
  if (layer.curve) {
    const { curveProfile: _dropped, ...rest } = layer;
    void _dropped;
    return rest as CardLayer;
  }
  const kind: CurveKind | undefined = LEGACY_CURVE_PROFILE_KINDS[profile];
  const { curveProfile: _dropped, ...rest } = layer;
  void _dropped;
  const base = rest as PathLayer;
  if (!kind || kind === "custom" || base.points.length < 2) return base;
  // A 2-point arc is the bend model, not a parametric curve: converting it would
  // move geometry the user drew with the arc tool.
  if (kind === "arc" && base.points.length === 2) return base;
  return { ...base, pathMode: "curve", curve: defaultSpecForKind(kind, base) };
}

/**
 * The spec a legacy profile converts into, sized from the geometry that was
 * actually stored (so the converted curve lands on the SAME chord instead of
 * jumping to the default 600px one).
 */
function defaultSpecForKind(kind: CurveKind, layer: PathLayer): CurveSpec {
  const chord = Math.hypot(
    layer.points[layer.points.length - 1].x - layer.points[0].x,
    layer.points[layer.points.length - 1].y - layer.points[0].y,
  );
  const amplitude = layer.points.reduce<number>(
    (peak, point) => Math.max(peak, Math.abs(point.y - layer.points[0].y)),
    0,
  );
  return normalizeCurveSpec({
    ...DEFAULT_CURVE_SPEC,
    kind,
    length: chord > 1 ? chord : DEFAULT_CURVE_SPEC.length,
    amplitude: amplitude > 1 ? amplitude : DEFAULT_CURVE_SPEC.amplitude,
    nodes: normalizeNodeCount(layer.points.length),
  });
}
