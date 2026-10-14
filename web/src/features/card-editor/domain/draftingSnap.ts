import { distanceToGuide, projectOnGuide, type UserGuide } from "./guides";
import { nearestSetSquareEdge, setSquareVertices, SET_SQUARE_ENGAGE_PX, type SetSquare, type SetSquarePoint } from "./setSquare";

export type LockedStraightedgeHit =
  | { kind: "guide"; guide: UserGuide; point: SetSquarePoint; distance: number }
  | { kind: "set-square"; square: SetSquare; edgeIndex: number; a: SetSquarePoint; b: SetSquarePoint; point: SetSquarePoint; distance: number };

/**
 * Resolve the physical straightedge closest to a press. Distances are measured
 * in artboard units, with a 12-screen-pixel engagement radius. Triangle edges
 * are finite segments; guides are infinite lines.
 */
export function nearestLockedStraightedge(
  point: SetSquarePoint,
  guides: readonly UserGuide[],
  squares: readonly SetSquare[],
  zoom: number,
  engagePx = SET_SQUARE_ENGAGE_PX,
): LockedStraightedgeHit | null {
  const radius = engagePx / Math.max(0.01, Number.isFinite(zoom) ? zoom : 1);
  let best: LockedStraightedgeHit | null = null;
  for (const guide of guides) {
    if (!guide.locked) continue;
    const distance = distanceToGuide(guide, point);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { kind: "guide", guide, point: projectOnGuide(guide, point), distance };
    }
  }
  for (const square of squares) {
    const hit = nearestSetSquareEdge(square, point);
    if (!hit || hit.distance > radius || (best && hit.distance >= best.distance)) continue;
    const vertices = setSquareVertices(square);
    best = {
      kind: "set-square",
      square,
      edgeIndex: hit.edgeIndex,
      a: vertices[hit.edgeIndex],
      b: vertices[(hit.edgeIndex + 1) % vertices.length],
      point: hit.point,
      distance: hit.distance,
    };
  }
  return best;
}
