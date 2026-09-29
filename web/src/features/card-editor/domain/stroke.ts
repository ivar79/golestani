/**
 * Stroke domain — the ONE place where a layer's stroke fields become concrete
 * SVG values.
 *
 * WHY THIS EXISTS: the React projection and the SVG/PDF serializer must paint a
 * stroke identically. Expressing the rules (dash rhythm, cap/join defaults, the
 * dotted-cap rule) as pure functions means there is exactly one implementation
 * to test, and the export can never drift from the preview.
 *
 * Pure: no DOM, no React, no network.
 */

import type { StrokeLineCap, StrokeLineJoin, StrokeStyleKind } from "./document";

/** The slider range the product asks for (design px on the 1050×600 artboard). */
export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 50;

export const STROKE_STYLE_LABELS: Record<StrokeStyleKind, string> = {
  solid: "ممتد",
  dashed: "خط‌چین",
  dotted: "نقطه‌ای",
};

export const STROKE_LINE_CAP_LABELS: Record<StrokeLineCap, string> = {
  butt: "صاف",
  round: "گرد",
  square: "مربعی",
};

export const STROKE_LINE_JOIN_LABELS: Record<StrokeLineJoin, string> = {
  miter: "تیز",
  round: "گرد",
  bevel: "پخ",
};

/** Structural view of any layer that carries a stroke (shape or path). */
export type StrokeSource = {
  stroke?: string | null;
  strokeWidth?: number;
  strokeStyle?: StrokeStyleKind;
  strokeLinecap?: StrokeLineCap;
  strokeLinejoin?: StrokeLineJoin;
  strokeOpacity?: number;
};

export type ResolvedStroke = {
  color: string;
  /** Design px. May be 0 (no stroke). */
  width: number;
  /** SVG `stroke-dasharray`, or undefined for a solid line. */
  dasharray: string | undefined;
  linecap: StrokeLineCap;
  linejoin: StrokeLineJoin;
  /** 0..1 — stroke-only alpha. */
  opacity: number;
  /** True when the stroke would actually paint something. */
  visible: boolean;
};

/** Trim float noise so serialized output is deterministic (test-friendly). */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Clamp a user-supplied stroke width into the supported slider range. */
export function clampStrokeWidth(width: number): number {
  if (!Number.isFinite(width)) return STROKE_WIDTH_MIN;
  return Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, Math.round(width)));
}

/**
 * Dash pattern for a stroke style, scaled by the stroke width so a thicker line
 * keeps the same visual rhythm (Figma behaves this way).
 *
 * `dotted` uses a sub-pixel dash on purpose: combined with round caps it renders
 * as a row of dots — the only way SVG can express a true dotted stroke. That is
 * also why `resolveStroke` forces round caps for dotted strokes; with `butt`
 * caps a 0.01px dash would paint nothing and the control would look broken.
 */
export function dashArrayFor(style: StrokeStyleKind | undefined, width: number): string | undefined {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  switch (style) {
    case "dashed":
      return `${fmt(w * 3)} ${fmt(w * 2)}`;
    case "dotted":
      return `${fmt(w * 0.01)} ${fmt(w * 2)}`;
    default:
      return undefined;
  }
}

/**
 * Turn any stroke-bearing layer into concrete SVG values.
 *
 * Defaults preserve the pre-upgrade look exactly: `round` cap + `round` join +
 * full opacity, and `fallbackColor` is the tone the old renderer used.
 */
export function resolveStroke(source: StrokeSource, fallbackColor: string): ResolvedStroke {
  const rawWidth = Number(source.strokeWidth ?? 0);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 0;
  const style = source.strokeStyle ?? "solid";

  return {
    color: source.stroke ?? fallbackColor,
    width,
    dasharray: dashArrayFor(style, width),
    linecap: style === "dotted" ? "round" : source.strokeLinecap ?? "round",
    linejoin: source.strokeLinejoin ?? "round",
    opacity: clamp01(source.strokeOpacity ?? 1),
    visible: width > 0,
  };
}
