export type SetSquarePoint = { x: number; y: number };

export type SetSquareKind = "45-45-90" | "30-60-90";
export type SetSquare = {
  id: string;
  cx: number;
  cy: number;
  size: number;
  angle: number;
  kind: SetSquareKind;
  locked: boolean;
};
export const MAX_SET_SQUARES = 4;
export const SET_SQUARE_MIN_SIZE = 40;
export const SET_SQUARE_MAX_SIZE = 1200;
export const SET_SQUARE_ENGAGE_PX = 12;

export function normalizeSetSquare(square: SetSquare): SetSquare {
  return {
    ...square,
    cx: Number.isFinite(square.cx) ? square.cx : 0,
    cy: Number.isFinite(square.cy) ? square.cy : 0,
    size: Math.max(SET_SQUARE_MIN_SIZE, Math.min(SET_SQUARE_MAX_SIZE, Number.isFinite(square.size) ? square.size : 180)),
    angle: ((Number.isFinite(square.angle) ? square.angle : 0) % 360 + 360) % 360,
    kind: square.kind === "30-60-90" ? "30-60-90" : "45-45-90",
    locked: square.locked === true,
  };
}

/** Triangle vertices in artboard coordinates, rotated about the centroid. */
export function setSquareVertices(input: SetSquare): SetSquarePoint[] {
  const s = normalizeSetSquare(input);
  const raw = s.kind === "45-45-90"
    ? [{ x: -s.size / 3, y: -s.size / 3 }, { x: 2 * s.size / 3, y: -s.size / 3 }, { x: -s.size / 3, y: 2 * s.size / 3 }]
    : (() => {
        const w = Math.sqrt(3) * s.size;
        return [{ x: -w / 3, y: -s.size / 3 }, { x: 2 * w / 3, y: -s.size / 3 }, { x: -w / 3, y: 2 * s.size / 3 }];
      })();
  const a = s.angle * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return raw.map(p => ({ x: s.cx + p.x * cos - p.y * sin, y: s.cy + p.x * sin + p.y * cos }));
}

export function closestPointOnSegment(point: SetSquarePoint, a: SetSquarePoint, b: SetSquarePoint): { point: SetSquarePoint; t: number; distance: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  const projected = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: projected, t, distance: Math.hypot(point.x - projected.x, point.y - projected.y) };
}

export function nearestSetSquareEdge(input: SetSquare, point: SetSquarePoint): { edgeIndex: number; point: SetSquarePoint; distance: number } | null {
  if (!input.locked) return null;
  const vertices = setSquareVertices(input);
  let best: { edgeIndex: number; point: SetSquarePoint; distance: number } | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const projected = closestPointOnSegment(point, vertices[i], vertices[(i + 1) % vertices.length]);
    if (!best || projected.distance < best.distance) best = { edgeIndex: i, point: projected.point, distance: projected.distance };
  }
  return best;
}

export function createSetSquare(id: string, center: SetSquarePoint, kind: SetSquareKind = "45-45-90"): SetSquare {
  return normalizeSetSquare({ id, cx: center.x, cy: center.y, size: 180, angle: 0, kind, locked: false });
}

export function toggleSetSquareKind(input: SetSquare): SetSquare {
  const square = normalizeSetSquare(input);
  return normalizeSetSquare({ ...square, kind: square.kind === "45-45-90" ? "30-60-90" : "45-45-90" });
}
