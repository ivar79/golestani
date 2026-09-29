import { describe, expect, it } from "vitest";
import {
  addStop,
  createGradient,
  gradientRoundTrips,
  gradientToCss,
  removeStop,
  sanitizeStop,
  sortStops,
  updateStop,
} from "../gradient";

describe("createGradient", () => {
  it("fills sensible defaults for an empty input", () => {
    const g = createGradient();
    expect(g.type).toBe("linear");
    expect(g.angle).toBe(135);
    expect(g.stops).toHaveLength(2);
    expect(g.stops[0].offset).toBe(0);
    expect(g.stops[1].offset).toBe(100);
  });

  it("accepts a radial type and clamps a wild angle", () => {
    const g = createGradient({ type: "radial", angle: 999 });
    expect(g.type).toBe("radial");
    expect(g.angle).toBe(360);
  });

  it("rejects an under-filled stops array in favor of the default pair", () => {
    const g = createGradient({ stops: [{ offset: 10, color: "#fff", opacity: 1 }] });
    expect(g.stops).toHaveLength(2);
  });
});

describe("sanitizeStop", () => {
  it("clamps offset and opacity and fills missing color", () => {
    expect(sanitizeStop({ offset: -50, opacity: 2 })).toEqual({
      offset: 0,
      color: "#000000",
      opacity: 1,
    });
  });

  it("rounds to 2 decimals", () => {
    const stop = sanitizeStop({ offset: 33.33333, color: "#abc", opacity: 0.50001 });
    expect(stop.offset).toBe(33.33);
    expect(stop.opacity).toBe(0.5);
  });
});

describe("sortStops", () => {
  it("sorts ascending and drops exact offset duplicates", () => {
    const sorted = sortStops([
      { offset: 100, color: "#000", opacity: 1 },
      { offset: 0, color: "#111", opacity: 1 },
      { offset: 50, color: "#222", opacity: 1 },
      { offset: 50, color: "#333", opacity: 1 },
    ]);
    expect(sorted.map((s) => s.offset)).toEqual([0, 50, 100]);
    expect(sorted[1].color).toBe("#222");
  });
});

describe("addStop / updateStop / removeStop", () => {
  const base = createGradient();

  it("addStop keeps the list sorted", () => {
    const g = addStop(base, 25);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 25, 100]);
  });

  it("updateStop sanitizes and re-sorts", () => {
    const added = addStop(base, 25);
    const g = updateStop(added, 1, { offset: 90, opacity: 0.2 });
    expect(g.stops.map((s) => s.offset)).toEqual([0, 90, 100]);
    expect(g.stops[1].opacity).toBe(0.2);
  });

  it("removeStop never goes below the two-stop minimum", () => {
    expect(removeStop(base, 0).stops).toHaveLength(2);
    const three = addStop(base, 50);
    expect(removeStop(three, 1).stops).toHaveLength(2);
  });
});

describe("gradientToCss", () => {
  it("renders a linear gradient with an integer angle", () => {
    const css = gradientToCss(createGradient({ angle: 90.7 }));
    expect(css).toBe("linear-gradient(91deg, #0ea5e9 0%, #2563eb 100%)");
  });

  it("renders a radial gradient", () => {
    const css = gradientToCss(createGradient({ type: "radial" }));
    expect(css.startsWith("radial-gradient(circle at center,")).toBe(true);
  });

  it("renders stops with 2-decimal offsets", () => {
    const g = addStop(createGradient({ angle: 0 }), 12.5, "#abc");
    expect(gradientToCss(g)).toBe("linear-gradient(0deg, #0ea5e9 0%, #abc 12.5%, #2563eb 100%)");
  });
});

describe("gradientRoundTrips", () => {
  it("survives JSON serialization", () => {
    expect(gradientRoundTrips(createGradient({ type: "radial", angle: 45 }))).toBe(true);
  });

  it("accepts an under-filled stops list", () => {
    // An empty/single-stop gradient is illegal for rendering, but the model
    // degrades to the default pair rather than producing broken CSS.
    expect(gradientRoundTrips({ type: "linear", angle: 0, stops: [] })).toBe(true);
  });
});
