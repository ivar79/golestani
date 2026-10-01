/**
 * Region / face system — the Live-Paint model, engine side.
 *
 *     paths ─▶ flatten ─▶ (virtual) gap closure ─▶ split at intersections
 *           ─▶ planar graph (half-edges) ─▶ face walk ─▶ Region objects
 *
 * A REGION IS NOT A PATH. Paths stay exactly as the user drew them; a region is
 * an enclosed area discovered from where those paths cross. Paint is stored on
 * the region, so restyling never rewrites (or corrupts) the source geometry.
 *
 * GAP TOLERANCE (§12) is VIRTUAL ONLY: endpoints that sit within `gapTolerance`
 * of each other are pulled together inside this module's own private copy of
 * the geometry. The document's anchors are never touched — a 4px gap still
 * reads as 4px in the inspector, but the topology treats it as closed.
 *
 * Pure: no DOM, no React.
 */

import {
  flattenSubPaths,
  polygonSignedArea,
  pointInContours,
  type FillRule,
  type FlatPolyline,
  type Pt,
} from "./canonical";

/** A path offered to the region builder (already world-space geometry). */
export type RegionSourcePath = {
  id: string;
  polylines: FlatPolyline[];
};

export type RegionFace = {
  /**
   * Stable topology key: the sorted ids of the paths that bound this face plus
   * a quantised centroid. Survives re-rendering, and is what region paint is
   * keyed by so an edit can remap styles instead of losing them (§11).
   */
  id: string;
  /** Outer boundary loop, world space, closed (first point is NOT repeated). */
  points: Pt[];
  /**
   * Loops fully enclosed by `points` (a nested path drawn inside this face).
   * Hit-testing is even-odd over `[points, ...holes]`, so the donut's middle is
   * correctly NOT part of the face.
   */
  holes: Pt[][];
  /** Signed area (shoelace) of the OUTER loop. Positive/negative is the walk orientation. */
  area: number;
  centroid: Pt;
  /** Source paths that contributed at least one edge to this boundary. */
  pathIds: string[];
  /** How many other faces contain this one (0 = outermost). */
  depth: number;
};

export type RegionOptions = {
  /**
   * Endpoints closer than this are treated as joined for TOPOLOGY only
   * (Inkscape's "close gaps"). 0 disables it.
   */
  gapTolerance?: number;
  /** Area below this (px²) is noise and dropped. */
  minArea?: number;
  /** Flattening tolerance in px. */
  flattenTolerance?: number;
  /**
   * SVG fill rule (§13) used to resolve overlapping contours into faces. Faces
   * are painted with the same rule, so what you see is what the hit test
   * selects. Defaults to `nonzero` (the SVG default).
   */
  fillRule?: FillRule;
};

export const DEFAULT_REGION_OPTIONS: Required<RegionOptions> = {
  gapTolerance: 0,
  minArea: 4,
  flattenTolerance: 0.6,
  fillRule: "nonzero",
};

/* ------------------------------------------------------------------ */
/* Intersections                                                       */
/* ------------------------------------------------------------------ */

type Split = { t: number; point: Pt };

/**
 * Intersection parameters of two segments.
 *
 * Returns the crossing point plus `tOnA`/`tOnB`, or `null` for parallel.
 * Collinear overlap is intentionally NOT split here: the endpoints of collinear
 * segments already exist as vertices, so the graph stays connected without it.
 */
export function segmentIntersection(
  a0: Pt, a1: Pt, b0: Pt, b1: Pt,
): { point: Pt; tOnA: number; tOnB: number } | null {
  const rx = a1.x - a0.x;
  const ry = a1.y - a0.y;
  const sx = b1.x - b0.x;
  const sy = b1.y - b0.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;

  const qpx = b0.x - a0.x;
  const qpy = b0.y - a0.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;

  const clampedT = Math.max(0, Math.min(1, t));
  return {
    point: { x: a0.x + rx * clampedT, y: a0.y + ry * clampedT },
    tOnA: clampedT,
    tOnB: Math.max(0, Math.min(1, u)),
  };
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

type HalfEdge = {
  id: number;
  from: number;
  to: number;
  twin: number;
  pathId: string;
  /** Angle of this half-edge around its `from` node (for the face walk). */
  angle: number;
  used: boolean;
};

const QUANT = 1e-6;

/** Closest point on segment a→b, with the parameter clamped to the segment. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; distance: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y), t };
}

function keyOf(p: Pt): string {
  return `${Math.round(p.x / QUANT)}:${Math.round(p.y / QUANT)}`;
}

/**
 * A polyline plus the path it came from. Gap closure needs the whole drawing at
 * once (a gap between TWO different paths is the common case), so the owner is
 * carried alongside instead of being inferred from an array index.
 */
type TaggedPolyline = { polyline: FlatPolyline; owner: number };

/**
 * Pull near-coincident endpoints together in a PRIVATE copy of the geometry.
 *
 * Only endpoints are moved (interior vertices keep their position), which is
 * exactly what "close the gap between two strokes" needs and avoids dragging a
 * whole edge sideways.
 *
 * Two kinds of gap are closed:
 *   1. END TO END — two loose ends that nearly meet;
 *   2. END TO EDGE (T-junction) — an end that stops just short of another path's
 *      edge, which is what a divider drawn towards a frame actually looks like.
 *
 * Neither touches the document: only this private copy moves, so the inspector
 * still reports (and the next save still stores) the original gap.
 */
function closeGapsTagged(entries: TaggedPolyline[], tolerance: number): TaggedPolyline[] {
  const copy: TaggedPolyline[] = entries.map((entry) => ({
    owner: entry.owner,
    polyline: {
      closed: entry.polyline.closed,
      points: entry.polyline.points.map((p) => ({ ...p })),
    },
  }));
  if (tolerance <= 0) return copy;

  // Endpoints of open polylines are candidates; closed loops are already sealed.
  const endpoints: { poly: number; index: number; point: Pt }[] = [];
  copy.forEach((entry, pi) => {
    const poly = entry.polyline;
    if (poly.closed) return;
    if (poly.points.length < 2) return;
    endpoints.push({ poly: pi, index: 0, point: poly.points[0] });
    endpoints.push({ poly: pi, index: poly.points.length - 1, point: poly.points[poly.points.length - 1] });
  });
  if (endpoints.length === 0) return copy;

  const tolsq = tolerance * tolerance;
  const welded = new Set<number>();
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const a = endpoints[i];
      const b = endpoints[j];
      const dsq = (a.point.x - b.point.x) ** 2 + (a.point.y - b.point.y) ** 2;
      if (dsq > tolsq) continue;
      // Snap b's endpoint onto a's (a is the earlier sample, so the result is
      // deterministic for a given input order).
      const merged = { ...a.point };
      copy[b.poly].polyline.points[b.index] = merged;
      b.point = merged;
      welded.add(j);
    }
  }

  endpoints.forEach((endpoint, index) => {
    if (welded.has(index)) return; // already welded end-to-end
    let bestPoint: Pt | null = null;
    let bestDistance = tolerance;
    for (let pi = 0; pi < copy.length; pi += 1) {
      const poly = copy[pi].polyline;
      if (pi === endpoint.poly || poly.points.length < 2) continue; // never self-project
      const segmentCount = poly.closed ? poly.points.length : poly.points.length - 1;
      for (let i = 0; i < segmentCount; i += 1) {
        const projection = projectOnSegment(
          endpoint.point,
          poly.points[i],
          poly.points[(i + 1) % poly.points.length],
        );
        if (projection.distance > bestDistance) continue;
        bestDistance = projection.distance;
        bestPoint = projection.point;
      }
    }
    if (!bestPoint) return;
    copy[endpoint.poly].polyline.points[endpoint.index] = { ...bestPoint };
    endpoint.point = bestPoint;
  });

  // Drop whole polylines that collapsed to a point (both ends merged).
  return copy; // (degenerate entries are ignored by the edge builder)
}

/** Public single-path form: close gaps inside ONE path's own polylines. */
export function closeGapsVirtually(polylines: FlatPolyline[], tolerance: number): FlatPolyline[] {
  return closeGapsTagged(polylines.map((polyline) => ({ polyline, owner: 0 })), tolerance)
    .map((entry) => entry.polyline)
    .filter((poly) => poly.points.length >= 2);
}

/**
 * Build the planar subdivision from flattened paths.
 *
 * Steps: collect raw edges → split every edge at every crossing → insert the
 * resulting sub-edges into a half-edge graph with deduplicated nodes.
 */
export function buildPlanarGraph(paths: RegionSourcePath[], options: RegionOptions = {}) {
  const { gapTolerance } = { ...DEFAULT_REGION_OPTIONS, ...options };
  // Gap closure is a WHOLE-DRAWING pass: an endpoint of one path has to be able
  // to reach the edge of another, which is the normal case for the Live-Paint
  // "close gaps" control. Ownership is carried through and restored below.
  const tagged: TaggedPolyline[] = [];
  paths.forEach((path, pi) => {
    for (const polyline of path.polylines) tagged.push({ polyline, owner: pi });
  });
  const closed: FlatPolyline[][] = paths.map(() => []);
  for (const entry of closeGapsTagged(tagged, gapTolerance)) {
    if (entry.polyline.points.length < 2) continue;
    closed[entry.owner].push(entry.polyline);
  }

  type RawEdge = { a: Pt; b: Pt; pathId: string };
  const raw: RawEdge[] = [];
  closed.forEach((polylines, pi) => {
    const pathId = paths[pi].id;
    for (const poly of polylines) {
      const pts = poly.points;
      const last = poly.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < last; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) raw.push({ a, b, pathId });
      }
    }
  });

  // Split each edge at every intersection with any other edge.
  const splits: Split[][] = raw.map(() => []);
  for (let i = 0; i < raw.length; i += 1) {
    for (let j = i + 1; j < raw.length; j += 1) {
      const hit = segmentIntersection(raw[i].a, raw[i].b, raw[j].a, raw[j].b);
      if (!hit) continue;
      if (hit.tOnA > 1e-9 && hit.tOnA < 1 - 1e-9) splits[i].push({ t: hit.tOnA, point: hit.point });
      if (hit.tOnB > 1e-9 && hit.tOnB < 1 - 1e-9) splits[j].push({ t: hit.tOnB, point: hit.point });
    }
  }

  const nodes = new Map<string, number>();
  const nodePoints: Pt[] = [];
  const halfEdges: HalfEdge[] = [];

  const nodeAt = (p: Pt): number => {
    const key = keyOf(p);
    const existing = nodes.get(key);
    if (existing !== undefined) return existing;
    const id = nodePoints.length;
    nodePoints.push({ x: p.x, y: p.y });
    nodes.set(key, id);
    return id;
  };

  const addEdge = (a: Pt, b: Pt, pathId: string): void => {
    const from = nodeAt(a);
    const to = nodeAt(b);
    if (from === to) return;
    const forward: HalfEdge = {
      id: halfEdges.length, from, to, twin: halfEdges.length + 1, pathId,
      angle: Math.atan2(b.y - a.y, b.x - a.x), used: false,
    };
    const backward: HalfEdge = {
      id: halfEdges.length + 1, from: to, to: from, twin: halfEdges.length, pathId,
      angle: Math.atan2(a.y - b.y, a.x - b.x), used: false,
    };
    halfEdges.push(forward, backward);
  };

  const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  raw.forEach((edge, index) => {
    const cuts = splits[index].sort((x, y) => x.t - y.t);
    let cursor = edge.a;
    for (const cut of cuts) {
      addEdge(cursor, cut.point, edge.pathId);
      cursor = cut.point;
    }
    // Fall back to the exact endpoints for the tail (never a float-drifted t).
    addEdge(cursor, edge.b === edge.a ? lerp(edge.a, edge.b, 1) : edge.b, edge.pathId);
  });

  return { nodePoints, halfEdges };
}

/* ------------------------------------------------------------------ */
/* Face walk                                                           */
/* ------------------------------------------------------------------ */

/**
 * Extract the minimal faces of a planar graph.
 *
 * Standard half-edge traversal: from half-edge `e`, the next edge of the same
 * face is the one immediately AFTER `twin(e)` in clockwise order around
 * `e.to`, which walks each face's boundary exactly once.
 *
 * The unbounded outer face is identified by orientation — every inner face
 * comes out with the same sign, the outer one with the opposite — and dropped.
 */
export function extractFaces(paths: RegionSourcePath[], options: RegionOptions = {}): RegionFace[] {
  const settings = { ...DEFAULT_REGION_OPTIONS, ...options };
  const { nodePoints, halfEdges } = buildPlanarGraph(paths, options);
  if (halfEdges.length === 0) return [];

  // Outgoing half-edges per node, sorted counter-clockwise by angle.
  const outgoing = new Map<number, number[]>();
  for (const he of halfEdges) {
    const list = outgoing.get(he.from) ?? [];
    list.push(he.id);
    outgoing.set(he.from, list);
  }
  for (const list of outgoing.values()) {
    list.sort((x, y) => halfEdges[x].angle - halfEdges[y].angle);
  }

  const nextHalfEdge = (id: number): number => {
    const twin = halfEdges[id].twin;
    const around = outgoing.get(halfEdges[twin].from) ?? [];
    const index = around.indexOf(twin);
    if (index === -1) return -1;
    // Realise the node's winding around the target: step BACK one slot.
    return around[(index - 1 + around.length) % around.length];
  };

  const loops: { points: Pt[]; pathIds: string[] }[] = [];
  for (const start of halfEdges) {
    if (start.used) continue;
    const points: Pt[] = [];
    const pathIds = new Set<string>();
    let current = start.id;
    let guard = 0;
    while (guard <= halfEdges.length + 1) {
      guard += 1;
      const edge = halfEdges[current];
      if (edge.used) break;
      edge.used = true;
      points.push({ ...nodePoints[edge.from] });
      pathIds.add(edge.pathId);
      const next = nextHalfEdge(current);
      if (next === -1) break;
      if (next === start.id) break;
      current = next;
    }
    if (points.length >= 3) loops.push({ points, pathIds: [...pathIds].sort() });
  }

  if (loops.length === 0) return [];

  const withArea = loops.map((loop) => ({ ...loop, area: polygonSignedArea(loop.points) }));
  const significant = withArea.filter((loop) => Math.abs(loop.area) > settings.minArea);
  if (significant.length === 0) return [];

  // The unbounded face is the odd one out: the only loop whose orientation
  // disagrees with the majority (and the largest by |area|).
  const positives = significant.filter((loop) => loop.area > 0).length;
  const negatives = significant.length - positives;
  const outerSign = positives >= negatives ? -1 : 1;
  let inner = significant.filter((loop) => Math.sign(loop.area) !== outerSign);
  if (inner.length === 0) {
    const largest = significant.reduce((a, b) => (Math.abs(a.area) >= Math.abs(b.area) ? a : b));
    inner = significant.filter((loop) => loop !== largest);
  }

  // Nested loops: a loop strictly inside a LARGER loop is a hole of it. Without
  // this, a path drawn inside a closed shape would produce two overlapping
  // faces instead of one face with a hole.
  const sizes = inner.map((loop) => Math.abs(loop.area));
  const parentOf = new Map<number, number>();
  inner.forEach((loop, childIndex) => {
    const probe = polygonCentroid(loop.points);
    let parent = -1;
    let parentArea = Infinity;
    inner.forEach((candidate, candidateIndex) => {
      if (candidateIndex === childIndex) return;
      if (sizes[candidateIndex] <= sizes[childIndex] + settings.minArea) return;
      if (!pointInContours(probe, [candidate.points], settings.fillRule)) return;
      if (sizes[candidateIndex] < parentArea) {
        parentArea = sizes[candidateIndex];
        parent = candidateIndex;
      }
    });
    if (parent !== -1) parentOf.set(childIndex, parent);
  });

  const holesByLoop = new Map<number, Pt[][]>();
  for (const [child, parent] of parentOf) {
    const list = holesByLoop.get(parent) ?? [];
    list.push(inner[child].points);
    holesByLoop.set(parent, list);
  }

  // Search the geometry for a point guaranteed to be INSIDE the face: the outer
  // loop's polygon centroid can fall in a hole (think of a ring), which would
  // make every hit test on that region fail.
  const faces: RegionFace[] = inner.map((loop, index) => {
    const holes = holesByLoop.get(index) ?? [];
    const probe = interiorPoint(loop.points, holes);
    let depth = 0;
    for (let cursor = parentOf.get(index); cursor !== undefined; cursor = parentOf.get(cursor)) depth += 1;
    return {
      id: regionKey(loop.pathIds, probe),
      points: loop.points,
      holes,
      area: loop.area,
      centroid: probe,
      pathIds: loop.pathIds,
      depth,
    };
  });

  return faces.sort((a, b) => a.depth - b.depth || Math.abs(b.area) - Math.abs(a.area));
}

/**
 * Point-in-face test that honours the face's holes.
 *
 * `fillRule` defaults to even-odd because that is what makes a hole a hole in
 * the rendered result; passing the document's own rule (nonzero/evenodd) keeps
 * hit-testing and painting in agreement when the user overrides it.
 */
export function faceContainsPoint(face: RegionFace, point: Pt, fillRule: FillRule = "evenodd"): boolean {
  return pointInContours(point, [face.points, ...face.holes], fillRule);
}

/**
 * A point strictly inside the face described by `outer` minus its `holes`.
 *
 * Slice the shape at a few heights, walk the resulting spans and return the
 * midpoint of the first span that survives the even-odd test — the standard
 * "find an interior point" scan, immune to holes and concave outlines.
 *
 * Only THIS face's own loops are sliced: using every sibling loop would let a
 * neighbouring face's span be mistaken for this one's (two faces that split a
 * rectangle in half would both report the same probe and collide).
 */
export function interiorPoint(outer: Pt[], holes: Pt[][]): Pt {
  const loops = [outer, ...holes];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const candidates: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    candidates.push(minY + ((maxY - minY) * (i + 1)) / 6);
  }

  for (const y of candidates) {
    const xs: number[] = [];
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        if (a.y === b.y) continue;
        const low = Math.min(a.y, b.y);
        const high = Math.max(a.y, b.y);
        if (y < low || y >= high) continue;
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const mid = { x: (xs[i] + xs[i + 1]) / 2, y };
      if (pointInContours(mid, loops, "evenodd")) return mid;
    }
  }

  return polygonCentroid(outer);
}

export function polygonCentroid(points: Pt[]): Pt {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    // Degenerate (collinear) loop — fall back to the vertex average.
    const avg = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: avg.x / points.length, y: avg.y / points.length };
  }
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/** Quantised topology key: which paths bound the face + roughly where it is. */
export function regionKey(pathIds: string[], centroid: Pt): string {
  const qx = Math.round(centroid.x / 2) * 2;
  const qy = Math.round(centroid.y / 2) * 2;
  return `${pathIds.join("+")}@${qx},${qy}`;
}

/* ------------------------------------------------------------------ */
/* Region styles + topology remap (§11)                                */
/* ------------------------------------------------------------------ */

// Region paint lives in the DOCUMENT model (it is persisted); the geometry
// layer only needs its shape, so the type is imported rather than duplicated.
export type { RegionFillKind, RegionStyleEntry } from "../document";
import type { RegionStyleEntry } from "../document";

export type RegionStyle = RegionStyleEntry;

/**
 * Re-attach saved paint to freshly computed faces after a boundary edit (§11).
 *
 * Order of preference:
 *   1. exact topology key (nothing moved);
 *   2. same bounding path set + nearest centroid (the path was reshaped, the
 *      face is still the same area of the drawing);
 *   3. nearest centroid overall, within `maxDrift` (a path was added/removed).
 *
 * Styles with no surviving face are DROPPED rather than left at stale
 * coordinates — the failure mode Live Paint avoids.
 */
export function remapRegionStyles(
  previous: RegionStyle[],
  faces: RegionFace[],
  maxDrift = 220,
): RegionStyle[] {
  const remaining = [...faces];
  const out: RegionStyle[] = [];

  for (const style of previous) {
    const exact = remaining.findIndex((face) => face.id === style.key);
    if (exact !== -1) {
      out.push({ ...style, key: remaining[exact].id });
      remaining.splice(exact, 1);
      continue;
    }

    const pathIds = style.key.split("@")[0]?.split("+").filter(Boolean) ?? [];
    const sameBoundary = pathIds.length > 0
      ? remaining.filter((face) => pathIds.every((id) => face.pathIds.includes(id)))
      : [];
    const pool = sameBoundary.length > 0 ? sameBoundary : remaining;
    if (pool.length === 0) continue;

    let best = pool[0];
    let bestDistance = Infinity;
    for (const face of pool) {
      const distance = Math.hypot(face.centroid.x - centroidOfKey(style.key).x, face.centroid.y - centroidOfKey(style.key).y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = face;
      }
    }
    // A same-boundary match is trusted; a global one must be close by.
    if (sameBoundary.length === 0 && bestDistance > maxDrift) continue;

    out.push({ ...style, key: best.id });
    remaining.splice(remaining.indexOf(best), 1);
  }

  return out;
}

function centroidOfKey(key: string): Pt {
  const tail = key.split("@")[1];
  if (!tail) return { x: 0, y: 0 };
  const [x, y] = tail.split(",").map(Number);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * Build regions straight from path layers.
 *
 * `layers` are the PathLayers to consider (already filtered for hidden/locked
 * by the caller); each contributes its own flattened geometry.
 */
export function buildRegions(
  layers: { id: string; geometry: Parameters<typeof flattenSubPaths>[0] }[],
  options: RegionOptions = {},
): RegionFace[] {
  const sources: RegionSourcePath[] = layers.map((layer) => ({
    id: layer.id,
    polylines: flattenSubPaths(layer.geometry, options.flattenTolerance ?? DEFAULT_REGION_OPTIONS.flattenTolerance),
  }));
  return extractFaces(sources, options);
}
