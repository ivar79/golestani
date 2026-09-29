import { describe, expect, it } from "vitest";
import {
  formatHex,
  formatHexCompact,
  formatHsl,
  formatHsv,
  formatRgb,
  hslToRgb,
  hsvToRgb,
  parseColor,
  parseColorText,
  rgbToHsl,
  rgbToHsv,
  roundTrips,
} from "../color";

describe("parseColor", () => {
  it("parses every supported hex shape", () => {
    expect(parseColor("#0ea5e9")).toEqual({ r: 14, g: 165, b: 233, a: 1 });
    expect(parseColor("#0e5")).toEqual({ r: 0, g: 238, b: 85, a: 1 });
    expect(parseColor("#0EA5E9")).toEqual({ r: 14, g: 165, b: 233, a: 1 });
    expect(parseColor("#0ea5e980")?.a).toBeCloseTo(0.5, 1);
  });

  it("parses rgb()/rgba()/hsl()/hsla() functions", () => {
    expect(parseColor("rgb(14, 165, 233)")).toEqual({ r: 14, g: 165, b: 233, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0.5)")?.a).toBe(0.5);
    const fromHsl = parseColor("hsl(200, 89%, 49%)");
    expect(fromHsl).not.toBeNull();
    if (fromHsl) {
      // HSL is a different color space: integer-rounded h/s/l cannot
      // reproduce an exact 8-bit triple (true value is hsl(198.6, 88.7%, 48.4%)),
      // so compare with the rounding slack HSL actually carries.
      expect(Math.abs(fromHsl.r - 14)).toBeLessThanOrEqual(5);
      expect(Math.abs(fromHsl.g - 165)).toBeLessThanOrEqual(5);
      expect(Math.abs(fromHsl.b - 233)).toBeLessThanOrEqual(5);
    }
  });

  it("returns null for garbage and empty input", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor(null)).toBeNull();
    expect(parseColor("url(javascript:alert(1))")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("expression()")).toBeNull();
  });
});

describe("formatting", () => {
  it("stores opaque colors as #rrggbb and alpha colors as #rrggbbaa", () => {
    expect(formatHex({ r: 14, g: 165, b: 233, a: 1 })).toBe("#0ea5e9");
    expect(formatHex({ r: 14, g: 165, b: 233, a: 0.5 })).toBe("#0ea5e980");
    expect(formatHex({ r: 255, g: 255, b: 255, a: 1 })).toBe("#ffffff");
  });

  it("compacts symmetrical hexes", () => {
    expect(formatHexCompact({ r: 170, g: 187, b: 204, a: 1 })).toBe("#abc");
    expect(formatHexCompact({ r: 14, g: 165, b: 233, a: 1 })).toBe("#0ea5e9");
  });

  it("formats UI display strings in every color space", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(formatRgb(white)).toBe("rgb(255, 255, 255)");
    expect(formatHsl(white)).toBe("hsl(0, 0%, 100%)");
    expect(formatHsv(white)).toBe("hsv(0, 0%, 100%)");
    expect(formatRgb({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("rgba(0, 0, 0, 0.5)");
  });
});

describe("conversions", () => {
  it("rgb → hsl → rgb round-trips", () => {
    const source = { r: 14, g: 165, b: 233, a: 1 };
    const hsl = rgbToHsl(source);
    const back = hslToRgb({ ...hsl, a: 1 });
    expect(Math.abs(back.r - source.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.g - source.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.b - source.b)).toBeLessThanOrEqual(2);
  });

  it("rgb → hsv → rgb round-trips", () => {
    const source = { r: 217, g: 119, b: 6, a: 1 };
    const hsv = rgbToHsv(source);
    const back = hsvToRgb({ ...hsv, a: 1 });
    expect(Math.abs(back.r - source.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.g - source.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.b - source.b)).toBeLessThanOrEqual(2);
  });

  it("black stays black in every space", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(rgbToHsv(black)).toMatchObject({ s: 0, v: 0 });
    expect(rgbToHsl(black)).toMatchObject({ s: 0, l: 0 });
    expect(hsvToRgb({ h: 180, s: 80, v: 0, a: 1 })).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe("parseColorText", () => {
  it("accepts typed values in every format", () => {
    expect(parseColorText("0ea5e9", "hex")).toEqual({ r: 14, g: 165, b: 233, a: 1 });
    expect(parseColorText("14, 165, 233", "rgb")).toEqual({ r: 14, g: 165, b: 233, a: 1 });
    expect(parseColorText("200 89% 49%", "hsl")?.b).toBeGreaterThan(200);
    expect(parseColorText("200, 94, 91", "hsv")?.g).toBeGreaterThan(100);
  });

  it("rejects nonsense", () => {
    expect(parseColorText("abc", "rgb")).toBeNull();
    expect(parseColorText("###", "hex")).toBeNull();
    expect(parseColorText("", "hsv")).toBeNull();
  });
});

describe("round-trip guard (server contract)", () => {
  it("every stored color survives hex serialization", () => {
    expect(roundTrips("#0ea5e9")).toBe(true);
    expect(roundTrips("#0e5")).toBe(true);
    expect(roundTrips("#0ea5e980")).toBe(true);
    expect(roundTrips("rgba(255, 0, 0, 0.25)")).toBe(true);
    expect(roundTrips("hsl(120, 50%, 50%)")).toBe(true);
  });

  it("the output hex always matches the server whitelist shape", () => {
    // CardDesignValidator::cleanColor accepts /^#[0-9a-fA-F]{3,8}$/ only.
    const candidates = ["#0ea5e9", "#0e5", "#0ea5e980", "#ffffffff"];
    for (const value of candidates) {
      const parsed = parseColor(value);
      if (parsed) {
        expect(formatHex(parsed)).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    }
  });
});
