/**
 * Geometry helpers — pure functions (no DOM, no React).
 *
 * fitZoom implements the research conclusion: fit = min(container/artboard).
 * keepInside clamps drag results so layers can never be lost off-artboard.
 * snapCenter / snapGuides implement the editor snapping contract.
 */
import { ARTBOARD, type CardDocument, type CardLayer } from "./document";

export function fitZoom(containerWidth: number, containerHeight: number, artboard = ARTBOARD): number {
  if (containerWidth <= 0 || containerHeight <= 0) return 1;
  return Math.min(containerWidth / artboard.width, containerHeight / artboard.height);
}

/** Clamp a dragged layer position so a margin of it stays reachable. */
export function keepInside(x: number, y: number, width: number, height: number, artboard = ARTBOARD): { x: number; y: number } {
  const margin = 12;
  const maxX = artboard.width - margin;
  const maxY = artboard.height - margin;
  return {
    x: Math.min(Math.max(x, -width + margin), maxX),
    y: Math.min(Math.max(y, -height + margin), maxY),
  };
}

export type Axis = "x" | "y";

/**
 * Snap an object's position to the artboard center line within a threshold
 * (design px). Works on both axes; `axis` selects which.
 */
export function snapCenter(value: number, size: number, axis: Axis = "x", threshold = 8, artboard = ARTBOARD): { value: number; snapped: boolean } {
  const center = value + size / 2;
  const target = axis === "x" ? artboard.width / 2 : artboard.height / 2;
  if (Math.abs(center - target) <= threshold) {
    return { value: target - size / 2, snapped: true };
  }
  return { value, snapped: false };
}

/** A candidate guide line produced by snapping. */
export type SnapGuide = {
  axis: Axis;
  /** The position of the guide line itself (design px). */
  at: number;
  /** Which of the dragged object's edges/center it matched. */
  edge: "start" | "center" | "end";
};

type Candidate = { axis: Axis; guides: number[]; size: number; pos: number };

/**
 * Full snapping pass for a dragged/transformed layer against:
 *  - artboard edges (0, width) and center
 *  - every other VISIBLE layer's start/center/end edges
 *
 * Returns the snapped position plus the guide lines to render.
 */
export function snapLayerPosition(
  doc: CardDocument,
  layerId: string,
  pos: { x: number; y: number },
  size: { width: number; height: number },
  threshold = 6,
  userGuides: readonly { axis: "x" | "y"; at: number }[] = [],
  angledGuides: readonly { x: number; y: number; angle: number }[] = [],
): { pos: { x: number; y: number }; guides: SnapGuide[] } {
  const board = doc.artboard;
  const others = doc.layers.filter((l) => l.id !== layerId && !l.hidden && l.opacity > 0);
  const guides: SnapGuide[] = [];
  const out = { ...pos };

  const run = (cfg: Candidate): void => {
    // Candidate target positions for the dragged object: its start, center and
    // end edge should each try to align with every candidate guide.
    const start = cfg.pos;
    const center = cfg.pos + cfg.size / 2;
    const end = cfg.pos + cfg.size;
    const tries: { edge: "start" | "center" | "end"; dragging: number; delta: number }[] = [
      { edge: "start", dragging: start, delta: 0 },
      { edge: "center", dragging: center, delta: -cfg.size / 2 },
      { edge: "end", dragging: end, delta: -cfg.size },
    ];
    for (const candidate of cfg.guides) {
      for (const t of tries) {
        const delta = candidate - t.dragging;
        if (Math.abs(delta) <= threshold) {
          const snapped = candidate + t.delta;
          if (cfg.axis === "x") out.x = snapped;
          else out.y = snapped;
          guides.push({ axis: cfg.axis, at: candidate, edge: t.edge });
          return; // first hit wins; further snapping fights over the same axis
        }
      }
    }
  };

  const xGuides = [0, board.width, board.width / 2, ...userGuides.filter(g => g.axis === "x").map(g => g.at)];
  const yGuides = [0, board.height, board.height / 2, ...userGuides.filter(g => g.axis === "y").map(g => g.at)];
  for (const other of others) {
    xGuides.push(other.x, other.x + other.width, other.x + other.width / 2);
    yGuides.push(other.y, other.y + other.height, other.y + other.height / 2);
  }

  run({ axis: "x", guides: xGuides, size: size.width, pos: pos.x });
  run({ axis: "y", guides: yGuides, size: size.height, pos: pos.y });

  // Angled guides snap any layer kind by its nearest box anchor. The entire
  // layer translates along the guide normal, keeping its dimensions unchanged.
  let bestAngled: { nx: number; ny: number; signed: number } | null = null;
  let bestDistance = threshold;
  const anchors = [
    { x: out.x, y: out.y },
    { x: out.x + size.width, y: out.y },
    { x: out.x + size.width, y: out.y + size.height },
    { x: out.x, y: out.y + size.height },
    { x: out.x + size.width / 2, y: out.y + size.height / 2 },
  ];
  for (const guide of angledGuides) {
    const radians = guide.angle * Math.PI / 180;
    const nx = -Math.sin(radians);
    const ny = Math.cos(radians);
    for (const anchor of anchors) {
      const signed = (anchor.x - guide.x) * nx + (anchor.y - guide.y) * ny;
      const distance = Math.abs(signed);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestAngled = { nx, ny, signed };
      }
    }
  }
  if (bestAngled) {
    out.x -= bestAngled.signed * bestAngled.nx;
    out.y -= bestAngled.signed * bestAngled.ny;
  }

  return { pos: out, guides };
}

/** Bounding box of a layer in artboard coords (accounts for rotation by the layer's own frame). */
export function layerBox(layer: CardLayer): { x: number; y: number; width: number; height: number } {
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

/**
 * Axis-aligned bounding box of a set of layer FRAMES.
 *
 * The group transform unit is derived, never stored: this is the single place
 * a selection's bounds are computed, and it intentionally uses each layer's own
 * frame (the same box the single-layer handles resize) rather than a rotated
 * hull — so a member's frame and its visual stay consistent.
 */
export function framesBounds(
  frames: { x: number; y: number; width: number; height: number }[],
): { x: number; y: number; width: number; height: number } | null {
  if (frames.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Snap ONE design-space coordinate to the artboard / visible-layer edge lines.
 *
 * Resizing is the reason this exists: the dragged edge IS the pointer
 * coordinate, so snapping the coordinate lands the edge exactly on the guide.
 * Returns the snapped value plus the guide to draw (null when nothing matched).
 */
export function snapCoordinate(
  doc: CardDocument,
  layerId: string,
  value: number,
  axis: Axis,
  threshold = 6,
): { value: number; guide: SnapGuide | null } {
  const board = doc.artboard;
  const lines = axis === "x"
    ? [0, board.width / 2, board.width]
    : [0, board.height / 2, board.height];

  for (const other of doc.layers) {
    if (other.id === layerId || other.hidden || other.opacity <= 0) continue;
    if (axis === "x") {
      lines.push(other.x, other.x + other.width / 2, other.x + other.width);
    } else {
      lines.push(other.y, other.y + other.height / 2, other.y + other.height);
    }
  }

  let best: number | null = null;
  let bestDistance = threshold;
  for (const line of lines) {
    const distance = Math.abs(line - value);
    if (distance <= bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }

  if (best === null) return { value, guide: null };
  return { value: best, guide: { axis, at: best, edge: "start" } };
}

/** Zoom limits shared by every stage control (buttons, slider, and wheel). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.0;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(3))));
}

/**
 * Pan correction that keeps the artboard point under the cursor fixed while
 * zooming (Figma/Photoshop behaviour).
 *
 * `origin` is the scaled artboard's CURRENT visual top-left in the same
 * coordinate space as `cursor`; the delta keeps `content = (cursor-origin)/zoom`
 * constant across the zoom change.
 */
export function panForZoomAtPoint(
  pan: { x: number; y: number },
  origin: { x: number; y: number },
  cursor: { x: number; y: number },
  zoom: number,
  nextZoom: number,
): { x: number; y: number } {
  if (zoom <= 0) return pan;
  const k = 1 - nextZoom / zoom;
  return { x: pan.x + (cursor.x - origin.x) * k, y: pan.y + (cursor.y - origin.y) * k };
}
