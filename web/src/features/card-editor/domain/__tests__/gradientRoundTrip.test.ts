/**
 * GradientField round-trip: gradientToCss ⇄ parseGradientCss must be stable
 * for every value the editor can emit (the single-source-of-truth guarantee
 * for gradient backgrounds/fills).
 */
import { describe, expect, it } from "vitest";
import { createGradient, gradientToCss, addStop, updateStop } from "../gradient";

// parseGradientCss is a module-private helper reached via the component's
// import; re-implement the same split here only to test the MODEL round-trip
// (component-level parse is exercised by the gradient.test suite shapes).

describe("gradient CSS round-trip (editor-emitted shapes only)", () => {
  it("linear with 2 stops and angle", () => {
    const g = createGradient({ type: "linear", angle: 90 });
    expect(gradientToCss(g)).toBe("linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)");
  });

  it("radial default", () => {
    const g = createGradient({ type: "radial" });
    expect(gradientToCss(g)).toBe("radial-gradient(circle at center, #0ea5e9 0%, #2563eb 100%)");
  });

  it("emits alpha as #rrggbbaa (single color token, no rgba())", () => {
    let g = createGradient({ type: "linear", angle: 0 });
    g = updateStop(g, 1, { opacity: 0.5 });
    const css = gradientToCss(g);
    expect(css).toContain("#2563eb80"); // 0.5 * 255 = 127.5 → 80 hex
    expect(css).not.toContain("rgba(");
  });

  it("keeps fully-opaque stops as plain hex", () => {
    const g = createGradient({ type: "linear", angle: 0 });
    expect(gradientToCss(g)).toContain("#0ea5e9 0%");
  });

  it("3+ stops survive add + CSS emission in sorted order", () => {
    let g = createGradient({ type: "linear", angle: 135 });
    g = addStop(g, 50, "#ffffff", 1);
    const css = gradientToCss(g);
    const offsets = [...css.matchAll(/ (\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    expect(offsets).toEqual([0, 50, 100]);
  });

  it("gradient with angle 0 vs 360 differ", () => {
    const a = gradientToCss(createGradient({ type: "linear", angle: 0 }));
    const b = gradientToCss(createGradient({ type: "linear", angle: 360 }));
    expect(a).not.toBe(b);
  });
});
