import { describe, expect, it } from "vitest";
import { nearestLockedStraightedge } from "../draftingSnap";
import { createSetSquare } from "../setSquare";
import type { UserGuide } from "../guides";

const guide = (overrides: Partial<UserGuide> = {}): UserGuide => ({ id: "g1", angle: 0, x: 0, y: 100, locked: true, ...overrides });

describe("nearest locked straightedge", () => {
  it("engages only locked guides within the screen-space radius", () => {
    expect(nearestLockedStraightedge({ x: 100, y: 105 }, [guide({ locked: false })], [], 1)).toBeNull();
    const hit = nearestLockedStraightedge({ x: 100, y: 105 }, [guide()], [], 1);
    expect(hit?.kind).toBe("guide");
    if (hit?.kind === "guide") expect(hit.point.y).toBe(100);
    expect(nearestLockedStraightedge({ x: 100, y: 105 }, [guide()], [], 3)).toBeNull();
  });

  it("engages only finite locked set-square edges", () => {
    const square = { ...createSetSquare("sq1", { x: 100, y: 100 }), size: 100, locked: true };
    const nearEdge = nearestLockedStraightedge({ x: 120, y: 66.7 }, [], [square], 1);
    expect(nearEdge?.kind).toBe("set-square");
    const farOnExtension = nearestLockedStraightedge({ x: 220, y: 66.7 }, [], [square], 1);
    expect(farOnExtension).toBeNull();
  });

  it("chooses whichever locked ruler or triangle edge is nearer", () => {
    const square = { ...createSetSquare("sq1", { x: 100, y: 100 }), size: 100, locked: true };
    const point = { x: 120, y: 66.7 };
    const squareWins = nearestLockedStraightedge(point, [guide({ y: 60 })], [square], 1);
    expect(squareWins?.kind).toBe("set-square");
    const guideWins = nearestLockedStraightedge(point, [guide({ y: 66.7 })], [square], 1);
    expect(guideWins?.kind).toBe("guide");
  });
});
