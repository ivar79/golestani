/**
 * InKart Color Model — the project-owned color representation.
 *
 * ARCHITECTURE CONTRACT: react-colorful is ONLY an input/UI layer. It never
 * becomes the source of truth: this module owns parsing, storage format and
 * serialization. Everything the editor persists is a plain CSS hex string
 * (#rgb / #rrggbb / #rrggbbaa) — exactly what CardDesignValidator (server)
 * accepts in its cleanColor() whitelist. The library's internal hsv state
 * never leaks into the document.
 *
 * Pure functions, no DOM, no React — fully unit-testable.
 *
 * Storage format (the InKart document contract):
 *   "#rrggbb"       opaque color
 *   "#rrggbbaa"     color with alpha (a = 00..ff)
 *   "#rgb"          short opaque hex (normalized on edit)
 */

/** The internal working model — straight 8-bit channels + alpha 0..1. */
export type Rgba = { r: number; g: number; b: number; a: number };

export type Hsl = { h: number; s: number; l: number }; // h 0..360, s/l 0..100
export type Hsv = { h: number; s: number; v: number }; // h 0..360, s/v 0..100

export type ColorFormat = "hex" | "rgb" | "hsl" | "hsv";

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const round2 = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const NAMED_COLORS: Record<string, string> = {
  transparent: "#00000000",
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
};

/**
 * Parse anything the editor/UI can produce into Rgba.
 * Accepts: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba() functions,
 * hsl()/hsla() functions, a few named colors, and an empty string.
 * Returns null for anything else (callers decide the fallback).
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();

  if (value === "") return null;

  if (NAMED_COLORS[value]) return parseColor(NAMED_COLORS[value]);

  // ---- hex ----------------------------------------------------------
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split("").map((ch) => parseInt(ch + ch, 16));
      if ([r, g, b, ...(hex.length === 4 ? [a] : [])].some(Number.isNaN)) return null;
      return { r, g, b, a: hex.length === 4 ? round2(a / 255) : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { r, g, b, a: round2(a / 255) };
    }
    return null;
  }

  // ---- rgb()/rgba() --------------------------------------------------
  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(value);
  if (rgbMatch) {
    const r = clamp(Math.round(parseFloat(rgbMatch[1])), 0, 255);
    const g = clamp(Math.round(parseFloat(rgbMatch[2])), 0, 255);
    const b = clamp(Math.round(parseFloat(rgbMatch[3])), 0, 255);
    const a = rgbMatch[4] !== undefined ? clamp(parseFloat(rgbMatch[4]), 0, 1) : 1;
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return { r, g, b, a: round2(a) };
  }

  // ---- hsl()/hsla() --------------------------------------------------
  const hslMatch = /^hsla?\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(value);
  if (hslMatch) {
    const h = clamp(parseFloat(hslMatch[1]), 0, 360);
    const s = clamp(parseFloat(hslMatch[2]), 0, 100);
    const l = clamp(parseFloat(hslMatch[3]), 0, 100);
    const a = hslMatch[4] !== undefined ? clamp(parseFloat(hslMatch[4]), 0, 1) : 1;
    if ([h, s, l, a].some(Number.isNaN)) return null;
    return hslToRgb({ h, s, l, a });
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Formatting (the storage format is ALWAYS hex)                       */
/* ------------------------------------------------------------------ */

const toHex2 = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");

/** Canonical document format: #rrggbb (opaque) or #rrggbbaa (alpha < 1). */
export function formatHex(color: Rgba): string {
  const base = `#${toHex2(color.r)}${toHex2(color.g)}${toHex2(color.b)}`;
  return color.a >= 1 ? base : `${base}${toHex2(color.a * 255)}`;
}

/** Short hex when possible (#abc) — used by compact swatches. */
export function formatHexCompact(color: Rgba): string {
  const full = formatHex(color);
  const opaque = full.slice(1);
  if (opaque.length === 6 && opaque[0] === opaque[1] && opaque[2] === opaque[3] && opaque[4] === opaque[5]) {
    return `#${opaque[0]}${opaque[2]}${opaque[4]}`;
  }
  return full;
}

/** rgb(r, g, b) / rgba(r, g, b, a) — UI display string. */
export function formatRgb(color: Rgba): string {
  const { r, g, b, a } = color;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** hsl(h, s%, l%) / hsla(...) — UI display string. */
export function formatHsl(color: Rgba): string {
  const { h, s, l, a } = rgbToHsl(color);
  return a >= 1 ? `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)` : `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${round2(a)})`;
}

/** hsv(h, s%, v%) / hsva(...) — UI display string (react-colorful's native space). */
export function formatHsv(color: Rgba): string {
  const { h, s, v, a } = rgbToHsv(color);
  return a >= 1 ? `hsv(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(v)}%)` : `hsva(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(v)}%, ${round2(a)})`;
}

/* ------------------------------------------------------------------ */
/* Conversions                                                         */
/* ------------------------------------------------------------------ */

export function rgbToHsl(color: Rgba): Hsl & { a: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
    }
  }
  return { h: round2(h), s: round2(s * 100), l: round2(l * 100), a: color.a };
}

export function hslToRgb(hsl: Hsl & { a: number }): Rgba {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: hsl.a,
  };
}

export function rgbToHsv(color: Rgba): Hsv & { a: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
    }
  }
  return { h: round2(h), s: round2(max === 0 ? 0 : (d / max) * 100), v: round2(max * 100), a: color.a };
}

export function hsvToRgb(hsv: Hsv & { a: number }): Rgba {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: hsv.a,
  };
}

/* ------------------------------------------------------------------ */
/* Text inputs (typed HEX / RGB / HSL / HSV editing)                   */
/* ------------------------------------------------------------------ */

/**
 * Parse a text field value in the given format. Lenient: accepts with or
 * without units/symbols. Returns null when unparseable (UI keeps previous).
 */
export function parseColorText(text: string, format: ColorFormat): Rgba | null {
  const value = text.trim();
  if (value === "") return null;

  if (format === "hex") {
    const withHash = value.startsWith("#") ? value : `#${value}`;
    return parseColor(withHash);
  }

  if (format === "rgb") {
    const nums = value.match(/[0-9.]+/g);
    if (!nums || nums.length < 3) return null;
    const [r, g, b] = nums.slice(0, 3).map(Number);
    const a = nums[3] !== undefined ? Number(nums[3]) : 1;
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a: clamp(a, 0, 1) };
  }

  if (format === "hsl") {
    const nums = value.match(/[0-9.]+/g);
    if (!nums || nums.length < 3) return null;
    const [h, s, l] = nums.slice(0, 3).map(Number);
    const a = nums[3] !== undefined ? Number(nums[3]) : 1;
    if ([h, s, l, a].some(Number.isNaN)) return null;
    return hslToRgb({ h: clamp(h, 0, 360), s: clamp(s, 0, 100), l: clamp(l, 0, 100), a: clamp(a, 0, 1) });
  }

  // hsv
  const nums = value.match(/[0-9.]+/g);
  if (!nums || nums.length < 3) return null;
  const [h, s, v] = nums.slice(0, 3).map(Number);
  const a = nums[3] !== undefined ? Number(nums[3]) : 1;
  if ([h, s, v, a].some(Number.isNaN)) return null;
  return hsvToRgb({ h: clamp(h, 0, 360), s: clamp(s, 0, 100), v: clamp(v, 0, 100), a: clamp(a, 0, 1) });
}

/** Round-trip guard for tests and the picker adapter. */
export function roundTrips(value: string): boolean {
  const parsed = parseColor(value);
  if (parsed === null) return false;
  const reParsed = parseColor(formatHex(parsed));
  return reParsed !== null && formatHex(reParsed) === formatHex(parsed);
}
