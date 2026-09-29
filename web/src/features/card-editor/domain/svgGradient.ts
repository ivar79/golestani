/**
 * SVG paint helpers — normalize CSS colors and turn the editor's OWN gradient
 * strings into native SVG `<defs>` geometry.
 *
 * WHY A LOCAL PARSER (not a CSS library): the editor emits gradients in exactly
 * one grammar — `domain/gradient.ts` writes
 *   `linear-gradient(<deg>, <color> <offset>%, …)`
 *   `radial-gradient(circle at center, <color> <offset>%, …)`
 * and the server whitelist accepts only that grammar. Parsing a bounded,
 * self-owned format is a small pure function; a general CSS parser would be a
 * new dependency and a much larger trust surface.
 *
 * SVG 1.1 has no 8-digit hex, so `#rrggbbaa` (which the gradient model can
 * produce) is expanded to `rgba()` here — one place, used by both the React
 * projection and the exporter.
 *
 * Pure: no DOM, no React, no network.
 */

export type SvgGradientStop = { offset: number; color: string };
export type SvgGradientSpec = { type: "linear" | "radial"; angle: number; stops: SvgGradientStop[] };

export type SvgGradientBox = { x1: number; y1: number; x2: number; y2: number };

const HEX8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/;
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

/** Trim float noise so serialized markup is deterministic. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Any editor color → a token every SVG consumer understands. */
export function svgColor(value: string): string {
  const trimmed = value.trim();
  const eight = HEX8.exec(trimmed);
  if (eight) {
    const [, rgb, alpha] = eight;
    const a = Math.round((parseInt(alpha, 16) / 255) * 1000) / 1000;
    return `rgba(${parseInt(rgb.slice(0, 2), 16)}, ${parseInt(rgb.slice(2, 4), 16)}, ${parseInt(rgb.slice(4, 6), 16)}, ${a})`;
  }
  const three = HEX3.exec(trimmed);
  if (three) {
    const short = three[1];
    return `#${short.split("").map((c) => c + c).join("")}`;
  }
  return trimmed;
}

export function isGradientCss(value: string | null | undefined): boolean {
  return typeof value === "string" && /^(linear|radial)-gradient\(/i.test(value.trim());
}

/** Split on TOP-LEVEL commas only — `rgba(1, 2, 3, .5)` stops keep their own. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** Parse a gradient string produced by `domain/gradient.ts`. Null = not one. */
export function parseGradientCss(value: string | null | undefined): SvgGradientSpec | null {
  if (!isGradientCss(value)) return null;
  const css = String(value).trim();
  const type: "linear" | "radial" = /^linear/i.test(css) ? "linear" : "radial";
  const open = css.indexOf("(");
  const close = css.lastIndexOf(")");
  if (open < 0 || close <= open) return null;

  const tokens = splitTopLevel(css.slice(open + 1, close));
  let angle = 135;
  const stops: SvgGradientStop[] = [];

  for (const token of tokens) {
    if (stops.length === 0) {
      const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/.exec(token);
      if (angleMatch && type === "linear") {
        angle = Number(angleMatch[1]);
        continue;
      }
      // Radial direction/shape token ("circle at center", "closest-side", …).
      if (type === "radial" && /^(circle|ellipse|at\b|closest-side|farthest-corner|closest-corner|farthest-side|center)/i.test(token)) {
        continue;
      }
    }
    const stopMatch = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(token);
    if (stopMatch) {
      stops.push({ color: svgColor(stopMatch[1].trim()), offset: Number(stopMatch[2]) });
    } else {
      stops.push({ color: svgColor(token), offset: stops.length === 0 ? 0 : 100 });
    }
  }

  if (stops.length < 2) return null;
  return { type, angle, stops };
}

/**
 * The CSS gradient line projected into the shape's own box.
 *
 * CSS angles run clockwise from "to top", so the direction unit vector is
 * `(sin θ, -cos θ)`. The line length is chosen the way CSS does it — the
 * projection of the box onto that direction — so an exported gradient matches
 * the on-screen one instead of approximating it.
 */
export function gradientLine(spec: SvgGradientSpec, width: number, height: number): SvgGradientBox {
  const radians = ((spec.angle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2 || 1;
  return {
    x1: n(cx - dx * half),
    y1: n(cy - dy * half),
    x2: n(cx + dx * half),
    y2: n(cy + dy * half),
  };
}

/** Radius of a `circle at center` radial gradient (farthest corner, per CSS). */
export function gradientRadius(width: number, height: number): number {
  return n(Math.hypot(width, height) / 2);
}

/** True when a color token needs no further processing. */
export function isPlainColor(value: string): boolean {
  return HEX6.test(value.trim()) || HEX3.test(value.trim()) || /^rgba?\(/i.test(value.trim());
}
