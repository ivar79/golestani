import { describe, expect, it } from "vitest";
import { addAngledGuide, moveGuide, normalizeGuides, removeGuide, rotateGuide, toggleGuideLock, type UserGuide } from "../guides";

const board = { width: 800, height: 600 };
const initial: UserGuide[] = [{ id: "g1", angle: 0, x: 120, y: 160 }];

describe("locked ruler guides", () => {
  it("toggles lock without changing guide geometry", () => {
    const locked = toggleGuideLock(initial, "g1");
    expect(locked[0]).toEqual({ ...initial[0], locked: true });
    expect(toggleGuideLock(locked, "g1")[0]).toEqual(initial[0]);
  });

  it("does not move or rotate a locked guide", () => {
    const locked = normalizeGuides([{ ...initial[0], locked: true }], board);
    expect(moveGuide(locked, "g1", { x: 400, y: 300 }, board)).toEqual(locked);
    expect(rotateGuide(locked, "g1", 45, board)).toEqual(locked);
  });

  it("cannot delete a locked guide", () => {
    const locked = normalizeGuides([{ ...initial[0], locked: true }], board);
    expect(removeGuide(locked, "g1")).toEqual(locked);
  });

  it("does not move an existing locked guide when another guide is placed on it", () => {
    const locked = normalizeGuides([{ ...initial[0], locked: true }], board);
    expect(addAngledGuide(locked, { angle: 0, x: 400, y: 160 }, board)).toEqual(locked);
  });
});
