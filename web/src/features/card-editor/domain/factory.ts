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
import { ARTBOARD, type BadgeLayer, type CardDocument, type ImageLayer, type QrLayer, type ShapeLayer, type TextLayer } from "./document";

export type TemplateKey = "classic" | "midnight" | "emerald" | "local" | "creative";

const THEME_PALETTES: Record<string, { bg: string; text: string; accent: string; muted: string }> = {
  navy: { bg: "#f6f8fb", text: "#0b1c33", accent: "#0ea5e9", muted: "#64748b" },
  emerald: { bg: "#f4faf7", text: "#052e22", accent: "#10b981", muted: "#4b6359" },
  warm: { bg: "#fbf7f1", text: "#3a1c05", accent: "#d97706", muted: "#8a6d4f" },
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
      ? palette.text
      : options.template === "emerald"
        ? "#0a1a2e"
        : "#081528"
    : palette.bg;
  const fg = dark ? "#ffffff" : palette.text;
  const sub = dark ? "rgba(255,255,255,0.75)" : palette.muted;

  if (dark) {
    layers.push({
      id: uid("shape"), kind: "shape", shape: "rect",
      x: 0, y: 0, width: ARTBOARD.width, height: 220, angle: 0, opacity: 0.9,
      locked: false, hidden: false, color: palette.accent, background: palette.accent, radius: 0,
    } satisfies ShapeLayer);
  }

  layers.push({
    id: uid("text"), kind: "text",
    x: 64, y: 88, width: 620, height: 90, angle: 0, opacity: 1,
    locked: false, hidden: false,     color: fg, background: null,
    text: business.name || "نام کسب‌وکار",
    fontSize: 56, fontWeight: 800, align: "start", fontFamily: options.fontFamily,
  } satisfies TextLayer);

  layers.push({
    id: uid("text"), kind: "text",
    x: 64, y: 196, width: 620, height: 48, angle: 0, opacity: 1,
    locked: false, hidden: false,     color: dark ? palette.accent : palette.accent, background: null,
    text: business.category || "کسب‌وکار حرفه‌ای",
    fontSize: 28, fontWeight: 600, align: "start", fontFamily: options.fontFamily,
  } satisfies TextLayer);

  layers.push({
    id: uid("text"), kind: "text",
    x: 64, y: 410, width: 620, height: 48, angle: 0, opacity: 1,
    locked: false, hidden: false,     color: sub, background: null,
    text: business.phone ? `☎ ${business.phone}` : "",
    fontSize: 24, fontWeight: 500, align: "start", fontFamily: "sans",
  } satisfies TextLayer);

  if (addressText) {
    layers.push({
      id: uid("text"), kind: "text",
      x: 64, y: 470, width: 620, height: 48, angle: 0, opacity: 1,
      locked: false, hidden: false,       color: sub, background: null,
      text: addressText,
      fontSize: 20, fontWeight: 400, align: "start", fontFamily: options.fontFamily,
    } satisfies TextLayer);
  }

  if (instagram || telegram || website) {
    const handles = [instagram, telegram, website].filter(Boolean).join("  ·  ");
    layers.push({
      id: uid("text"), kind: "text",
      x: 64, y: 528, width: 620, height: 40, angle: 0, opacity: 1,
      locked: false, hidden: false,       color: sub, background: null,
      text: handles,
      fontSize: 18, fontWeight: 400, align: "start", fontFamily: "sans",
    } satisfies TextLayer);
  }

  if (business.logo) {
    layers.push({
      id: uid("image"), kind: "image",
      x: 850, y: 80, width: 136, height: 136, angle: 0, opacity: 1,
      locked: false, hidden: false,       color: null, background: null,
      src: business.logo, radius: 24, objectFit: "contain",
    } satisfies ImageLayer);
  }

  if (business.license_verified || business.verification_badge) {
    layers.push({
      id: uid("badge"), kind: "badge",
      x: 838, y: 236, width: 160, height: 40, angle: 0, opacity: 1,
      locked: false, hidden: false,       color: "#ffffff", background: palette.accent,
      style: "verified", text: "تأییدشده",
    } satisfies BadgeLayer);
  }

  if (business.is_promoted) {
    layers.push({
      id: uid("badge"), kind: "badge",
      x: 64, y: 32, width: 110, height: 36, angle: 0, opacity: 1,
      locked: false, hidden: false,       color: "#3a1c05", background: "#fbbf24",
      style: "promoted", text: "ویژه",
    } satisfies BadgeLayer);
  }

  layers.push({
    id: uid("qr"), kind: "qr",
    x: 856, y: 396, width: 130, height: 130, angle: 0, opacity: 1,
    locked: false, hidden: false,     color: null, background: null,
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
    return parsed;
  } catch {
    return null;
  }
}
