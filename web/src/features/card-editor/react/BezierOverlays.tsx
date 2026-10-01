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

import { Fragment, useRef } from "react";
import type { ReactNode } from "react";
import type { PathPoint } from "../domain/document";
import type { PathLayer } from "../domain/document";
import { pathD, nearestSegmentParam } from "../domain/path";
import { curveBendHandlePos, bendFromPointer } from "../domain/curveLine";
import type { EditorEngine } from "../engine/EditorEngine";

/** Screen-pixel metrics (converted to design px by dividing by the zoom). */
const ANCHOR_TARGET = 12;
const ANCHOR_VISUAL = 9;
const HANDLE_TARGET = 12;
const HANDLE_VISUAL = 7;
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

/* ----------------------------- path point editor ----------------------------- */

/**
 * PathEditOverlay — anchors and Bezier handles for the path being point-edited.
 *
 * Interaction (Figma/Illustrator-like):
 *   - drag an anchor            → move the point (its handles travel with it)
 *   - drag a handle             → shape the curve (mirrored by default)
 *   - Alt/Option + drag a handle→ break the mirror for that point
 *   - double-click ON the curve → insert an anchor there, losslessly
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
      groupDragStart.current = {
        x: layer.x + layer.points[index].x,
        y: layer.y + layer.points[index].y,
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGGElement>) => {
    if (!dragging.current) return;
    event.stopPropagation();
    const board = toBoardPoint(event);
    if (kind === "anchor") {
      // Group drag when several nodes are selected (marquee / shift-click); a
      // single selected node takes the original single-node drag. The delta is
      // measured from the DOWN point, so the gesture never accumulates drift.
      const indices = engine.selectedAnchorIndices(layer.id);
      if (indices.length > 1 && groupDragStart.current) {
        engine.beginAnchorGesture(layer.id, indices);
        engine.transientMoveAnchors({
          x: board.x - groupDragStart.current.x,
          y: board.y - groupDragStart.current.y,
        });
        return;
      }
      engine.transientMoveAnchor(layer.id, index, toLayerLocal(board, layer));
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
  toBoardPoint,
}: {
  engine: EditorEngine;
  layer: PathLayer;
  zoom: number;
  selectedIndex: number | null;
  toBoardPoint: (event: { clientX: number; clientY: number }) => BoardPoint;
}) {
  const scale = scaleFor(zoom);
  const anchorSize = ANCHOR_VISUAL * scale;
  const handleSize = HANDLE_VISUAL * scale;

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    event.stopPropagation();
    const local = toLayerLocal(toBoardPoint(event), layer);
    const hit = nearestSegmentParam(layer.points, layer.closed, local);
    // Only insert when the double-click actually landed on the curve.
    if (!hit || hit.distance > CURVE_SLOP * scale) return;
    engine.insertAnchorAt(layer.id, hit.segIndex, hit.t);
  };

  return (
    <svg
      data-path-editor=""
      className="absolute left-0 top-0 z-[1400] overflow-visible"
      width={layer.width}
      height={layer.height}
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      style={{
        pointerEvents: "none",
        transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
      }}
      onDoubleClick={onDoubleClick}
    >
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
              <circle cx={handle.x} cy={handle.y} r={handleSize / 2} fill={ACCENT} stroke="#ffffff" strokeWidth={scale} />
            </DragNode>,
          ];
        }),
      )}

      {/* Anchors (draggable). Square = corner point, circle = smooth point. */}
      {layer.points.map((point, index) => {
        const isSmooth = Boolean(point.hIn || point.hOut);
        const fill = index === selectedIndex ? ACCENT : "#ffffff";
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
              <circle cx={point.x} cy={point.y} r={anchorSize / 2} fill={fill} stroke={ACCENT_DARK} strokeWidth={scale} />
            ) : (
              <rect
                x={point.x - anchorSize / 2}
                y={point.y - anchorSize / 2}
                width={anchorSize}
                height={anchorSize}
                fill={fill}
                stroke={ACCENT_DARK}
                strokeWidth={scale}
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

export function ArcBendHandleOverlay({
  engine,
  layer,
  zoom,
}: {
  engine: EditorEngine;
  layer: PathLayer;
  zoom: number;
}) {
  if (layer.points.length !== 2 || (layer.curveProfile && layer.curveProfile !== "arc")) return null;
  // `bend` is the canonical model (legacy `curvature` is normalized onto it at
  // parse time), so the handle sits on the arc the resolver actually draws.
  const lSpec = {
    x1: layer.points[0].x,
    y1: layer.points[0].y,
    x2: layer.points[1].x,
    y2: layer.points[1].y,
    bend: layer.bend ?? 0,
  };
  const h = curveBendHandlePos(lSpec);
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const HIT = (isTouch ? 22 : 12) / zoom;

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);

    const onPointerMove = (me: PointerEvent) => {
      const stage = target.closest("[data-stage-inner]") as HTMLElement | null;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const pt = {
        x: (me.clientX - rect.left) / zoom,
        y: (me.clientY - rect.top) / zoom,
      };
      const localPt = toLayerLocal(pt, layer);
      const newBend = bendFromPointer(lSpec, localPt, zoom);
      engine.transientPatch(layer.id, { bend: newBend });
    };

    const onPointerUp = (ue: PointerEvent) => {
      target.releasePointerCapture(ue.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      engine.commitTransient();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <svg
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
        <circle
          cx={h.x}
          cy={h.y}
          r={HIT}
          fill="transparent"
          style={{ cursor: "grab" }}
          onPointerDown={onPointerDown}
        />
        <circle
          cx={h.x}
          cy={h.y}
          r={6 / zoom}
          fill="#07111d"
          stroke="#67e8f9"
          strokeWidth={2 / zoom}
          pointerEvents="none"
        />
      </g>
    </svg>
  );
}

export default PathEditOverlay;
