/**
 * Boolean path operations — union / subtract / intersect / exclude.
 *
 * The pipeline is the SAME planar-graph machine the Live-Paint regions use,
 * just driven differently:
 *
 *     operands ─▶ flatten ─▶ weld T-junctions ─▶ planar graph (half-edges)
 *              ─▶ face walk ─▶ classify each face (inside which operands?)
 *              ─▶ pick the faces the predicate keeps
 *              ─▶ keep only the EDGES with the result on one side
 *              ─▶ stitch those edges into closed loops ─▶ refit to Bézier
 *
 * WHY FACES AND NOT SEGMENTS
 * --------------------------
 * The naive implementation intersects every pair of segments and keeps the
 * pieces that "look" inside — which is exactly where famous boolean bugs come
 * from (double edges, seams, self-intersections). Working on the ARRANGEMENT
 * makes the answer exact: every point of the plane belongs to exactly one face,
 * a face is in or out as a whole, and the boundary of the answer is the set of
 * edges that separate an "in" face from an "out" face.
 *
 * Area therefore needs no approximation at all: the result's area is the SUM of
 * the signed areas of the kept faces (they are disjoint by construction), and
 * the output loops are oriented so that sum is exactly the signed area of the
 * emitted geometry. That identity is what the tests assert.
 *
 * Pure: no DOM, no React, no document — only geometry in, geometry out.
 */

import {
  flattenSubPaths,
  pointInContours,
  polygonSignedArea,
  type FillRule,
  type Pt,
  type SubPath,
} from "./canonical";
import { buildPlanarGraph, projectOnSegment } from "./regions";
import { ramerDouglasPeucker, smoothAnchorAt, type PathPoint } from "../path";

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

export const BOOLEAN_OP_LABELS: Record<BooleanOp, string> = {
  union: "اجتماع",
  subtract: "تفریق",
  intersect: "اشتراک",
  exclude: "تفاضل متقارن",
};

/** One shape taking part in the operation (already in world coordinates). */
export type BooleanOperand = {
  id: string;
  subpaths: SubPath[];
  /** The operand's own fill rule (§13); defaults to `nonzero`, the SVG default. */
  fillRule?: FillRule;
};

export type BooleanOptions = {
  /** Flattening tolerance in px (default 0.35 — finer than the Live-Paint pass). */
  flattenTolerance?: number;
  /** A vertex this close to an edge is welded INTO that edge (T-junctions). */
  weldTolerance?: number;
  /** RDP epsilon for the Bézier refit, in px. */
  fitTolerance?: number;
  /** Turn angle (degrees) up to which a fitted anchor is smoothed, not cornered. */
  smoothAngle?: number;
  /** Faces below this area are numerical dust and are dropped (px²). */
  minArea?: number;
};

export const DEFAULT_BOOLEAN_OPTIONS: Required<BooleanOptions> = {
  flattenTolerance: 0.35,
  weldTolerance: 0.01,
  fitTolerance: 0.35,
  smoothAngle: 24,
  minArea: 0.01,
};

export type BooleanResult = {
  op: BooleanOp;
  /**
   * Boundary loops in world space. Orientation carries meaning: the result is
   * always on the LEFT of the travel direction, so outer loops come out CCW
   * (positive area) and holes CW (negative area) and the areas sum to the
   * area of the filled result.
   */
  loops: Pt[][];
  /** Signed area of the result (exact within the flattening tolerance). */
  area: number;
  /** No area survived the predicate (e.g. intersecting two disjoint shapes). */
  empty: boolean;
  /** Ids of the operands that contributed at least one boundary loop. */
  contributorIds: string[];
  /** Editable closed Bézier loops (world space) — the layer's new geometry. */
  anchorLoops: PathPoint[][];
};

/* ------------------------------------------------------------------ */
/* Input preparation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Weld vertices that lie ON an edge of another contour into that contour.
 *
 * Two cases need it, and both are ordinary user input:
 *   - T-JUNCTION — a corner that lands exactly on another path's edge;
 *   - COLLINEAR OVERLAP — two aligned rectangles sharing part of an edge.
 *
 * Without this the planar graph is not an arrangement (the shared point is not a
 * node of both curves), the face walk mis-partitions the plane and the boolean
 * result has a spurious wall along the joint. Only vertices are inserted; the
 * input coordinates are never moved, so the boolean is exact.
 */
export function insertTJunctions(contours: Pt[][], tolerance = 0.01): Pt[][] {
  const vertices = contours.flat();
  return contours.map((contour) => {
    if (contour.length < 3) return contour.map((point) => ({ x: point.x, y: point.y }));
    const out: Pt[] = [];
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      out.push({ x: a.x, y: a.y });
      const cuts: { t: number; at: Pt }[] = [];
      for (const vertex of vertices) {
        const projection = projectOnSegment(vertex, a, b);
        if (projection.distance > tolerance) continue;
        // Only INTERIOR hits split an edge; the endpoints are already nodes.
        if (projection.t <= 1e-9 || projection.t >= 1 - 1e-9) continue;
        cuts.push({ t: projection.t, at: { x: vertex.x, y: vertex.y } });
      }
      cuts.sort((x, y) => x.t - y.t);
      for (const cut of cuts) {
        const last = out[out.length - 1];
        if (Math.abs(last.x - cut.at.x) <= 1e-12 && Math.abs(last.y - cut.at.y) <= 1e-12) continue;
        out.push(cut.at);
      }
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Planar arrangement                                                  */
/* ------------------------------------------------------------------ */

type Arrangement = {
  nodePoints: Pt[];
  halfEdges: ReturnType<typeof buildPlanarGraph>["halfEdges"];
  /** Face id per half-edge (every half-edge belongs to exactly one face). */
  faceOf: number[];
  /** Half-edge ids per face, in walk order (the face is on the LEFT of each). */
  faceEdges: number[][];
  /** Outgoing half-edges around each node, sorted counter-clockwise by angle. */
  outgoing: Map<number, number[]>;
};

/**
 * Drop DUPLICATE edge pairs.
 *
 * Two operands that share an edge (aligned rectangles) or are identical (the
 * union of a shape with itself) contribute two coincident half-edge pairs. A
 * subdivision cannot contain a zero-width face: those corridors make the face
 * walk emit degenerate loops whose probes land on either side of the seam, so
 * the whole interior can be classified as outside. Keeping the first pair
 * restores a proper arrangement, and since both sides are the same two faces,
 * nothing is lost.
 */
function compactEdgePairs(halfEdges: ReturnType<typeof buildPlanarGraph>["halfEdges"]) {
  type Edge = (typeof halfEdges)[number];
  const kept: Edge[] = [];
  const seen = new Set<string>();
  for (let index = 0; index + 1 < halfEdges.length; index += 2) {
    const forward = halfEdges[index];
    const key = forward.from <= forward.to ? `${forward.from}:${forward.to}` : `${forward.to}:${forward.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...forward, id: kept.length, twin: kept.length + 1, used: false });
    kept.push({ ...halfEdges[index + 1], id: kept.length, twin: kept.length - 1, used: false });
  }
  return kept;
}

/**
 * The face walk over the half-edge graph.
 *
 * The step is the standard one (and the same one `extractFaces` uses): from a
 * half-edge, the next edge of the SAME face is the edge immediately before its
 * twin in counter-clockwise order around the shared node. Every face — including
 * the unbounded outer face — therefore comes out with the face on the LEFT of
 * its edges, which is the invariant the rest of this module relies on.
 */
function buildArrangement(operands: BooleanOperand[], options: Required<BooleanOptions>): Arrangement {
  const sources = operands.map((operand) => {
    const flattened = flattenSubPaths(operand.subpaths, options.flattenTolerance);
    // A boolean operand is an AREA: an open subpath is implicitly closed, the
    // same way Illustrator's Pathfinder treats an open path as a shape.
    const contours = insertTJunctions(
      flattened.map((poly) => poly.points),
      options.weldTolerance,
    );
    return { id: operand.id, polylines: contours.map((points) => ({ points, closed: true })) };
  });

  const graph = buildPlanarGraph(sources, { gapTolerance: 0, flattenTolerance: options.flattenTolerance });
  const nodePoints = graph.nodePoints;
  const halfEdges = compactEdgePairs(graph.halfEdges);

  const outgoing = new Map<number, number[]>();
  for (const edge of halfEdges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.id);
    outgoing.set(edge.from, list);
  }
  for (const list of outgoing.values()) {
    list.sort((x, y) => halfEdges[x].angle - halfEdges[y].angle);
  }

  const nextAroundNode = (id: number): number => {
    const twin = halfEdges[id].twin;
    const around = outgoing.get(halfEdges[twin].from) ?? [];
    const index = around.indexOf(twin);
    if (index === -1) return -1;
    return around[(index - 1 + around.length) % around.length];
  };

  const faceOf = new Array<number>(halfEdges.length).fill(-1);
  const faceEdges: number[][] = [];
  for (const start of halfEdges) {
    if (start.used) continue;
    const edges: number[] = [];
    let current = start.id;
    let guard = 0;
    while (guard <= halfEdges.length + 1) {
      guard += 1;
      const edge = halfEdges[current];
      if (edge.used) break;
      edge.used = true;
      faceOf[current] = faceEdges.length;
      edges.push(current);
      const next = nextAroundNode(current);
      if (next === -1 || next === start.id) break;
      current = next;
    }
    if (edges.length > 0) faceEdges.push(edges);
  }

  return { nodePoints, halfEdges, faceOf, faceEdges, outgoing };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const PROBE_EPSILON = 2e-4;

/**
 * A point strictly INSIDE the face that lies to the left of half-edge `id`.
 *
 * Offsetting the edge midpoint along the left normal by a hair is the whole
 * trick: the face is an open region, so a point a fraction of a pixel inside it
 * is unambiguously part of it — no nesting, hole or winding bookkeeping needed,
 * which is what makes the classification below immune to the hard cases
 * (a face with a hole, a face inside a face, a shape touching another).
 */
function probeLeftOfEdge(edgeId: number, arrangement: Arrangement): Pt {
  const edge = arrangement.halfEdges[edgeId];
  const a = arrangement.nodePoints[edge.from];
  const b = arrangement.nodePoints[edge.to];
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // Left normal of (dx, dy) is (-dy, dx).
  return { x: midX - (dy / length) * PROBE_EPSILON, y: midY + (dx / length) * PROBE_EPSILON };
}

/** Should a face whose containment vector is `inside` survive `op`? */
export function booleanPredicate(inside: boolean[], op: BooleanOp): boolean {
  switch (op) {
    case "union":
      return inside.some(Boolean);
    case "intersect":
      return inside.length > 0 && inside.every(Boolean);
    case "subtract":
      // The FIRST operand is the base; every other one is cut away.
      return inside[0] === true && !inside.slice(1).some(Boolean);
    case "exclude":
      return inside.filter(Boolean).length % 2 === 1;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function booleanContours(
  operands: BooleanOperand[],
  op: BooleanOp,
  options: BooleanOptions = {},
): BooleanResult {
  const settings = { ...DEFAULT_BOOLEAN_OPTIONS, ...options };
  const empty: BooleanResult = { op, loops: [], area: 0, empty: true, contributorIds: [], anchorLoops: [] };
  if (operands.length === 0) return empty;

  const operandContours = operands.map((operand) => ({
    contours: flattenSubPaths(operand.subpaths, settings.flattenTolerance).map((poly) => poly.points),
    fillRule: (operand.fillRule ?? "nonzero") as FillRule,
  }));

  const arrangement = buildArrangement(operands, settings);
  if (arrangement.faceEdges.length === 0) return empty;

  // Classify every face: sample up to three of its longest edges (a long edge is
  // the most reliable probe) and take the majority verdict, so one unlucky probe
  // near a sliver cannot flip a whole face.
  const faceSelected: boolean[] = arrangement.faceEdges.map((edges) => {
    const ordered = [...edges].sort((x, y) => {
      const lx = Math.hypot(
        arrangement.nodePoints[arrangement.halfEdges[x].to].x - arrangement.nodePoints[arrangement.halfEdges[x].from].x,
        arrangement.nodePoints[arrangement.halfEdges[x].to].y - arrangement.nodePoints[arrangement.halfEdges[x].from].y,
      );
      const ly = Math.hypot(
        arrangement.nodePoints[arrangement.halfEdges[y].to].x - arrangement.nodePoints[arrangement.halfEdges[y].from].x,
        arrangement.nodePoints[arrangement.halfEdges[y].to].y - arrangement.nodePoints[arrangement.halfEdges[y].from].y,
      );
      return ly - lx;
    });
    const samples = ordered.slice(0, 3);
    let votes = 0;
    for (const edgeId of samples) {
      const probe = probeLeftOfEdge(edgeId, arrangement);
      const inside = operandContours.map((operand) => pointInContours(probe, operand.contours, operand.fillRule));
      if (booleanPredicate(inside, op)) votes += 1;
    }
    return votes * 2 > samples.length;
  });

  // The boundary of the result = edges with a kept face on exactly one side.
  const isBoundary = (edgeId: number): boolean =>
    faceSelected[arrangement.faceOf[edgeId]] !== faceSelected[arrangement.faceOf[arrangement.halfEdges[edgeId].twin]];

  /**
   * The next edge of the result's boundary after `id`.
   *
   * Rotating CLOCKWISE from the reversed incoming direction (the same rotation
   * the face walk uses) and taking the first edge that is STILL a boundary with
   * the result on its left skips the interior joints between two kept faces —
   * which is exactly why two faces of the answer merge into one clean loop with
   * no seam where they meet.
   */
  const nextBoundary = (id: number): number => {
    const twin = arrangement.halfEdges[id].twin;
    const around = arrangement.outgoing.get(arrangement.halfEdges[twin].from) ?? [];
    const index = around.indexOf(twin);
    if (index === -1) return -1;
    for (let step = 1; step <= around.length; step += 1) {
      const candidate = around[(index - step + around.length * 2) % around.length];
      if (faceSelected[arrangement.faceOf[candidate]] && isBoundary(candidate)) return candidate;
    }
    return -1;
  };

  const used = new Set<number>();
  const loops: Pt[][] = [];
  for (const edgeId of arrangement.halfEdges.map((edge) => edge.id)) {
    if (!isBoundary(edgeId) || !faceSelected[arrangement.faceOf[edgeId]] || used.has(edgeId)) continue;
    const points: Pt[] = [];
    let current = edgeId;
    let guard = 0;
    while (guard <= arrangement.halfEdges.length + 1) {
      guard += 1;
      if (used.has(current)) break;
      used.add(current);
      const edge = arrangement.halfEdges[current];
      points.push({ ...arrangement.nodePoints[edge.from] });
      const next = nextBoundary(current);
      if (next === -1 || next === edgeId) break;
      current = next;
    }
    if (points.length < 3) continue;
    const area = polygonSignedArea(points);
    if (Math.abs(area) < settings.minArea) continue; // numerical dust
    loops.push(points);
  }

  if (loops.length === 0) return empty;

  const contributorIds = new Set<string>();
  for (const edge of arrangement.halfEdges) {
    const face = arrangement.faceOf[edge.id];
    if (face < 0 || !faceSelected[face]) continue;
    if (isBoundary(edge.id)) contributorIds.add(edge.pathId);
  }

  const area = loops.reduce((sum, loop) => sum + polygonSignedArea(loop), 0);
  return {
    op,
    loops,
    area,
    empty: false,
    contributorIds: [...contributorIds].sort(),
    anchorLoops: loops.map((loop) => refitLoop(loop, settings)),
  };
}

/* ------------------------------------------------------------------ */
/* Polyline ▶ editable Bézier                                          */
/* ------------------------------------------------------------------ */

/** Signed turn (degrees) of the path at `b`, + = turning left. */
function turnAngle(a: Pt, b: Pt, c: Pt): number {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = c.x - b.x;
  const d2y = c.y - b.y;
  if ((d1x === 0 && d1y === 0) || (d2x === 0 && d2y === 0)) return 0;
  const cross = d1x * d2y - d1y * d2x;
  const dot = d1x * d2x + d1y * d2y;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/**
 * Turn one boundary polyline into an editable closed Bézier loop.
 *
 * Two passes:
 *   1. Ramer–Douglas–Peucker at `fitTolerance` — a straight edge stays ONE
 *      anchor (so a union of rectangles is a rectangle, not a 40-node polygon);
 *   2. per-anchor: a gentle turn becomes a smooth anchor with tangent handles,
 *      anything sharper stays a corner. That is what keeps a curve curved and a
 *      corner sharp, instead of smoothing the whole outline (which would round
 *      every right angle) or cornering it (which would facet every circle).
 *
 * The result is an ORDINARY anchor list: closed, no duplicated end point, ready
 * for the node editor and for `normalizePathLayer`.
 */
export function refitLoop(
  loop: Pt[],
  options: { fitTolerance?: number; smoothAngle?: number } = {},
): PathPoint[] {
  const epsilon = options.fitTolerance ?? DEFAULT_BOOLEAN_OPTIONS.fitTolerance;
  const smoothAngle = options.smoothAngle ?? DEFAULT_BOOLEAN_OPTIONS.smoothAngle;
  if (loop.length < 3) return loop.map((point) => ({ x: point.x, y: point.y, hIn: null, hOut: null }));

  // RDP needs the loop OPEN: duplicating the first point at the end keeps both
  // of its endpoints and yields the loop back with the duplicate removed.
  const reduced = ramerDouglasPeucker([...loop, loop[0]], epsilon);
  const anchors: PathPoint[] = reduced
    .slice(0, -1)
    .map((point) => ({ x: point.x, y: point.y, hIn: null, hOut: null }));
  if (anchors.length < 3) return anchors;

  let points = anchors;
  for (let index = 0; index < points.length; index += 1) {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (Math.abs(turnAngle(prev, points[index], next)) > smoothAngle) continue;
    points = smoothAnchorAt(points, index, true);
  }
  return points;
}
