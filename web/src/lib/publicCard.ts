/**
 * Public card contract (Phase 4 layered editor).
 *
 * One narrow read: `GET /api/public/businesses/{slug}/card` returns only what a
 * renderer needs. Everything about resolution and fallback lives in the pure
 * `resolveCardRender`, so the decision "design or template?" is testable without
 * a browser and cannot silently drift between surfaces.
 *
 * Fallback chain (never throws, never renders a broken card):
 *   valid design_json  → layered document projection
 *   null design_json   → legacy template renderer (pre-editor cards)
 *   malformed document → legacy template renderer (+ reason for the caller to log)
 */

import type { CardDocument } from "@/features/card-editor/domain/document";
import { parseDocument } from "@/features/card-editor/domain/factory";

export type PublicCardScalars = {
  template: string;
  theme: string;
  font_size: string;
  font_family: string;
  design_json: CardDocument | null;
};

export const CARD_TEMPLATES = ["classic", "midnight", "emerald", "local", "creative"] as const;
export const CARD_THEMES = ["navy", "emerald", "warm"] as const;
export const CARD_FONT_SIZES = ["small", "medium", "large"] as const;
export const CARD_FONT_FAMILIES = ["vazir", "sans", "serif"] as const;

export type CardTemplateKey = (typeof CARD_TEMPLATES)[number];
export type CardThemeKey = (typeof CARD_THEMES)[number];
export type CardFontSizeKey = (typeof CARD_FONT_SIZES)[number];
export type CardFontFamilyKey = (typeof CARD_FONT_FAMILIES)[number];

export type CardRenderPlan =
  | { mode: "design"; design: CardDocument }
  | {
      mode: "legacy";
      reason: "no-design" | "invalid-design";
      template: CardTemplateKey;
      theme: CardThemeKey;
      fontSize: CardFontSizeKey;
      fontFamily: CardFontFamilyKey;
    };

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Decide how to render a published card. Pure — no fetching, no DOM.
 * Unknown scalar values fall back to the same defaults the owner contract uses,
 * so a hand-edited row can never produce an unrenderable template key.
 */
export function resolveCardRender(card: PublicCardScalars | null | undefined): CardRenderPlan {
  const template = pick(card?.template, CARD_TEMPLATES, "classic");
  const theme = pick(card?.theme, CARD_THEMES, "navy");
  const fontSize = pick(card?.font_size, CARD_FONT_SIZES, "medium");
  const fontFamily = pick(card?.font_family, CARD_FONT_FAMILIES, "sans");

  if (!card || card.design_json === null || card.design_json === undefined) {
    return { mode: "legacy", reason: "no-design", template, theme, fontSize, fontFamily };
  }

  // Reuse the project's single document guard: version + shape validation.
  const design = parseDocument(JSON.stringify(card.design_json));
  if (!design) {
    return { mode: "legacy", reason: "invalid-design", template, theme, fontSize, fontFamily };
  }

  return { mode: "design", design };
}

/**
 * Server-side fetch for the card block. Returns null when unavailable — the
 * page then renders the legacy template (which needs no design document), so a
 * card API hiccup can never blank a public profile.
 */
export async function fetchPublicCard(slug: string): Promise<PublicCardScalars | null> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  if (!base) return null;

  try {
    const response = await fetch(
      `${base}/public/businesses/${encodeURIComponent(slug)}/card`,
      { next: { revalidate: 300 } },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as PublicCardScalars;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}
