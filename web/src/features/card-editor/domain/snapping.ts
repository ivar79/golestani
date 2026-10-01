/**
 * Snapping + smart guides — the geometry behind Figma's "it just lands where I
 * meant it to" feeling.
 *
 * The model is TWO things:
 *   1. a SNAP INDEX — every interesting coordinate in the document (anchors,
 *      endpoints, layer box edges/centres, artboard edges/centre) as either a
 *      POINT target (snaps both axes at once) or a LINE target (one axis);
 *   2. SNAP RESULTS + GUIDES — the snapped coordinate plus the *visual* lines a
 *      UI can draw, so what the user sees is exactly what the geometry did.
 *
 * Every function is pure and returns data. Guides are never stored in the
 * document: they are a projection of one gesture.
 *
 * Pure: no DOM, no React.
 */

import type { CardDocument, CardLayer } from "./document";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const SNAP_TOLERANCE_DEFAULT = 6;

export type SnapKind =
  | "anchor"
  | "endpoint"
  | "box-corner"
  | "box-center"
  | "box-edge"
  | "artboard-edge"
  | "artboard-center"
  | "grid";

export type SnapAxis = "x" | "y";

/** A one-axis alignment target, with the extent of whatever produced it. */
export type SnapLine = {
  axis: SnapAxis;
  value: number;
  kind: SnapKind;
  /** Extent of the source along the OTHER axis (for drawing a real guide). */
  from: number;
  to: number;
  sourceId?: string;
};

/** A two-axis target (an anchor, a corner, a centre). */
export type SnapPointTarget = { x: number; y: number; kind: SnapKind; sourceId?: string };

export type SnapIndex = { lines: SnapLine[]; points: SnapPointTarget[] };

export type Guide = {
  axis: SnapAxis;
  at: number;
  from: number;
  to: number;
  kind: "align" | "spacing";
  label?: string;
};

export type SnapOptions = {
  /** Screen-space-ish tolerance in design px. */
  tolerance?: number;
  /** Optional grid; applied when no line claimed that axis. */
  grid?: number;
  /**
   * `axisLock: true` lets only the axis with the SMALLER deviation snap — the
   * modifier contract a UI exposes as "hold shift to constrain".
   */
  axisLock?: boolean;
  artboard?: { width: number; height: number };
};

export type SnapResult = {
  x: number;
  y: number;
  snappedX: boolean;
  snappedY: boolean;
  /** The strongest target that was used (point target wins). */
  kind: SnapKind | null;
  targetId?: string;
  guides: Guide[];
};

function boxOf(layer: CardLayer): Rect {
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

function pushBox(index: SnapIndex, rect: Rect, kind: SnapKind, sourceId?: string): void {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  index.points.push(
    { x: rect.x, y: rect.y, kind, sourceId },
    { x: right, y: rect.y, kind, sourceId },
    { x: right, y: bottom, kind, sourceId },
    { x: rect.x, y: bottom, kind, sourceId },
    { x: centerX, y: centerY, kind: "box-center", sourceId },
  );
  index.lines.push(
    { axis: "x", value: rect.x, kind: "box-edge", from: rect.y, to: bottom, sourceId },
    { axis: "x", value: centerX, kind: "box-center", from: rect.y, to: bottom, sourceId },
    { axis: "x", value: right, kind: "box-edge", from: rect.y, to: bottom, sourceId },
    { axis: "y", value: rect.y, kind: "box-edge", from: rect.x, to: right, sourceId },
    { axis: "y", value: centerY, kind: "box-center", from: rect.x, to: right, sourceId },
    { axis: "y", value: bottom, kind: "box-edge", from: rect.x, to: right, sourceId },
  );
}

/**
 * Every snap target in a document.
 *
 * Hidden layers are skipped (they are not there, so they cannot attract the
 * pointer). Locked layers ARE included: like Figma, you still align to a locked
 * object even though you cannot select it.
 */
export function buildSnapIndex(
  doc: CardDocument,
  options: { excludeIds?: string[]; layers?: CardLayer[] } = {},
): SnapIndex {
  const exclude = new Set(options.excludeIds ?? []);
  const index: SnapIndex = { lines: [], points: [] };
  const layers = options.layers ?? doc.layers;

  for (const layer of layers) {
    if (layer.hidden || layer.opacity <= 0 || exclude.has(layer.id)) continue;
    const rect = boxOf(layer);
    pushBox(index, rect, "box-corner", layer.id);
    if (layer.kind !== "path") continue;
    // Path anchors are what a designer actually aims at.
    layer.points.forEach((point, pointIndex) => {
      const x = layer.x + point.x;
      const y = layer.y + point.y;
      index.points.push({ x, y, kind: "anchor", sourceId: `${layer.id}#${pointIndex}` });
      index.lines.push(
        { axis: "x", value: x, kind: "anchor", from: y, to: y, sourceId: `${layer.id}#${pointIndex}` },
        { axis: "y", value: y, kind: "anchor", from: x, to: x, sourceId: `${layer.id}#${pointIndex}` },
      );
    });
  }

  const width = options.layers ? undefined : doc.artboard.width;
  const height = options.layers ? undefined : doc.artboard.height;
  if (width && height) {
    index.lines.push(
      { axis: "x", value: 0, kind: "artboard-edge", from: 0, to: height },
      { axis: "x", value: width / 2, kind: "artboard-center", from: 0, to: height },
      { axis: "x", value: width, kind: "artboard-edge", from: 0, to: height },
      { axis: "y", value: 0, kind: "artboard-edge", from: 0, to: width },
      { axis: "y", value: height / 2, kind: "artboard-center", from: 0, to: width },
      { axis: "y", value: height, kind: "artboard-edge", from: 0, to: width },
    );
  }

  return index;
}

function guideForLine(line: SnapLine, other: number): Guide {
  // An x-line is drawn vertically, spanning from its source extent to the point
  // being snapped: that is the "these two are aligned" line the user reads.
  const low = Math.min(line.from, line.to, other);
  const high = Math.max(line.from, line.to, other);
  const pad = 6;
  return line.axis === "x"
    ? { axis: "x", at: line.value, from: low - pad, to: high + pad, kind: "align" }
    : { axis: "y", at: line.value, from: low - pad, to: high + pad, kind: "align" };
}

function nearestLine(index: SnapIndex, axis: SnapAxis, value: number, tolerance: number): SnapLine | null {
  let best: SnapLine | null = null;
  let bestDistance = tolerance;
  for (const line of index.lines) {
    if (line.axis !== axis) continue;
    const distance = Math.abs(line.value - value);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = line;
    }
  }
  return best;
}

function nearestPoint(index: SnapIndex, point: Pt, tolerance: number): SnapPointTarget | null {
  let best: SnapPointTarget | null = null;
  let bestDistance = tolerance;
  for (const target of index.points) {
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

function gridSnap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * Snap a POINT (a node, an endpoint, a corner being dragged).
 *
 * Order: a full point target wins (both axes, one anchor), otherwise each axis
 * snaps to its nearest alignment line, otherwise the grid. The returned guides
 * describe exactly the lines that were used.
 */
export function snapPointSmart(point: Pt, index: SnapIndex, options: SnapOptions = {}): SnapResult {
  const tolerance = options.tolerance ?? SNAP_TOLERANCE_DEFAULT;
  const target = nearestPoint(index, point, tolerance);
  if (target) {
    return {
      x: target.x,
      y: target.y,
      snappedX: true,
      snappedY: true,
      kind: target.kind,
      targetId: target.sourceId,
      guides: [
        { axis: "x", at: target.x, from: Math.min(target.y, point.y), to: Math.max(target.y, point.y), kind: "align" },
        { axis: "y", at: target.y, from: Math.min(target.x, point.x), to: Math.max(target.x, point.x), kind: "align" },
      ],
    };
  }

  const lineX = nearestLine(index, "x", point.x, tolerance);
  const lineY = nearestLine(index, "y", point.y, tolerance);
  const devX = lineX ? Math.abs(lineX.value - point.x) : Infinity;
  const devY = lineY ? Math.abs(lineY.value - point.y) : Infinity;

  const allowX = !options.axisLock || devX <= devY;
  const allowY = !options.axisLock || devY <= devX;
  const useX = !!lineX && allowX;
  const useY = !!lineY && allowY;

  const snappedX = useX ? lineX!.value : options.grid ? gridSnap(point.x, options.grid) : point.x;
  const snappedY = useY ? lineY!.value : options.grid ? gridSnap(point.y, options.grid) : point.y;

  const guides: Guide[] = [];
  if (useX) guides.push(guideForLine(lineX!, point.y));
  if (useY) guides.push(guideForLine(lineY!, point.x));

  return {
    x: snappedX,
    y: snappedY,
    snappedX: useX,
    snappedY: useY,
    kind: useX ? lineX!.kind : useY ? lineY!.kind : options.grid ? "grid" : null,
    targetId: (useX ? lineX!.sourceId : undefined) ?? (useY ? lineY!.sourceId : undefined),
    guides,
  };
}

/**
 * Snap a BOX (a layer being moved or resized) to the index.
 *
 * Left/centre/right and top/middle/bottom are all candidates; the smallest
 * correction wins per axis, which is what makes a box "click" into place.
 */
export function snapBoxToIndex(
  rect: Rect,
  index: SnapIndex,
  options: SnapOptions = {},
): { dx: number; dy: number; guides: Guide[]; snappedX: boolean; snappedY: boolean } {
  const tolerance = options.tolerance ?? SNAP_TOLERANCE_DEFAULT;
  // Start / middle / end of the box on one axis — three chances to click in.
  const edges = (rectValue: number, size: number) => [rectValue, rectValue + size / 2, rectValue + size];

  const pick = (axis: SnapAxis, rectStart: number, size: number) => {
    let best: { delta: number; line: SnapLine } | null = null;
    for (const edge of edges(rectStart, size)) {
      const line = nearestLine(index, axis, edge, tolerance);
      if (!line) continue;
      const delta = line.value - edge;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line };
    }
    return best;
  };

  const bestX = pick("x", rect.x, rect.width);
  const bestY = pick("y", rect.y, rect.height);
  const guides: Guide[] = [];
  if (bestX) guides.push(guideForLine(bestX.line, rect.y + rect.height / 2));
  if (bestY) guides.push(guideForLine(bestY.line, rect.x + rect.width / 2));

  return {
    dx: bestX ? bestX.delta : options.grid ? gridSnap(rect.x, options.grid) - rect.x : 0,
    dy: bestY ? bestY.delta : options.grid ? gridSnap(rect.y, options.grid) - rect.y : 0,
    guides,
    snappedX: !!bestX,
    snappedY: !!bestY,
  };
}

function overlaps(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return Math.min(a.to, b.to) - Math.max(a.from, b.from) > 0;
}

/**
 * Equal-spacing guides: when a box sits between two others so that BOTH gaps are
 * the same, Figma shows the two measurements. That is the rule implemented here
 * (the classic "spacing" hint), per axis.
 */
export function equalSpacingGuides(
  rect: Rect,
  others: Rect[],
  options: { tolerance?: number; axis?: SnapAxis } = {},
): Guide[] {
  const tolerance = options.tolerance ?? 1.5;
  const axis: SnapAxis = options.axis ?? "x";
  const span = (r: Rect) =>
    axis === "x" ? { from: r.y, to: r.y + r.height } : { from: r.x, to: r.x + r.width };
  const along = (r: Rect) => (axis === "x" ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height });

  const rectSpan = span(rect);
  const rectAlong = along(rect);
  const related = others.filter((other) => overlaps(span(other), rectSpan));

  const before = related
    .map(along)
    .filter((other) => other.end <= rectAlong.start)
    .sort((a, b) => b.end - a.end)[0];
  const after = related
    .map(along)
    .filter((other) => other.start >= rectAlong.end)
    .sort((a, b) => a.start - b.start)[0];
  if (!before || !after) return [];

  const gapBefore = rectAlong.start - before.end;
  const gapAfter = after.start - rectAlong.end;
  if (Math.abs(gapBefore - gapAfter) > tolerance) return [];

  const gap = Math.round(((gapBefore + gapAfter) / 2) * 10) / 10;
  const mid = axis === "x" ? rect.y + rect.height / 2 : rect.x + rect.width / 2;
  return [
    { axis, at: (before.end + rectAlong.start) / 2, from: mid, to: mid, kind: "spacing", label: String(gap) },
    { axis, at: (rectAlong.end + after.start) / 2, from: mid, to: mid, kind: "spacing", label: String(gap) },
  ];
}

/** Distance readout between two points (the Alt-hover measurement). */
export function measureBetween(a: Pt, b: Pt): {
  dx: number;
  dy: number;
  distance: number;
  label: string;
  guides: Guide[];
} {
  const round = (value: number) => Math.round(value * 10) / 10;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  return {
    dx: round(dx),
    dy: round(dy),
    distance: round(distance),
    label: `${round(distance)} px`,
    guides: [
      { axis: "y", at: a.y, from: a.x, to: b.x, kind: "spacing", label: `${round(Math.abs(dx))}` },
      { axis: "x", at: b.x, from: a.y, to: b.y, kind: "spacing", label: `${round(Math.abs(dy))}` },
    ],
  };
}
