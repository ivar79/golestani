import { describe, expect, it } from "vitest";
import {
  ANGLE_ASSIST_DEFAULT,
  ANGLE_ASSIST_PRESETS,
  GUIDE_DEDUPE_PX,
  MAX_GUIDES,
  RULER_THICKNESS,
  addAngledGuide,
  addGuide,
  angleFromDrag,
  angledGuideLines,
  axisAlignedGuideLines,
  axisForAngle,
  boardDiagonal,
  clampAxis,
  clampGuide,
  clampPoint,
  direction,
  distanceToGuide,
  extentFor,
  guideAngleForAxis,
  guideAxisForRuler,
  guideId,
  isAxisAligned,
  moveGuide,
  nearestGuide,
  normal,
  normalizeAngle,
  normalizeAngleAssist,
  normalizeGuides,
  projectOnGuide,
  removeGuide,
  rotateGuide,
  roundGuide,
  rulerTicks,
  snapAngle,
  type UserGuide,
} from "../guides";

const BOARD = { width: 306, height: 362 };
const board = (width = BOARD.width, height = BOARD.height) => ({ width, height });
const vertical = (x: number, y = BOARD.height / 2): UserGuide => ({ id: `v${x}`, angle: 90, x, y });
const horizontal = (y: number, x = BOARD.width / 2): UserGuide => ({ id: `h${y}`, angle: 0, x, y });

describe("guide coordinates and normalization", () => {
  it("clamps onto the board and rounds to a tenth of a pixel", () => {
    expect(clampGuide(-40, BOARD.width)).toBe(0);
    expect(clampGuide(9_999, BOARD.width)).toBe(BOARD.width);
    expect(clampGuide(10.26, BOARD.width)).toBe(10.3);
    expect(roundGuide(10.24)).toBe(10.2);
  });

  it("falls back on NaN and clamps an infinite coordinate to the matching edge", () => {
    // A NaN guide would render nowhere and drag forever: the clamp is the only
    // way in, so it must produce a real coordinate.
    expect(clampAxis(Number.NaN, BOARD.width)).toBe(0);
    expect(clampAxis(Number.NaN, BOARD.width, 42)).toBe(42);
    // Infinity is a direction: +∞ means "past the right/bottom edge", not 0.
    expect(clampAxis(Number.POSITIVE_INFINITY, BOARD.width)).toBe(BOARD.width);
    expect(clampAxis(Number.NEGATIVE_INFINITY, BOARD.width)).toBe(0);
    // A broken extent degenerates to 0 instead of disabling the clamp.
    expect(clampAxis(10, Number.NaN)).toBe(0);
  });

  it("clamps a whole anchor point, so an angled guide can never leave the board", () => {
    expect(clampPoint({ x: -5, y: 9_999 }, BOARD)).toEqual({ x: 0, y: BOARD.height });
    expect(clampPoint({ x: 10.04, y: 20.06 }, BOARD)).toEqual({ x: 10, y: 20.1 });
    expect(clampPoint({ x: Number.NaN, y: Number.NaN }, BOARD)).toEqual({
      x: BOARD.width / 2,
      y: BOARD.height / 2,
    });
  });

  it("measures the extent along the guide's own axis", () => {
    expect(extentFor("x", BOARD)).toBe(BOARD.width);
    expect(extentFor("y", BOARD)).toBe(BOARD.height);
  });

  it("wraps angles into [0,180): a line and its reverse are the same line", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(180)).toBe(0);
    expect(normalizeAngle(-45)).toBe(135);
    expect(normalizeAngle(225)).toBe(45);
    expect(normalizeAngle(44.444)).toBe(44.44);
    expect(normalizeAngle(Number.NaN, 90)).toBe(90);
  });

  it("knows the two axis directions and gives each axis its angle", () => {
    expect(isAxisAligned(0)).toBe(true);
    expect(isAxisAligned(90)).toBe(true);
    expect(isAxisAligned(180)).toBe(true);
    expect(isAxisAligned(45)).toBe(false);
    expect(isAxisAligned(89.5)).toBe(false);
    expect(guideAngleForAxis("x")).toBe(90);
    expect(guideAngleForAxis("y")).toBe(0);
    // Which ruler strip owns a guide is derived from its angle, so a rotated
    // guide still knows where "put it back" is.
    expect(axisForAngle(90)).toBe("x");
    expect(axisForAngle(0)).toBe("y");
    expect(axisForAngle(80)).toBe("x");
    expect(axisForAngle(10)).toBe("y");
  });

  it("gives a direction and a perpendicular for any angle", () => {
    expect(direction(0)).toEqual({ dx: 1, dy: 0 });
    const ninety = direction(90);
    expect(ninety.dx).toBeCloseTo(0, 10);
    expect(ninety.dy).toBeCloseTo(1, 10);
    // The normal is the direction a snap moves along, so it must be unit length.
    const { nx, ny } = normal(45);
    expect(Math.hypot(nx, ny)).toBeCloseTo(1, 10);
  });

  it("keeps ids, drops broken entries, clamps points and collapses duplicates", () => {
    const normalized = normalizeGuides(
      [
        { id: "keep-me", angle: 90, x: 12.34, y: 100 },
        { id: "off-board", angle: 0, x: -80, y: 5_000 },
        { id: "dupe", angle: 90, x: 12.4, y: 150 },
        { id: "", angle: 0, x: 20, y: 40 },
        { id: "diagonal", angle: 45, x: 30, y: 30 },
        { id: "diagonal-2", angle: 45.0001, x: 30.01, y: 30.01 },
      ],
      BOARD,
    );
    expect(normalized.map((guide) => guide.id)).toEqual(["keep-me", "off-board", "guide-0-20-40", "diagonal"]);
    expect(normalized[0]).toMatchObject({ angle: 90, x: 12.3 });
    // Out-of-board anchors are clamped onto the board, never stored off-canvas.
    expect(normalized[1]).toMatchObject({ x: 0, y: BOARD.height });
    // Coincident DIAGONALS collapse too: a diagonal is a line, not a special case.
    expect(normalized.filter((guide) => guide.angle === 45)).toHaveLength(1);
  });

  it("caps the list so a board full of guides cannot happen", () => {
    const many: UserGuide[] = Array.from({ length: MAX_GUIDES + 8 }, (_, index) => ({
      id: `g${index}`,
      angle: 0,
      x: 100,
      y: index * 4,
    }));
    expect(normalizeGuides(many, board(400, 4_000))).toHaveLength(MAX_GUIDES);
  });

  it("gives an angled guide its own identity, so it cannot be confused with a ruler line", () => {
    // The id must include the ANGLE: two guides at the same anchor but different
    // angles are different lines and must both survive.
    const list = normalizeGuides([horizontal(50), { id: "d", angle: 45, x: BOARD.width / 2, y: 50 }], BOARD);
    expect(list).toHaveLength(2);
  });

  it("generates a deterministic id and suffixes a genuine collision", () => {
    expect(guideId(90, { x: 100, y: 50 })).toBe("guide-90-100-50");
    expect(guideId(0, { x: 10.5, y: 20 })).toBe("guide-0-10_5-20");
    expect(guideId(90, { x: 100, y: 50 }, [vertical(100)])).toBe("guide-90-100-50");
    expect(guideId(90, { x: 100, y: 50 }, [{ id: "guide-90-100-50", angle: 90, x: 100, y: 50 }])).toBe(
      "guide-90-100-50-2",
    );
  });
});

describe("adding, moving, rotating and removing guides", () => {
  it("adds an axis guide anchored on the board's centre line", () => {
    // A vertical guide's y is irrelevant to its geometry, so it is anchored at
    // the middle of the board: that keeps its rotate handle reachable.
    expect(addGuide([], "x", 500, BOARD)).toEqual([
      { id: "guide-90-306-181", angle: 90, x: 306, y: BOARD.height / 2 },
    ]);
    expect(addGuide([], "y", 20, BOARD)).toEqual([
      { id: "guide-0-153-20", angle: 0, x: BOARD.width / 2, y: 20 },
    ]);
  });

  it("adds a guide at ANY angle — the diagonal the axis model could not express", () => {
    const list = addAngledGuide([], { angle: 45, x: 40, y: 60 }, BOARD);
    expect(list).toEqual([{ id: "guide-45-40-60", angle: 45, x: 40, y: 60 }]);
    // 200° is the same line as 20°, and the stored value must say so.
    expect(addAngledGuide([], { angle: 200, x: 10, y: 10 }, BOARD)[0].angle).toBe(20);
  });

  it("does not stack a second invisible guide on the same line — it moves it", () => {
    const once = addGuide([], "x", 100, BOARD);
    const twice = addGuide(once, "x", 100.2, BOARD);
    expect(twice).toHaveLength(1);
    expect(twice[0].x).toBe(100.2);
    // A line on the other axis through the same coordinate is a DIFFERENT line.
    expect(addGuide(once, "y", 100, BOARD)).toHaveLength(2);
    // …and so is a diagonal through the same anchor.
    expect(addAngledGuide(once, { angle: 45, x: 100, y: 181 }, BOARD)).toHaveLength(2);
  });

  it("refuses to grow past the cap", () => {
    const full = normalizeGuides(
      Array.from({ length: MAX_GUIDES }, (_, index) => ({ id: `g${index}`, angle: 0, x: 100, y: index * 4 })),
      board(400, 4_000),
    );
    expect(full).toHaveLength(MAX_GUIDES);
    expect(addGuide(full, "x", 50, board(400, 4_000))).toHaveLength(MAX_GUIDES);
    expect(addAngledGuide(full, { angle: 45, x: 10, y: 10 }, board(400, 4_000))).toHaveLength(MAX_GUIDES);
  });

  it("moves an axis guide along its own axis, keeping the other coordinate", () => {
    const list = addGuide(addGuide([], "x", 10, BOARD), "y", 20, BOARD);
    const moved = moveGuide(list, list[0].id, { x: 999, y: 5 }, BOARD);
    expect(moved[0]).toMatchObject({ angle: 90, x: BOARD.width });
    expect(moved[1]).toMatchObject({ angle: 0, y: 20, x: BOARD.width / 2 });
  });

  it("translates a diagonal guide instead of flattening it onto one axis", () => {
    const list = addAngledGuide([], { angle: 45, x: 40, y: 60 }, BOARD);
    // Both coordinates move: an angled line has no "own axis" to follow.
    const moved = moveGuide(list, list[0].id, { x: 90, y: 120 }, BOARD);
    expect(moved[0]).toMatchObject({ angle: 45, x: 90, y: 120 });
    // And it clamps as a POINT, so it never leaves the board.
    expect(moveGuide(list, list[0].id, { x: 9_999, y: 9_999 }, BOARD)[0]).toMatchObject({
      x: BOARD.width,
      y: BOARD.height,
    });
  });

  it("collapses two guides dragged onto the same line instead of leaving a ghost", () => {
    const list = addGuide(addGuide([], "x", 10, BOARD), "x", 80, BOARD);
    expect(list).toHaveLength(2);
    const collapsed = moveGuide(list, list[0].id, { x: 80, y: 181 }, BOARD);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].x).toBe(80);
  });

  it("rotates a horizontal guide into a diagonal — how a diagonal is made from a ruler", () => {
    const list = addGuide([], "y", 40, BOARD);
    const rotated = rotateGuide(list, list[0].id, 30, BOARD);
    expect(rotated[0].angle).toBe(30);
    // The anchor is untouched: a rotation pivots, it does not translate.
    expect(rotated[0]).toMatchObject({ x: BOARD.width / 2, y: 40 });
    // Normalisation applies here too.
    expect(rotateGuide(list, list[0].id, -30, BOARD)[0].angle).toBe(150);
  });

  it("merges a guide rotated onto another line, and ignores unknown ids", () => {
    const list = [...addAngledGuide([], { angle: 0, x: 50, y: 40 }, BOARD), { id: "d", angle: 45, x: 50, y: 40 }];
    const merged = rotateGuide(list, "d", 0, BOARD);
    expect(merged).toHaveLength(1);
    expect(rotateGuide(list, "nope", 30, BOARD)).toEqual(list);
  });

  it("ignores a move for an unknown id and removes by id", () => {
    const list = addGuide([], "y", 30, BOARD);
    expect(moveGuide(list, "nope", { x: 10, y: 10 }, BOARD)).toEqual(list);
    expect(removeGuide(list, "nope")).toEqual(list);
    expect(removeGuide(list, list[0].id)).toEqual([]);
  });

  it("hit-tests by PERPENDICULAR distance, so a long diagonal is grabbable anywhere", () => {
    const list = [
      { id: "diag", angle: 45, x: 50, y: 50 },
      { id: "vert", angle: 90, x: 200, y: 100 },
    ];
    // 30 units along the 45° line from its anchor: still zero distance away.
    const farAlong = { x: 50 + 30, y: 50 + 30 };
    expect(distanceToGuide(list[0], farAlong)).toBeCloseTo(0, 10);
    expect(nearestGuide(list, farAlong, 6)?.id).toBe("diag");
    // A horizontal offset of d sits d·sin45° = d/√2 from a 45° line: 4√2 → 4
    // units away (inside a 6px tolerance), 8√2 → 8 (outside it).
    expect(nearestGuide(list, { x: 50 + 4 * Math.SQRT2, y: 50 }, 6)?.id).toBe("diag");
    expect(nearestGuide(list, { x: 50 + 8 * Math.SQRT2, y: 50 }, 6)).toBeNull();
    expect(nearestGuide(list, { x: 203, y: 100 }, 6)?.id).toBe("vert");
  });

  it("projects a point onto a guide's line — where a snap would land", () => {
    expect(projectOnGuide(horizontal(100), { x: 40, y: 103 })).toEqual({ x: 40, y: 100 });
    const projected = projectOnGuide({ id: "d", angle: 45, x: 0, y: 0 }, { x: 10, y: 0 });
    expect(projected.x).toBeCloseTo(5, 10);
    expect(projected.y).toBeCloseTo(5, 10);
  });

  it("dedupes within half a pixel, not at any distance", () => {
    const list = addGuide([], "x", 100, BOARD);
    expect(addGuide(list, "x", 100 + GUIDE_DEDUPE_PX * 2, BOARD)).toHaveLength(2);
  });
});

describe("the angle-assist (set-square) grid", () => {
  it("offers the documented increments with 45 as the default", () => {
    expect(ANGLE_ASSIST_PRESETS).toContain(45);
    expect(ANGLE_ASSIST_DEFAULT).toBe(45);
  });

  it("accepts only the increments the editor offers", () => {
    expect(normalizeAngleAssist(30)).toBe(30);
    expect(normalizeAngleAssist(15)).toBe(15);
    // An arbitrary number would produce a grid the UI cannot show or explain.
    expect(normalizeAngleAssist(7)).toBe(ANGLE_ASSIST_DEFAULT);
    expect(normalizeAngleAssist(undefined)).toBe(ANGLE_ASSIST_DEFAULT);
    expect(normalizeAngleAssist(Number.NaN)).toBe(ANGLE_ASSIST_DEFAULT);
  });

  it("turns a drag direction into an angle, locked onto the grid when one is given", () => {
    // Free: the pointer decides, to two decimals.
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(90);
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(45);
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 10, y: 20 })).toBe(63.43);
    // Locked: 51° with a 45° square is exactly 45°, and 30° gives 60°.
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 40, y: 50 }, [45])).toBe(45);
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 40, y: 50 }, [30])).toBe(60);
    // The smallest increment wins when several are offered.
    expect(angleFromDrag({ x: 0, y: 0 }, { x: 10, y: 20 }, [45, 15])).toBe(60);
    // A degenerate drag (pointer on the anchor) must not produce NaN.
    expect(Number.isFinite(angleFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 }))).toBe(true);
    expect(snapAngle(44.9, [45])).toBe(45);
    expect(snapAngle(44.9, [])).toBe(44.9);
  });
});

describe("guides as snap lines", () => {
  it("splits axis guides from diagonal ones — they snap by different maths", () => {
    const list = [
      ...addGuide(addGuide([], "x", 10.04, BOARD), "y", 20, BOARD),
      { id: "d", angle: 30, x: 100, y: 100 },
    ];
    expect(axisAlignedGuideLines(list, BOARD)).toEqual([
      { axis: "x", at: 10 },
      { axis: "y", at: 20 },
    ]);
    // A diagonal CANNOT be an axis line: it has to arrive as its own geometry.
    expect(angledGuideLines(list, BOARD)).toEqual([{ x: 100, y: 100, angle: 30 }]);
    expect(angledGuideLines(addGuide([], "x", 50, BOARD), BOARD)).toEqual([]);
  });

  it("measures the board diagonal the renderer clips a diagonal line against", () => {
    expect(boardDiagonal(board(300, 400))).toBe(500);
    expect(boardDiagonal(board(0, 0))).toBe(0);
  });
});

describe("ruler ticks", () => {
  it("uses one identical ruler thickness for both strips", () => {
    expect(RULER_THICKNESS).toBeGreaterThan(8);
    expect(guideAxisForRuler("top")).toBe("x");
    expect(guideAxisForRuler("left")).toBe("y");
  });

  it("labels ticks at least the minimum gap apart and offsets them by zoom", () => {
    const ticks = rulerTicks(0, 100, 1, { minLabelGap: 56 });
    const major = ticks.filter((tick) => tick.major);
    // 100 units at zoom 1 with a 56px gap → step 100 → three labelled ticks.
    expect(major.length).toBeLessThanOrEqual(2);
    expect(major.every((tick) => tick.label !== "")).toBe(true);
    for (let index = 1; index < major.length; index += 1) {
      expect(major[index].offset - major[index - 1].offset).toBeGreaterThanOrEqual(56);
    }
    expect(rulerTicks(0, 100, 2)[0].offset).toBe(0);
  });

  it("subdivides every labelled step so the strip reads as a real ruler", () => {
    const ticks = rulerTicks(0, 100, 1);
    const major = ticks.filter((tick) => tick.major);
    expect(major.length).toBeGreaterThan(1);
    const step = major[1].value - major[0].value;
    // The minor ticks are what turn a line into a scale.
    expect(ticks.length).toBeGreaterThan(major.length * 4);
    expect(step).toBeGreaterThan(0);
    for (const tick of ticks) {
      // Every tick is a multiple of the minor step, so nothing drifts.
      expect(Math.abs(tick.value / (step / 10) - Math.round(tick.value / (step / 10)))).toBeLessThan(1e-6);
    }
  });

  it("gives every minor tick an empty label so only real numbers are printed", () => {
    const ticks = rulerTicks(0, 200, 1);
    expect(ticks.filter((tick) => !tick.major).every((tick) => tick.label === "")).toBe(true);
  });

  it("times every offset by the zoom so the scale matches the board", () => {
    const ticks = rulerTicks(0, 10, 4, { minLabelGap: 1 });
    const atTwo = ticks.find((tick) => tick.value === 2);
    expect(atTwo?.offset).toBe(8);
  });

  it("thins the scale when zoomed out instead of printing every number", () => {
    const dense = rulerTicks(0, 306, 0.25);
    const sparse = rulerTicks(0, 306, 4);
    expect(dense.length).toBeGreaterThan(0);
    expect(dense.length).toBeLessThan(sparse.length);
  });

  it("returns nothing for a degenerate or non-finite range", () => {
    expect(rulerTicks(0, 0, 1)).toEqual([]);
    expect(rulerTicks(Number.NaN, 10, 1)).toEqual([]);
    // A reversed range is the same interval read backwards — the component
    // passes (visibleStart, visibleEnd) which can legitimately straddle the
    // origin, so the helper normalises the pair instead of returning nothing.
    expect(rulerTicks(10, 0, 1)).toEqual(rulerTicks(0, 10, 1));
    expect(rulerTicks(10, 0, 1).length).toBeGreaterThan(0);
    // A broken zoom must not explode the tick count or the offsets.
    expect(rulerTicks(0, 10, Number.NaN).every((tick) => Number.isFinite(tick.offset))).toBe(true);
  });

  it("starts the scale at or below the visible edge so panning keeps labels honest", () => {
    const ticks = rulerTicks(-20, 40, 1, { minLabelGap: 10 });
    expect(ticks[0].value).toBeLessThanOrEqual(-20);
    expect(ticks[0].offset).toBeLessThanOrEqual(0);
  });
});
