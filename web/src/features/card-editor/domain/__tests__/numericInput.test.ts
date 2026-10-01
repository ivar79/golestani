import { describe, expect, it } from "vitest";
import { EditorEngine, type NumericField } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type CardLayer } from "../document";
import { isRelativeExpression, parseNumericInput } from "../numericInput";

function layer(id: string, overrides: Partial<CardLayer> = {}): CardLayer {
  return {
    id,
    kind: "text",
    x: 300,
    y: 200,
    width: 120,
    height: 40,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    z: 1,
    color: "#000000",
    background: null,
    text: "متن",
    fontSize: 28,
    fontWeight: 600,
    align: "start",
    fontFamily: "vazir",
    ...overrides,
  } as CardLayer;
}

function docWith(...layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

function parse(raw: string, current: number) {
  return parseNumericInput(raw, current);
}

describe("parseNumericInput — absolute entries", () => {
  it("a bare number replaces the value", () => {
    expect(parse("100", 300)).toEqual({ ok: true, value: 100, relative: false });
    expect(parse("12.5", 300)).toEqual({ ok: true, value: 12.5, relative: false });
  });

  it("a full expression is evaluated once, left to right", () => {
    expect(parse("2+3*4", 0).value).toBe(14);
    expect(parse("(2+3)*4", 0).value).toBe(20);
    expect(parse("10/4", 0).value).toBe(2.5);
    // A bare "-5" reads as "move down 5" (Illustrator's transform entry), so it
    // is relative — "=-5" style absoluteness is not part of the grammar.
    const minus = parse("-5", 10);
    expect(minus).toEqual({ ok: true, value: 5, relative: true });
  });

  it("thousands separators and Persian commas are accepted", () => {
    expect(parse("1,250", 0).value).toBe(1250);
    expect(parse("1،250", 0).value).toBe(1250);
    // A malformed group is a typo, not a number.
    expect(parse("1,25", 0).ok).toBe(false);
  });
});

describe("parseNumericInput — relative shorthand", () => {
  it("+ and − add to the current value", () => {
    expect(parse("+10", 300)).toEqual({ ok: true, value: 310, relative: true });
    expect(parse("-45", 300)).toEqual({ ok: true, value: 255, relative: true });
  });

  it("* and / scale the current value", () => {
    expect(parse("*2", 300)).toEqual({ ok: true, value: 600, relative: true });
    expect(parse("/4", 300)).toEqual({ ok: true, value: 75, relative: true });
  });

  it("% is a percentage OF the current value", () => {
    expect(parse("50%", 300)).toEqual({ ok: true, value: 150, relative: true });
    expect(parse("200%", 40)).toEqual({ ok: true, value: 80, relative: true });
  });

  it("shorthand composes into larger expressions", () => {
    expect(parse("+10*2", 300).value).toBe(320);
    expect(parse("50%+10", 300).value).toBe(160);
  });
});

describe("parseNumericInput — rejections", () => {
  it("rejects anything outside the grammar without evaluating it", () => {
    for (const hostile of ["alert(1)", "__proto__", "1;2", "2;//x", "abc", "1e999", "NaN", "(1+2", "1+2)", "", "  "]) {
      expect(parse(hostile, 300).ok).toBe(false);
    }
  });

  it("division by zero is a rejection, never Infinity", () => {
    expect(parse("10/0", 300).ok).toBe(false);
    expect(parse("/0", 300).ok).toBe(false);
  });

  it("min/max clamp the accepted result", () => {
    const parsed = parseNumericInput("99999", 0, { min: 1, max: 400 });
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toBe(400);
  });
});

describe("isRelativeExpression", () => {
  it("flags exactly the entries that depended on the current value", () => {
    expect(isRelativeExpression("+10")).toBe(true);
    expect(isRelativeExpression("*2")).toBe(true);
    expect(isRelativeExpression("50%")).toBe(true);
    expect(isRelativeExpression("100")).toBe(false);
    expect(isRelativeExpression("(1+2)*3")).toBe(false);
    expect(isRelativeExpression("junk!!")).toBe(false);
  });
});

describe("engine setNumericField", () => {
  it("absolute entry writes the field", () => {
    const engine = new EditorEngine(docWith(layer("t")));
    expect(engine.setNumericField("t", "x", "412")).toBe(true);
    expect(engine.getState().doc.layers[0].x).toBe(412);
  });

  it("+10 on x moves the layer by exactly 10", () => {
    const engine = new EditorEngine(docWith(layer("t")));
    expect(engine.setNumericField("t", "x", "+10")).toBe(true);
    expect(engine.getState().doc.layers[0].x).toBe(310);
  });

  it("50% on width scales the box — and a path's ANCHORS with it", () => {
    const pathLayer = {
      id: "p",
      kind: "path" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      z: 1,
      color: null,
      background: null,
      closed: true,
      points: [
        { x: 0, y: 0, hIn: null, hOut: null },
        { x: 100, y: 0, hIn: null, hOut: null },
        { x: 100, y: 50, hIn: null, hOut: null },
        { x: 0, y: 50, hIn: null, hOut: null },
      ],
      stroke: null,
      strokeWidth: 0,
      fill: "#0891b2",
    };
    const engine = new EditorEngine(docWith(pathLayer));
    expect(engine.setNumericField("p", "width", "50%")).toBe(true);
    const updated = engine.getState().doc.layers[0];
    expect(updated.width).toBeCloseTo(50, 5); // the box itself is scaled by 0.5
    const points = (updated as typeof pathLayer).points;
    expect(points[1].x).toBe(50); // 100 scaled by 0.5 — the ANCHORS moved too
    expect(points[2].y).toBe(50); // the height axis is untouched by a width entry

    expect(engine.setNumericField("p", "height", "50%")).toBe(true);
    const resized = engine.getState().doc.layers[0] as typeof pathLayer;
    expect(resized.points[2].y).toBe(25); // 50 scaled by 0.5
  });

  it("an angle entry is wrapped into the validator's ±180 range", () => {
    const engine = new EditorEngine(docWith(layer("t")));
    expect(engine.setNumericField("t", "angle", "270")).toBe(true);
    expect(engine.getState().doc.layers[0].angle).toBe(-90);
  });

  it("a rejected expression writes NOTHING (document untouched, no history)", () => {
    const engine = new EditorEngine(docWith(layer("t")));
    const before = engine.getState().doc;
    expect(engine.setNumericField("t", "width", "alert(1)")).toBe(false);
    expect(engine.getState().doc).toBe(before);
    expect(engine.getState().canUndo).toBe(false);
  });

  it("a locked layer rejects numeric entry", () => {
    const engine = new EditorEngine(docWith(layer("t", { locked: true })));
    expect(engine.setNumericField("t", "x", "10")).toBe(false);
  });

  it("every supported field works, including stroke and font sizes", () => {
    const engine = new EditorEngine(docWith(layer("t")));
    const fields: [NumericField, string, number][] = [
      ["y", "+8", 208],
      ["height", "*2", 80],
      ["fontSize", "/2", 14],
    ];
    for (const [field, raw, expected] of fields) {
      expect(engine.setNumericField("t", field, raw)).toBe(true);
      expect((engine.getState().doc.layers[0] as unknown as Record<string, number>)[field]).toBe(expected);
    }
  });
});
