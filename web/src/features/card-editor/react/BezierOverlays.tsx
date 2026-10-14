"use client";

/**
 * BezierOverlays — the interactive point-editing UI for vector paths.
 *
 * TWO overlays, ONE coordinate contract: both render inside the artboard's
 * scaled coordinate space as absolutely positioned layers, and both convert the
 * pointer into LAYER-LOCAL coordinates before touching the engine. That keeps
 * all DOM/rotation math out of the engine and makes rotated layers work for free
 * (the inverse of the same CSS `rotate()` the renderer applies).
 *
 * Sizes are given in SCREEN pixels and divided by the zoom, so an anchor stays a
 * comfortable target whether the artboard is at 25% or 800% — a design px of
 * slop would be unusable when zoomed out and sluggish when zoomed in.
 */

import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PathPoint } from "../domain/document";
import type { PathLayer } from "../domain/document";
import { pathD, resolveLayerPathD } from "../domain/path";
import { curveBendHandlePos } from "../domain/curveLine";

import type { EditorEngine } from "../engine/EditorEngine";
import { useAltHeld } from "./useAltHeld";

/** Screen-pixel metrics (converted to design px by dividing by the zoom). */
const ANCHOR_TARGET = 10;
const ANCHOR_VISUAL = 5;
const HANDLE_TARGET = 10;
const HANDLE_VISUAL = 4;
/** How close the pointer must be to a curve to select/insert on it. */
const CURVE_SLOP = 9;
/** How close to the first anchor counts as "click to close the path". */
export const CLOSE_SLOP = 12;

const ACCENT = "#22d3ee";
const ACCENT_DARK = "#0e7490";
const CLOSE_ACCENT = "#f0abfc";

export type BoardPoint = { x: number; y: number };

/**
 * ARTBOARD point → the layer's own unrotated coordinate space.
 * Inverse of the CSS `rotate()` the renderer applies about the box centre.
 */
export function toLayerLocal(
  board: BoardPoint,
  layer: { x: number; y: number; width: number; height: number; angle?: number },
): BoardPoint {
  const radians = ((layer.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = board.x - (layer.x + layer.width / 2);
  const dy = board.y - (layer.y + layer.height / 2);
  return {
    x: dx * cos + dy * sin + layer.width / 2,
    y: -dx * sin + dy * cos + layer.height / 2,
  };
}

function scaleFor(zoom: number): number {
  return 1 / Math.max(0.05, zoom);
}

/**
 * The bend hit-areas read `useAltHeld()` to STEP OUT OF THE WAY: with Alt down
 * the pointer must reach the layer underneath, so the very same press drags the
 * whole layer (the contract printed in the node toolbar and the inspector).
 */


/**
 * THE BEND GESTURE — insert a node exactly where the press landed on the drawn
 * shape, then keep moving THAT node with the pointer.
 *
 * Shared by the point editor and the selected-layer dot so the two modes can
 * never diverge, and deliberately ONE undo record: the insert goes through the
 * transient channel (no history, no box re-origin under the pointer) and
 * `commitPathEdit` records the whole press-move-release once — with the layer box
 * re-derived at the very end.
 */
function startBendDrag(
  engine: EditorEngine,
  layer: PathLayer,
  event: React.PointerEvent,
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint,
  tolerance: number,
): boolean {
  const pressClient = { x: event.clientX, y: event.clientY };
  const pressLocal = toLayerLocal(toBoardPoint(event), layer);
  let started: { index: number; point: BoardPoint } | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let finished = false;

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  const onMove = (move: PointerEvent) => {
    if (finished) return;
    // Lazy bend: a plain click never inserts a node. Only a genuine >4px drag
    // creates the lossless split at the original press point.
    if (!started) {
      if (Math.hypot(move.clientX - pressClient.x, move.clientY - pressClient.y) <= 4) return;
      started = engine.beginBend(layer.id, pressLocal, tolerance);
      if (!started) {
        finished = true;
        cleanup();
        engine.commitTransient();
        return;
      }
      offsetX = started.point.x - pressLocal.x;
      offsetY = started.point.y - pressLocal.y;
    }
    const current = toLayerLocal(toBoardPoint(move), layer);
    engine.transientMoveAnchor(layer.id, started.index, { x: current.x + offsetX, y: current.y + offsetY });
  };
  const onUp = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (started) engine.commitPathEdit(layer.id);
    else engine.commitTransient();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  return true;
}

/** Where a bend would land, for the hover dot. Null when the pointer is off the shape. */
function bendGhostAt(
  engine: EditorEngine,
  layer: PathLayer,
  event: { clientX: number; clientY: number },
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint,
  tolerance: number,
): BoardPoint | null {
  const hit = engine.bendPointAt(layer.id, toLayerLocal(toBoardPoint(event), layer), tolerance);
  return hit ? hit.point : null;
}

/**
 * The dot's RESTING position, shown while the pointer is away from the shape.
 * A legacy arc's apex (today's dot) or the middle of a two-point line — both are
 * only a hint now: the real position is wherever the pointer grabs the line.
 */
function restingDot(layer: PathLayer): BoardPoint | null {
  if (layer.points.length !== 2) return null;
  const [from, to] = layer.points;
  if (layer.bend !== undefined) {
    return curveBendHandlePos({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, bend: layer.bend });
  }
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** The dot itself (dark puck + accent ring), shared by both overlays. */
function BendDot({ at, zoom, ghost }: { at: BoardPoint; zoom: number; ghost: boolean }) {
  return (
    <>
      {ghost ? (
        <circle
          cx={at.x}
          cy={at.y}
          r={10 / zoom}
          fill="rgba(103,232,249,0.18)"
          pointerEvents="none"
        />
      ) : null}
      <circle
        data-bend-dot=""
        data-ghost={ghost ? "yes" : "no"}
        cx={at.x}
        cy={at.y}
        r={6 / zoom}
        fill="#07111d"
        stroke={ghost ? "#a5f3fc" : "#67e8f9"}
        strokeWidth={2 / zoom}
        pointerEvents="none"
      />
    </>
  );
}

/* ----------------------------- path point editor ----------------------------- */

/**
 * PathEditOverlay — anchors and Bezier handles for the path being point-edited.
 *
 * Interaction (Figma bend tool + Illustrator curvature standard):
 *   - drag an anchor             → move the point (its handles travel with it)
 *   - drag a handle              → shape the curve (mirrored by default)
 *   - Alt/Option + drag a handle → break the mirror for that point
 *   - PRESS ON THE CURVE         → insert an anchor exactly there and curve that
 *     spot: the node is created by a loss-less split (the drawing does not move)
 *     and then follows the pointer, so "bend it here" is one gesture. The dot
 *     under the pointer previews where the node will land, and Alt/Option keeps
 *     the press for moving the whole layer instead.
 */
type DragKind = "anchor" | "hIn" | "hOut";

/**
 * One draggable point node (an anchor, or one of its handles).
 *
 * It owns its OWN drag flag rather than sharing one in the parent: "am I being
 * dragged" belongs to exactly one element, and keeping it local means the
 * parent's point list stays a pure projection (no refs touched while rendering).
 */
function DragNode({
  engine,
  layer,
  index,
  kind,
  cursor,
  toBoardPoint,
  children,
}: {
  engine: EditorEngine;
  layer: PathLayer;
  index: number;
  kind: DragKind;
  cursor: string;
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint;
  children: ReactNode;
}) {
  const dragging = useRef(false);

  /** Where the dragged node started, in BOARD coordinates (group-drag base). */
  const groupDragStart = useRef<{ x: number; y: number } | null>(null);

  /**
   * Layer-LOCAL → WORLD coordinates: the engine stores and edits points in
   * artboard space (`layer.x + local`), which is what makes a node drag
   * independent of where the layer box happens to start.
   *
   * The mapping is 1:1 on purpose. The renderer draws the path with
   * `viewBox="0 0 layer.width layer.height"` inside a box of exactly that CSS
   * size, so one local unit IS one design pixel — and the overlay below uses the
   * same box, so the node the user grabs is the point the engine moves. No
   * offset, no scale factor to keep in sync.
   */
  const localToWorld = (local: BoardPoint): BoardPoint => ({ x: layer.x + local.x, y: layer.y + local.y });

  const handlePointerDown = (event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = true;
    engine.beginTransient();
    if (kind === "anchor") {
      // MULTI-NODE (Figma): a plain click focuses one node; shift-click toggles
      // it in the group. The gesture below moves the WHOLE group.
      engine.selectAnchor({ layerId: layer.id, index }, event.shiftKey);
      const start = layer.points[index];
      groupDragStart.current = localToWorld({ x: start.x, y: start.y });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGGElement>) => {
    if (!dragging.current) return;
    event.stopPropagation();
    const board = toBoardPoint(event);
    if (kind === "anchor") {
      // Group drag when several nodes are selected (marquee / shift-click); a
      // single selected node takes the single-node drag. The delta is measured
      // from the DOWN point, so the gesture never accumulates drift.
      const indices = engine.selectedAnchorIndices(layer.id);
      if (indices.length > 1 && groupDragStart.current) {
        engine.beginAnchorGesture(layer.id, indices);
        engine.transientMoveAnchors({
          x: board.x - groupDragStart.current.x,
          y: board.y - groupDragStart.current.y,
        });
        return;
      }
      // CURVE-AWARE single node drag. On a still-parametric curve an endpoint
      // drag is a CHORD edit (length + chord angle), so the parameters survive;
      // on a plain or already-frozen path this stays the original transient
      // anchor move (one history record at commit).
      if (engine.isParametricCurve(layer.id)) {
        engine.updateCurveNode(layer.id, index, localToWorld(toLayerLocal(board, layer)), { transient: true });
      } else {
        engine.transientMoveAnchor(layer.id, index, toLayerLocal(board, layer));
      }
    } else {
      // Alt/Option breaks the handle mirror — the modifier contract every
      // vector editor uses to make a "corner" point.
      engine.transientMoveHandle(layer.id, index, kind, toLayerLocal(board, layer), !event.altKey);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<SVGGElement>) => {
    if (!dragging.current) return;
    event.stopPropagation();
    dragging.current = false;
    groupDragStart.current = null;
    engine.commitPathEdit(layer.id);
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGGElement>) => {
    event.stopPropagation();
    if (kind === "anchor") {
      engine.toggleAnchorType(layer.id, index);
    }
  };

  return (
    <g
      style={{ pointerEvents: "auto", cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </g>
  );
}

export function PathEditOverlay({
  engine,
  layer,
  zoom,
  selectedIndex,
  selectedIndices,
  rangeStartIndex,
  toBoardPoint,
}: {
  engine: EditorEngine;
  layer: PathLayer;
  zoom: number;
  selectedIndex: number | null;
  selectedIndices: number[];
  rangeStartIndex: number | null;
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint;
}) {
  const scale = scaleFor(zoom);
  const anchorSize = ANCHOR_VISUAL * scale;
  const handleSize = HANDLE_VISUAL * scale;
  const [ghost, setGhost] = useState<BoardPoint | null>(null);
  const altHeld = useAltHeld();
  const selectedIndexSet = new Set(selectedIndices);
  const hasRange =
    rangeStartIndex !== null &&
    selectedIndex !== null &&
    rangeStartIndex !== selectedIndex &&
    rangeStartIndex >= 0 &&
    selectedIndex < layer.points.length;
  const rangePoints = hasRange
    ? layer.points.slice(Math.min(rangeStartIndex, selectedIndex), Math.max(rangeStartIndex, selectedIndex) + 1)
    : [];

  /** The dot the user is about to plant: WHERE a press would create a node. */
  const onSegPointerMove = (event: React.PointerEvent<SVGPathElement>) => {
    if (event.buttons) return; // a drag owns the gesture
    setGhost(bendGhostAt(engine, layer, event, toBoardPoint, CURVE_SLOP / zoom));
  };

  const onSegPointerDown = (event: React.PointerEvent<SVGPathElement>) => {
    if (event.button !== 0 || event.detail >= 2 || event.altKey) return;
    event.stopPropagation();
    event.preventDefault();
    engine.beginTransient();
    if (!startBendDrag(engine, layer, event, toBoardPoint, CURVE_SLOP / zoom)) engine.commitTransient();
    setGhost(null);
  };

  const onSegDoubleClick = (event: React.MouseEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const local = toLayerLocal(toBoardPoint(event), layer);
    engine.insertAnchorAtPoint(layer.id, local, CURVE_SLOP / zoom);
    setGhost(null);
  };

  return (
    <svg
      data-path-editor=""
      className="absolute left-0 top-0 z-[1400] overflow-visible"
      width={layer.width}
      height={layer.height}
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      style={{
        // CLICK-THROUGH CONTRACT: the overlay box itself is INERT — only its
        // interactive children (nodes, handles, the wide segment hit path) take
        // pointer events. A box-sized overlay used to swallow every click that
        // landed inside a path's bounding box, so once point-edit mode was on,
        // another layer underneath could never be selected again.
        pointerEvents: "none",
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
        transformOrigin: "center center",
        overflow: "visible",
      }}
    >
      {/*
       * Segment hit targets are intentionally transparent but wide.
       * This is the missing interaction layer that makes a path feel like a
       * real vector editor: double-click any part of a segment to insert a
       * node, then drag that node/its handles. The visible stroke itself never
       * becomes the hit target, so the hit area stays predictable at any zoom.
       */}
      <path
        data-bend-hit=""
        d={resolveLayerPathD(layer)}
        fill="none"
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={Math.max(14, 16 * scale)}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents={altHeld ? "none" : "stroke"}
        style={{ cursor: "crosshair" }}
        onPointerMove={onSegPointerMove}
        onPointerLeave={() => setGhost(null)}
        onPointerDown={onSegPointerDown}
        onDoubleClick={onSegDoubleClick}
      />

      {/* The bend preview: the node a press would create, right under the pointer. */}
      {ghost ? <BendDot at={ghost} zoom={zoom} ghost /> : null}

      {hasRange ? (
        <path
          d={pathD(rangePoints, false)}
          fill="none"
          stroke={CLOSE_ACCENT}
          strokeWidth={3 * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      ) : null}

      {/* Handle stems — a thin line from each anchor to each of its handles. */}
      {layer.points.flatMap((point, index) =>
        (["hIn", "hOut"] as const).flatMap((which) => {
          const handle = point[which];
          if (!handle) return [];
          return [
            <line
              key={`stem-${index}-${which}`}
              x1={point.x}
              y1={point.y}
              x2={handle.x}
              y2={handle.y}
              stroke={ACCENT}
              strokeWidth={scale}
              strokeOpacity={0.7}
            />,
          ];
        }),
      )}

      {/* Handles (draggable). */}
      {layer.points.flatMap((point, index) =>
        (["hIn", "hOut"] as const).flatMap((which) => {
          const handle = point[which];
          if (!handle) return [];
          return [
            <DragNode
              key={`handle-${index}-${which}`}
              engine={engine}
              layer={layer}
              index={index}
              kind={which}
              cursor="crosshair"
              toBoardPoint={toBoardPoint}
            >
              <circle cx={handle.x} cy={handle.y} r={(HANDLE_TARGET / 2) * scale} fill="transparent" />
<circle cx={handle.x} cy={handle.y} r={handleSize / 2} fill="transparent" stroke={ACCENT} strokeWidth={scale * 1.5} />
            </DragNode>,
          ];
        }),
      )}

      {/* Anchors (draggable). Square = corner point, circle = smooth point. */}
      {layer.points.map((point, index) => {
        const isSmooth = Boolean(point.hIn || point.hOut);
        const isSelected = selectedIndexSet.has(index) || index === selectedIndex;
        const isRangeStart = hasRange && index === rangeStartIndex;
        const fill = isSelected ? ACCENT : "#ffffff";
        const stroke = isRangeStart ? CLOSE_ACCENT : fill;
        return (
          <DragNode
            key={`anchor-${index}`}
            engine={engine}
            layer={layer}
            index={index}
            kind="anchor"
            cursor="move"
            toBoardPoint={toBoardPoint}
          >
            <circle cx={point.x} cy={point.y} r={(ANCHOR_TARGET / 2) * scale} fill="transparent" />
{isSmooth ? (
  <circle cx={point.x} cy={point.y} r={anchorSize / 2} fill="transparent" stroke={stroke} strokeWidth={scale * 1.5} />
            ) : (
              <rect
                x={point.x - anchorSize / 2}
                y={point.y - anchorSize / 2}
                width={anchorSize}
                height={anchorSize}
                fill="transparent"
                stroke={stroke}
                strokeWidth={scale * 1.5}
              />
            )}
          </DragNode>
        );
      })}
    </svg>
  );
}

/* -------------------------------- pen draft -------------------------------- */

/**
 * PenDraftOverlay — the live path while the Pen tool is drawing.
 *
 * Shows the committed-so-far curve, the rubber band to the pointer, the handles
 * the user is pulling out, and highlights the first anchor when clicking it
 * would CLOSE the path.
 */
export function PenDraftOverlay({
  draft,
  cursor,
  width,
  height,
  zoom,
}: {
  draft: PathPoint[];
  cursor: BoardPoint | null;
  width: number;
  height: number;
  zoom: number;
}) {
  if (draft.length === 0) return null;
  const scale = scaleFor(zoom);
  const first = draft[0];
  const last = draft[draft.length - 1];
  const closing = cursor !== null && Math.hypot(cursor.x - first.x, cursor.y - first.y) <= CLOSE_SLOP * scale;
  const anchorSize = ANCHOR_VISUAL * scale;

  return (
    <svg
      data-pen-draft=""
      className="pointer-events-none absolute left-0 top-0 z-[1500] overflow-visible"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path d={pathD(draft, false)} fill="none" stroke={ACCENT} strokeWidth={2 * scale} />

      {cursor && !closing ? (
        <line
          x1={last.x}
          y1={last.y}
          x2={cursor.x}
          y2={cursor.y}
          stroke={ACCENT}
          strokeWidth={scale}
          strokeDasharray={`${4 * scale} ${4 * scale}`}
        />
      ) : null}

      {cursor && closing ? (
        <line
          x1={last.x}
          y1={last.y}
          x2={first.x}
          y2={first.y}
          stroke={CLOSE_ACCENT}
          strokeWidth={1.5 * scale}
          strokeDasharray={`${5 * scale} ${4 * scale}`}
        />
      ) : null}

      {draft.map((point, index) => (
        <Fragment key={`draft-handle-${index}`}>
          {point.hIn ? (
            <line x1={point.x} y1={point.y} x2={point.hIn.x} y2={point.hIn.y} stroke={ACCENT} strokeWidth={scale} strokeOpacity={0.7} />
          ) : null}
          {point.hOut ? (
            <line x1={point.x} y1={point.y} x2={point.hOut.x} y2={point.hOut.y} stroke={ACCENT} strokeWidth={scale} strokeOpacity={0.7} />
          ) : null}
          {point.hIn ? <circle cx={point.hIn.x} cy={point.hIn.y} r={handleSizeFor(scale) / 2} fill={ACCENT} /> : null}
          {point.hOut ? <circle cx={point.hOut.x} cy={point.hOut.y} r={handleSizeFor(scale) / 2} fill={ACCENT} /> : null}
        </Fragment>
      ))}

      {draft.map((point, index) => (
        <rect
          key={`draft-anchor-${index}`}
          x={point.x - anchorSize / 2}
          y={point.y - anchorSize / 2}
          width={index === 0 && closing ? anchorSize * 1.5 : anchorSize}
          height={index === 0 && closing ? anchorSize * 1.5 : anchorSize}
          fill={index === 0 && closing ? CLOSE_ACCENT : ACCENT}
          stroke="#0f172a"
          strokeWidth={scale}
        />
      ))}
    </svg>
  );
}

function handleSizeFor(scale: number): number {
  return HANDLE_VISUAL * scale;
}

/**
 * BEND DOT OVERLAY — "grab the line anywhere and curve that spot", for the
 * SELECTED layer (outside point-editing).
 *
 * The dot is no longer pinned to the middle of a two-point curve. While the
 * pointer travels along the shape the layer actually DRAWS (a legacy circular
 * arc included) the dot travels with it, and the press turns that exact spot
 * into a real node which then follows the pointer: the bend appears wherever the
 * user grabbed, and the arc model is preserved (losslessly) until that first
 * structural edit — after which the anchors ARE the geometry.
 *
 * Alt/Option turns the same press into a LAYER MOVE by taking the hit stroke out
 * of the pointer's way (the layer's own hit area is right underneath).
 */
export function ArcBendHandleOverlay({
  engine,
  layer,
  zoom,
  toBoardPoint,
}: {
  engine: EditorEngine;
  layer: PathLayer;
  zoom: number;
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint;
}) {
  const [ghost, setGhost] = useState<BoardPoint | null>(null);
  const altHeld = useAltHeld();
  const scale = scaleFor(zoom);
  const dot = ghost ?? restingDot(layer);

  const onPointerDown = (event: React.PointerEvent<SVGPathElement>) => {
    if (event.button !== 0 || event.detail >= 2) return;
    if (event.altKey) return;
    event.stopPropagation();
    event.preventDefault();
    setGhost(null);
    engine.beginTransient();
    if (!startBendDrag(engine, layer, event, toBoardPoint, CURVE_SLOP / zoom)) engine.commitTransient();
  };

  return (
    <svg
      data-bend-overlay=""
      className="pointer-events-none absolute left-0 top-0 z-[1600] overflow-visible"
      style={{
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
        transformOrigin: "center center",
      }}
      viewBox={`0 0 ${layer.width} ${layer.height}`}
    >
      <g className="handles-overlay pointer-events-auto">
        {/* The wide invisible stroke is the hover + press target: without it the
            dot could not follow the pointer along the line, and the line itself
            would stay ungrabbable at any zoom. It sits on TOP of the layer, but
            stays narrow — the rest of the box still moves the layer. */}
        <path
          data-bend-hit=""
          d={resolveLayerPathD(layer)}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={Math.max(14, 16 * scale)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents={altHeld ? "none" : "stroke"}
          style={{ cursor: "crosshair" }}
          onPointerMove={(event) => {
            if (event.buttons) return; // a drag owns the gesture
            setGhost(bendGhostAt(engine, layer, event, toBoardPoint, CURVE_SLOP / zoom));
          }}
          onPointerLeave={() => setGhost(null)}
          onPointerDown={onPointerDown}
          onDoubleClick={(event) => {
            // This stroke swallows the double-click the layer's own hit area uses
            // to enter point-editing, so it forwards it: from the line, the way
            // into the node editor must keep working.
            event.stopPropagation();
            engine.setPathEditing(layer.id);
          }}
        />
        {dot ? <BendDot at={dot} zoom={zoom} ghost={Boolean(ghost)} /> : null}
      </g>
    </svg>
  );
}

export default PathEditOverlay;
