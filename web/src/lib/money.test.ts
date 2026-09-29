import { describe, expect, it } from "vitest";
import { RIAL_PER_TOMAN, formatToman, tomanFromRial, tomanToRial } from "@/lib/money";

/**
 * MONEY UNIT CONTRACT — the ×10 regression lock (client side).
 * The professional plan displays «۲۴۹٬۰۰۰ تومان» while ZarinPal is charged
 * 2,490,000 RIAL. No zero may be lost or added anywhere.
 */
describe("money unit conversions", () => {
  it("keeps the exact ×10 factor", () => {
    expect(RIAL_PER_TOMAN).toBe(10);
  });

  it("converts the professional plan price 249,000 toman → 2,490,000 rial", () => {
    expect(tomanToRial(249000)).toBe(2490000);
  });

  it("converts back 2,490,000 rial → 249,000 toman (payment result display)", () => {
    expect(tomanFromRial(2490000)).toBe(249000);
  });

  it("is a lossless round trip across a range of plan prices", () => {
    for (const toman of [0, 1000, 99000, 249000, 500000, 12345678]) {
      expect(tomanFromRial(tomanToRial(toman))).toBe(toman);
    }
  });

  it("never shifts a digit (the classic lost-zero bug)", () => {
    // The bug this module exists to prevent: charging 24,900 or 2,490,000,000.
    expect(tomanToRial(249000)).not.toBe(24900);
    expect(tomanToRial(249000)).not.toBe(24900000);
    expect(tomanToRial(249000)).not.toBe(2490000000);
  });

  it("formats the display string with the toman unit", () => {
    expect(formatToman(249000)).toBe("۲۴۹٬۰۰۰ تومان");
    expect(formatToman(0)).toBe("۰ تومان");
  });
});
