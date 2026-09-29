"use client";

/**
 * EditorStage — the interactive artboard.
 *
 * Drag contract (plan constraint): pointermove only updates TRANSIENT engine
 * state — zero network requests during a drag. On pointerup ONE commit is
 * made and the debounced autosave (CardStudio) persists the final state.
 * Double-click on a text layer opens a dir=rtl native textarea overlay
 * (filerobot pattern from the research; IME/RTL behave natively).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardDocument, CardLayer, PathLayer, TextLayer } from "../domain/document";
import { layerZ } from "../domain/document";
import { EditorEngine, type ResizeHandle } from "../engine/EditorEngine";
import { useCardEditor } from "./useCardEditor";
import { LayerBox, LayeredCard } from "./LayeredCardRenderer";
import { SelectionOverlay } from "./SelectionOverlay";
import { pathD, createFreehandPath } from "../domain/path";
import { shouldBeginHandleDrag } from "../domain/penGesture";
import { dashArrayFor } from "../domain/stroke";
import { PenDraftOverlay, PathEditOverlay, CLOSE_SLOP } from "./BezierOverlays";
import {
  clampZoom,
  keepInside,
  panForZoomAtPoint,
  snapCoordinate,
  snapLayerPosition,
  type SnapGuide,
} from "../domain/geometry";

type Props = {
  engine: EditorEngine;
  doc: CardDocument;
  /** Points at the 1:1 artboard element (used by html-to-image export). */
  exportRef?: React.Ref<HTMLDivElement>;
  /** Preview mode hides selection/handles/guides/inspector affordances. */
  preview?: boolean;
};

export function EditorStage({ engine, doc, exportRef, preview = false }: Props) {
  const state = useCardEditor(engine);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const dragRef = useRef<{ layerId: string; offsetX: number; offsetY: number } | null>(null);
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const [spaceDown, setSpaceDown] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const available = el.clientWidth;
    const target = Math.min(1, (available - 8) / doc.artboard.width);
    setZoom(clampZoom(target));
  }, [doc.artboard.width]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fitToContainer();
    const ro = new ResizeObserver(fitToContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * 1.25)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / 1.25)), []);
  const zoomFit = useCallback(() => fitToContainer(), [fitToContainer]);

  /**
   * Wheel zoom at the cursor (Ctrl/Cmd): the artboard point UNDER the pointer
   * stays exactly put, like Figma/Photoshop. The pan correction is derived from
   * the scaled artboard's current visual origin, so it is exact regardless of
   * the container's centring or margins.
   */
  const onStageWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();

    const inner = containerRef.current?.querySelector("[data-stage-inner]") as HTMLElement | null;
    if (!inner) return;

    const current = zoom;
    const next = clampZoom(event.deltaY < 0 ? current * 1.1 : current / 1.1);
    if (next === current) return;

    const rect = inner.getBoundingClientRect();
    setPan(
      panForZoomAtPoint(
        pan,
        { x: rect.left, y: rect.top },
        { x: event.clientX, y: event.clientY },
        current,
        next,
      ),
    );
    setZoom(next);
  };

  const selected = state.selection.layerId;
  const selectedLayer = useMemo(
    () => (selected ? doc.layers.find((l) => l.id === selected) ?? null : null),
    [selected, doc.layers],
  );

  // Group frame for the transform overlay. DERIVED from the layers on every
  // render — never stored on the document, so there is nothing to keep in sync
  // after an undo, a reload or a layer move. Cheap: at most `max_layers` boxes.
  const groupBounds = state.selection.ids.length > 1 ? engine.selectionBounds() : null;

  // Point-edit mode is only ever active for the SELECTED path layer, so a stale
  // editingPathId can never attach the point overlay to the wrong curve.
  const editedPathLayer =
    state.editingPathId && selectedLayer && selectedLayer.id === state.editingPathId && selectedLayer.kind === "path"
      ? (selectedLayer as PathLayer)
      : null;

  // Accepts anything with client coordinates so the Bezier overlays can reuse
  // the exact same artboard projection the stage uses.
  const pointerPos = useCallback((event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const stage = containerRef.current?.querySelector("[data-stage-inner]") as HTMLElement | null;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  }, [zoom]);

  const isDrawingRef = useRef(false);
  /** True only once the pen click has crossed PEN_DRAG_THRESHOLD_PX (domain/penGesture). */
  const penDragRef = useRef(false);
  /** Where the current pen pointer-down landed (artboard coords) — the threshold base. */
  const penStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Rubber-band target for the live pen path (view state only). */
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);
  const transformRef = useRef<
    | { kind: "move"; layerId: string; offsetX: number; offsetY: number }
    | { kind: "resize"; layerId: string; handle: ResizeHandle }
    | { kind: "group-resize"; handle: ResizeHandle }
    | { kind: "rotate"; layerId: string }
    | { kind: "group-rotate" }
    | null
  >(null);

  const onLayerPointerDown = (event: React.PointerEvent, layerId: string) => {
    // Only the SELECT tool interacts with layers. The pen and the freehand
    // brush must pass their pointer events straight through to the stage so a
    // click on an existing layer anchors/starts a stroke instead of dragging.
    if (state.tool !== "select") return;
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;
    event.stopPropagation();
    // Shift-click extends/contracts the multi-select set.
    engine.select(layerId, event.shiftKey);
    const pos = pointerPos(event);
    dragRef.current = { layerId, offsetX: pos.x - layer.x, offsetY: pos.y - layer.y };
    transformRef.current = { kind: "move", layerId, offsetX: pos.x - layer.x, offsetY: pos.y - layer.y };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  // Editor keyboard: arrows nudge, Delete/Backspace removes, Esc deselects,
  // Ctrl/Cmd+C/V/D copy/paste/duplicate. Typing in inputs is never hijacked.
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const handler = (e: KeyboardEvent) => {
      if (preview || isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const id = state.selection.layerId;
      const layer = id ? doc.layers.find((l) => l.id === id) : null;
      if (e.key === "Escape") {
        // Esc unwinds the most specific thing FIRST: a live pen draft, then
        // point-editing, then the layer selection.
        if (state.penDraft) {
          engine.cancelPen();
          return;
        }
        if (state.editingPathId) {
          engine.setPathEditing(null);
          return;
        }
        if (state.selection.layerId) engine.select(null);
        return;
      }
      if (e.key === "Enter" && state.penDraft) {
        e.preventDefault();
        engine.finishPen(false);
        return;
      }
      const anchor = state.selectedAnchor;
      if ((e.key === "Delete" || e.key === "Backspace") && anchor && state.editingPathId === anchor.layerId) {
        // While point-editing, Delete removes the selected ANCHOR, not the layer.
        e.preventDefault();
        engine.removeAnchorAt(anchor.layerId, anchor.index);
        return;
      }
      if (!layer) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        engine.deleteLayer(layer.id);
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        engine.duplicateLayer(layer.id);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        clipboard.current = JSON.parse(JSON.stringify(layer));
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (!clipboard.current) return;
        e.preventDefault();
        engine.pasteLayer(clipboard.current);
        return;
      }
      // Arrow nudge (Shift = coarse 10px step). One history entry per keydown.
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        engine.nudge(layer.id, -step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        engine.nudge(layer.id, step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        engine.nudge(layer.id, 0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        engine.nudge(layer.id, 0, step);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [engine, doc, state.selection.layerId, state.penDraft, state.editingPathId, state.selectedAnchor, preview]);

  const clipboard = useRef<CardLayer | null>(null);

  // Space toggles the pan cursor. Bound on window so the state is right even
  // when focus is on a handle/input elsewhere in the stage.
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditable(e.target) && !spaceDown) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [spaceDown]);

  const onResizeHandlePointerDown = (handle: ResizeHandle, event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();

    // ≥2 layers selected → the handles resize the GROUP (Figma behaviour).
    if (state.selection.ids.length > 1) {
      if (!engine.selectionBounds()) return;
      transformRef.current = { kind: "group-resize", handle };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }

    const layerId = state.selection.layerId;
    if (!layerId) return;
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;
    transformRef.current = { kind: "resize", layerId, handle };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onRotateHandlePointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (state.selection.ids.length > 1) {
      if (!engine.selectionBounds()) return;
      transformRef.current = { kind: "group-rotate" };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }

    const layerId = state.selection.layerId;
    if (!layerId) return;
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;
    transformRef.current = { kind: "rotate", layerId };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onStagePointerDown = (event: React.PointerEvent) => {
    // Space + drag pans the artboard (Photoshop/Figma convention).
    if (spaceDown || event.button === 1) {
      event.preventDefault();
      panRef.current = { startX: event.clientX, startY: event.clientY, offsetX: pan.x, offsetY: pan.y };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }
    if (state.tool === "pen") {
      event.stopPropagation();
      const pos = pointerPos(event);
      const draft = state.penDraft;
      // Clicking the FIRST anchor closes the path — the Figma/Illustrator
      // contract. The target is generous, but only offered once there is
      // actually something to close.
      if (draft && draft.length >= 2 && Math.hypot(pos.x - draft[0].x, pos.y - draft[0].y) <= CLOSE_SLOP / zoom) {
        engine.finishPen(true);
        setPenCursor(null);
        return;
      }
      if (draft && draft.length > 0) engine.penAddAnchor(pos);
      else engine.penStart(pos);
      // Remember where this click landed: a click only becomes a handle DRAG
      // once the pointer crosses PEN_DRAG_THRESHOLD_PX in SCREEN pixels (see
      // onStagePointerMove). Until then it is a plain corner anchor.
      penStartRef.current = pos;
      penDragRef.current = false;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }
    if (state.tool === "draw") {
      event.stopPropagation();
      const pos = pointerPos(event);
      isDrawingRef.current = true;
      engine.beginFreehandStroke(pos);
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } else {
      if (state.editingPathId) engine.setPathEditing(null);
      engine.select(null);
    }
  };

  const onStagePointerMove = (event: React.PointerEvent) => {
    const p = panRef.current;
    if (p) {
      setPan({ x: p.offsetX + (event.clientX - p.startX), y: p.offsetY + (event.clientY - p.startY) });
      return;
    }
    const pos = pointerPos(event);
    if (state.tool === "pen") {
      // Track the rubber band only once a draft exists (hovering with nothing
      // to rubber-band to would re-render the whole stage for no reason); pull
      // handles only while a click is held.
      if (state.penDraft) setPenCursor(pos);
      // Click ↔ drag threshold: the drag begins only when the pointer has
      // travelled > PEN_DRAG_THRESHOLD_PX SCREEN px from where it went down —
      // anything less is a click and leaves the anchor handle-less (corner).
      if (!penDragRef.current && penStartRef.current && shouldBeginHandleDrag(penStartRef.current, pos, zoom)) {
        penDragRef.current = true;
      }
      if (penDragRef.current) engine.penDragHandle(pos);
      return;
    }
    if (isDrawingRef.current && state.tool === "draw") {
      engine.extendFreehandStroke(pos);
      return;
    }
    const transform = transformRef.current;
    if (!transform) return;
    // TRANSIENT only: no commit, no history, no network (plan constraint).
    if (transform.kind === "group-resize") {
      engine.transientGroupResize(transform.handle, pos, event.shiftKey);
      return;
    }
    if (transform.kind === "group-rotate") {
      engine.transientGroupRotate(pos, event.shiftKey);
      return;
    }
    if (transform.kind === "resize") {
      // SNAP THE DRAGGED EDGE: the edge IS the pointer coordinate, so snapping
      // the coordinate lands the edge exactly on the guide (same guides the
      // move gesture uses). Rotated layers are skipped — their edges are not
      // axis-aligned, so a guide would be misleading.
      const target = doc.layers.find((l) => l.id === transform.layerId);
      if (!target || (target.angle ?? 0) !== 0) {
        setActiveGuides([]);
        engine.transientResize(transform.layerId, transform.handle, pos);
        return;
      }
      const snappedX = transform.handle.includes("e") || transform.handle.includes("w")
        ? snapCoordinate(doc, transform.layerId, pos.x, "x")
        : { value: pos.x, guide: null };
      const snappedY = transform.handle.includes("n") || transform.handle.includes("s")
        ? snapCoordinate(doc, transform.layerId, pos.y, "y")
        : { value: pos.y, guide: null };
      setActiveGuides([snappedX.guide, snappedY.guide].filter((guide): guide is SnapGuide => guide !== null));
      engine.transientResize(transform.layerId, transform.handle, { x: snappedX.value, y: snappedY.value });
      return;
    }
    if (transform.kind === "rotate") {
      engine.transientRotate(transform.layerId, pos, event.shiftKey);
      return;
    }
    // Move with snapping + artboard clamp. Multi-select follows the primary.
    const layer = doc.layers.find((l) => l.id === transform.layerId);
    if (!layer) return;
    const rawX = pos.x - transform.offsetX;
    const rawY = pos.y - transform.offsetY;
    if (state.selection.ids.length > 1) {
      engine.transientMoveSelection(transform.layerId, rawX, rawY);
      return;
    }
    const snapped = snapLayerPosition(doc, transform.layerId, { x: rawX, y: rawY }, { width: layer.width, height: layer.height });
    setActiveGuides(snapped.guides);
    const kept = keepInside(snapped.pos.x, snapped.pos.y, layer.width, layer.height);
    engine.transientMove(transform.layerId, kept.x, kept.y);
  };

  const onStagePointerUp = () => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (penDragRef.current || penStartRef.current) {
      // A pen click/drag ends the moment the pointer lifts; the DRAFT stays
      // alive until the path is closed or committed.
      penDragRef.current = false;
      penStartRef.current = null;
      return;
    }
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      engine.commitFreehandStroke({
        color: state.brushColor,
        width: state.brushWidth,
        style: state.brushStyle,
        linecap: state.brushLinecap,
        linejoin: state.brushLinejoin,
        opacity: state.brushOpacity,
      });
      return;
    }
    const transform = transformRef.current;
    if (!transform) return;
    transformRef.current = null;
    dragRef.current = null;
    setActiveGuides([]);
    // ONE commit per gesture; autosave debounce handles persistence after.
    engine.commitTransform();
  };

  const startTextEdit = (layer: TextLayer) => {
    setEditingTextId(layer.id);
    setEditValue(layer.text);
  };

  const commitTextEdit = () => {
    if (editingTextId) {
      engine.updateLayer(editingTextId, { text: editValue });
    }
    setEditingTextId(null);
  };

  const editingLayer = useMemo(
    () => (editingTextId ? (doc.layers.find((l) => l.id === editingTextId) as TextLayer | undefined) : undefined),
    [editingTextId, doc.layers],
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1220] ${
        state.tool === "draw" || state.tool === "pen" ? "cursor-crosshair touch-none" : ""
      } ${spaceDown ? "cursor-grab" : ""}`}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onWheel={onStageWheel}
      style={{
        height: Math.round(doc.artboard.height * zoom) + 24,
      }}
    >
      {/* Scaled-fit wrapper: layout size equals the SCALED artboard, so
          auto-centering works in RTL too (the inner layout box overflows the
          wrapper on purpose but its scaled visual exactly fills it). */}
      <div
        className="relative mx-auto"
        style={{
          width: Math.round(doc.artboard.width * zoom),
          height: Math.round(doc.artboard.height * zoom),
          marginTop: 12,
          marginBottom: 12,
        }}
      >
      <div
        data-stage-inner
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: doc.artboard.width,
          height: doc.artboard.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* Background hit area */}
        <div className="absolute inset-0" style={{ background: doc.background }} />

        {/* Interactive layer hit-areas (above visuals, below nothing) */}
        {doc.layers.map((layer, index) =>
          layer.hidden ? null : (
            <div
              key={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`لایه ${layer.kind}`}
              className={`absolute cursor-move rounded-md transition-shadow ${
                selected === layer.id && !preview ? "ring-2 ring-cyan-400 ring-offset-0" : "hover:ring-1 hover:ring-white/40"
              }`}
              style={{
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
                zIndex: 1000 + layerZ(index),
                cursor: state.tool === "draw" ? "crosshair" : layer.locked ? "not-allowed" : "move",
              }}
              onPointerDown={(e) => onLayerPointerDown(e, layer.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (layer.locked || state.tool !== "select") return;
                if (layer.kind === "text") startTextEdit(layer as TextLayer);
                // Double-clicking a CURVE enters point-editing mode.
                if (layer.kind === "path") engine.setPathEditing(layer.id);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") engine.select(layer.id);
              }}
            />
          ),
        )}

        {/* Selection overlays: border + resize/rotate handles per selected layer.
            The primary selection also carries the handles; secondary ones get
            a border only. All overlays rotate with their layer. */}
        {state.tool === "select" && state.selection.ids.length > 1 && !preview ? (
          state.selection.ids.map((id) => {
            const layer = doc.layers.find((l) => l.id === id);
            if (!layer) return null;
            return (
              <div
                key={`sel-${id}`}
                className="pointer-events-none absolute border border-cyan-400/70"
                style={{
                  left: layer.x,
                  top: layer.y,
                  width: layer.width,
                  height: layer.height,
                  transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
                  zIndex: 1200,
                }}
              />
            );
          })
        ) : null}

        {/* Group transform overlay: a DERIVED frame with the same 8 handles and
            rotate stem. Members keep their thin borders above, so the user sees
            both the group frame and what is inside it. */}
        {state.tool === "select" && !preview && !editedPathLayer && groupBounds ? (
          <SelectionOverlay
            group
            bounds={groupBounds}
            onHandlePointerDown={onResizeHandlePointerDown}
            onRotatePointerDown={onRotateHandlePointerDown}
          />
        ) : state.tool === "select" && !preview && !editedPathLayer && selectedLayer ? (
          <SelectionOverlay
            layer={selectedLayer}
            onHandlePointerDown={onResizeHandlePointerDown}
            onRotatePointerDown={onRotateHandlePointerDown}
          />
        ) : null}

        {/* BEZIER POINT EDITOR — anchors + handles for the path being edited.
            It replaces the transform box (as in Figma) because dragging an
            anchor and dragging the layer frame would otherwise fight. */}
        {editedPathLayer ? (
          <PathEditOverlay
            engine={engine}
            layer={editedPathLayer}
            zoom={zoom}
            selectedIndex={
              state.selectedAnchor?.layerId === editedPathLayer.id ? state.selectedAnchor.index : null
            }
            toBoardPoint={pointerPos}
          />
        ) : null}

        {/* Visual rendering — the SHARED document projection (`LayerBox`).
            The stage, the export surface and the public card all render this
            same code, so they cannot drift apart. Every layer is rendered
            (hidden ones through opacity 0), exactly like export. */}
        <div className="pointer-events-none absolute inset-0" style={{ background: doc.background }}>
          {doc.layers.map((layer, index) => (
            <LayerBox key={`v-${layer.id}`} layer={layer} z={layerZ(index)} />
          ))}
        </div>

        {/* Snap guides — rendered while dragging (design px, artboard-local). */}
        {activeGuides.length > 0 && !preview ? (
          <div className="pointer-events-none absolute inset-0 z-[1500]">
            {activeGuides.map((g, i) =>
              g.axis === "x" ? (
                <div
                  key={`gx-${i}`}
                  className="absolute top-0 bottom-0 w-px bg-fuchsia-400"
                  style={{ left: g.at }}
                />
              ) : (
                <div
                  key={`gy-${i}`}
                  className="absolute left-0 right-0 h-px bg-fuchsia-400"
                  style={{ top: g.at }}
                />
              ),
            )}
          </div>
        ) : null}

        {/* Working Stroke Preview */}
        {state.workingStroke && state.workingStroke.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-[2000]">
            <svg style={{ width: "100%", height: "100%", overflow: "visible" }} viewBox={`0 0 ${doc.artboard.width} ${doc.artboard.height}`}>
              <path
                d={pathD(createFreehandPath(state.workingStroke))}
                fill="none"
                stroke={state.brushColor}
                strokeWidth={state.brushWidth}
                strokeLinecap={state.brushStyle === "dotted" ? "round" : state.brushLinecap}
                strokeLinejoin={state.brushLinejoin}
                strokeOpacity={state.brushOpacity}
                // The SAME dash function the committed layer uses (domain/stroke),
                // so the live preview can never drift from the final stroke.
                strokeDasharray={dashArrayFor(state.brushStyle, state.brushWidth)}
              />
            </svg>
          </div>
        )}

        {/* PEN DRAFT — the live Bezier path while the pen tool is drawing. */}
        {state.tool === "pen" && state.penDraft && state.penDraft.length > 0 ? (
          <PenDraftOverlay
            draft={state.penDraft}
            cursor={penCursor}
            width={doc.artboard.width}
            height={doc.artboard.height}
            zoom={zoom}
          />
        ) : null}

        {/* RTL textarea overlay for text editing */}
        {editingLayer && (
          <textarea
            autoFocus
            dir="rtl"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitTextEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingTextId(null);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitTextEdit();
              }
            }}
            className="absolute resize-none rounded-md border-2 border-cyan-400 bg-white/95 p-1 text-slate-900 outline-none"
            style={{
              left: editingLayer.x,
              top: editingLayer.y,
              width: editingLayer.width,
              height: editingLayer.height,
              zIndex: 2000,
              fontSize: editingLayer.fontSize * 0.6,
              fontWeight: editingLayer.fontWeight,
              fontFamily: editingLayer.fontFamily === "serif" ? "serif" : "Vazirmatn, sans-serif",
              textAlign: editingLayer.align === "center" ? "center" : editingLayer.align === "end" ? "end" : "start",
            }}
          />
        )}
      </div>
      </div>

      {/* Multi-select align/distribute bar (appears when ≥2 layers are picked). */}
      {state.selection.ids.length >= 2 && !preview ? (
        <div className="absolute bottom-3 left-3 z-[3000] flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0c1626]/90 p-1.5 text-slate-200 backdrop-blur">
          <span className="px-1 text-[10px] text-slate-400">{state.selection.ids.length} لایه</span>
          <button type="button" title="تراز به چپ" onClick={() => engine.alignSelection("left")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↤</button>
          <button type="button" title="تراز افقی به وسط" onClick={() => engine.alignSelection("centerX")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↔</button>
          <button type="button" title="تراز به راست" onClick={() => engine.alignSelection("right")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↦</button>
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <button type="button" title="تراز به بالا" onClick={() => engine.alignSelection("top")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↥</button>
          <button type="button" title="تراز عمودی به وسط" onClick={() => engine.alignSelection("centerY")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↕</button>
          <button type="button" title="تراز به پایین" onClick={() => engine.alignSelection("bottom")} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">↧</button>
          {state.selection.ids.length >= 3 && (
            <>
              <span className="mx-0.5 h-4 w-px bg-white/10" />
              <button type="button" title="توزیع افقی" onClick={() => engine.distribute("x")} className="rounded-lg px-2 py-1 text-[10px] hover:bg-white/10">فاصله افقی</button>
              <button type="button" title="توزیع عمودی" onClick={() => engine.distribute("y")} className="rounded-lg px-2 py-1 text-[10px] hover:bg-white/10">فاصله عمودی</button>
            </>
          )}
        </div>
      ) : null}

      {/* Zoom controls (bottom-left, always reachable; RTL-safe) */}
      {preview ? null : (
        <div className="absolute bottom-3 right-3 z-[3000] flex items-center gap-1 rounded-xl border border-white/10 bg-[#0c1626]/90 p-1.5 text-slate-200 backdrop-blur">
          <button
            type="button"
            onClick={zoomOut}
            className="rounded-lg px-2 py-1 text-sm hover:bg-white/10"
            title="کوچک‌نمایی"
          >
            −
          </button>
          <button
            type="button"
            onClick={zoomFit}
            className="min-w-[52px] rounded-lg px-2 py-1 text-xs tabular-nums hover:bg-white/10"
            title="جا دادن در صفحه"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="rounded-lg px-2 py-1 text-sm hover:bg-white/10"
            title="بزرگ‌نمایی"
          >
            +
          </button>
        </div>
      )}

      {/* EXPORT SURFACE — 1:1 unscaled artboard, visually hidden but still
          in the DOM so html-to-image can rasterize it. Positioned off the
          normal flow so it never affects layout. EXACTLY matches the stage
          visuals (same LayeredCard projection), so exported PNG/JPG output
          and the on-screen preview always agree. */}
      {exportRef ? (
        <div
          aria-hidden="true"
          style={{ position: "fixed", left: -99999, top: 0, width: doc.artboard.width, height: doc.artboard.height }}
        >
          <div ref={exportRef} style={{ width: doc.artboard.width, height: doc.artboard.height }}>
            <LayeredCard doc={doc} scale={1} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EditorStage;
