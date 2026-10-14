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
import { Check, X, PenTool as PenToolIcon, Pencil as PencilIcon, Combine, SquareStack, GitMerge, Grip } from "lucide-react";
import type { CardDocument, CardLayer, PathLayer, TextLayer } from "../domain/document";
import { layerZ } from "../domain/document";
import { EditorEngine, type ResizeHandle } from "../engine/EditorEngine";
import { useCardEditor } from "./useCardEditor";
import { LayerBox, LayeredCard } from "./LayeredCardRenderer";
import { SelectionOverlay } from "./SelectionOverlay";
import {
  PEN_ANGLE_SNAP_DEGREES,
  constrainPenPoint,
  shouldBeginHandleDrag,
  exceedsClickThreshold,
} from "../domain/penGesture";
import { ANGLE_ASSIST_PRESETS, axisAlignedGuideLines, projectOnGuide, type UserGuide } from "../domain/guides";
import { RulersAndGuides } from "./RulersAndGuides";
import { AngleDial } from "./AngleDial";
import { SetSquareOverlay } from "./SetSquareOverlay";
import { closestPointOnSegment, type SetSquare } from "../domain/setSquare";
import { nearestLockedStraightedge, type LockedStraightedgeHit } from "../domain/draftingSnap";
import { layerHitCursor } from "../domain/cursorPolicy";
import { getBrushStrokeOutline, smoothFreehandSample, type FreehandPoint } from "../domain/freehand";
import { pathD } from "../domain/path";
import { constrainToAngle } from "../domain/pathOps";
import { PenDraftOverlay, PathEditOverlay, ArcBendHandleOverlay, CLOSE_SLOP } from "./BezierOverlays";
import { useQrAssets } from "./useQrAssets";
import { useAltHeld } from "./useAltHeld";
import { validateCardImageFile } from "../domain/imageUpload";
import {
  clampZoom,
  keepInside,
  panForZoomAtPoint,
  snapCoordinate,
  snapLayerPosition,
  type SnapGuide,
} from "../domain/geometry";
import { selectLayerIdsByMarquee } from "../domain/selectionMarquee";
import { allowEditingShortcut, codeOf, isEditableTarget, isShortcutDialogOpen } from "../domain/keyboardGuards";

type Props = {
  engine: EditorEngine;
  doc: CardDocument;
  /** Points at the 1:1 artboard element (used by html-to-image export). */
  exportRef?: React.Ref<HTMLDivElement>;
  /** Preview mode hides selection/handles/guides/inspector affordances. */
  preview?: boolean;
  /** Persist a picked/dropped image file and return its server path. */
  onUploadImage?: (file: File) => Promise<string>;
};

function worldAnchorPosition(layer: PathLayer, index: number): { x: number; y: number } {
  const point = layer.points[index];
  const angle = ((layer.angle ?? 0) * Math.PI) / 180;
  const dx = point.x - layer.width / 2;
  const dy = point.y - layer.height / 2;
  return {
    x: layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function EditorStage({ engine, doc, exportRef, preview = false, onUploadImage }: Props) {
  const state = useCardEditor(engine);
  // Owner-session QR assets: the canvas AND the export surface read the same
  // DOM, so registering here is what makes a draft business's QR real in both.
  // The revision MUST be threaded into the renderers (see `qrRevision`): the
  // registry is module state, so nothing else tells React that `qrSrcFor()`
  // started returning an authenticated data URL — the layer would keep the
  // anonymous `/api/qr/{slug}` fallback, which 404s for a draft business.
  const qrRevision = useQrAssets(doc);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const isManualZoomRef = useRef(false);
  const lastWidthRef = useRef(0);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const dragRef = useRef<{ layerId: string; offsetX: number; offsetY: number } | null>(null);
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const [angleDial, setAngleDial] = useState<{ vertex: { x: number; y: number }; baseAngle: number } | null>(null);
  const [setSquareNotice, setSetSquareNotice] = useState("");
  const [engagedSetSquareEdge, setEngagedSetSquareEdge] = useState<{ squareId: string; edgeIndex: number } | null>(null);
  /** Rubber bands in artboard coordinates; node and layer selection are separate gestures. */
  const [nodeMarquee, setNodeMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [layerMarquee, setLayerMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const layerMarqueeRef = useRef<{ x0: number; y0: number } | null>(null);
  const layerMarqueeEndRef = useRef<{ x: number; y: number } | null>(null);
  const layerMarqueeShiftRef = useRef(false);
  const nodeMarqueeRef = useRef<{ x0: number; y0: number } | null>(null);
  const marqueeEndRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeShiftRef = useRef(false);
  /**
   * Where the armed node marquee began, which decides what a click (no travel)
   * on pointerup means: on the edited layer's box it LEAVES point-editing with
   * the layer still selected; on empty canvas it deselects. Null `marqueeEndRef`
   * is the "never crossed the threshold, so this was a click" signal.
   */
  const nodeMarqueeKindRef = useRef<"editedLayer" | "stage" | null>(null);
  const [mirrorAxisPickMode, setMirrorAxisPickMode] = useState(false);
  const [mirrorAxis, setMirrorAxis] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number } | null;
  } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<number | null>(null);
  /** Alt down right now — the "drag the whole layer" modifier of the node mode. */
  const altHeld = useAltHeld();
  const panRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState("");
  const anchorXInputRef = useRef<HTMLInputElement>(null);
  const anchorYInputRef = useRef<HTMLInputElement>(null);
  const tangentAngleInputRef = useRef<HTMLInputElement>(null);
  const tangentLengthInputRef = useRef<HTMLInputElement>(null);

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const available = el.clientWidth;
    lastWidthRef.current = available;
    const target = Math.min(1, Math.max(0.2, (available - 24) / doc.artboard.width));
    setZoom(clampZoom(target));
    setPan({ x: 0, y: 0 });
    isManualZoomRef.current = false;
  }, [doc.artboard.width]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fitToContainer();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (Math.abs(width - lastWidthRef.current) > 25) {
          lastWidthRef.current = width;
          if (!isManualZoomRef.current) {
            fitToContainer();
          }
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  const zoomIn = useCallback(() => {
    isManualZoomRef.current = true;
    setZoom((z) => clampZoom(z * 1.25));
  }, []);

  const zoomOut = useCallback(() => {
    isManualZoomRef.current = true;
    setZoom((z) => clampZoom(z / 1.25));
  }, []);

  const zoomFit = useCallback(() => {
    fitToContainer();
  }, [fitToContainer]);

  const setZoomPreset = useCallback((val: number) => {
    isManualZoomRef.current = true;
    setZoom(clampZoom(val));
  }, []);

  /**
   * Wheel zoom at the cursor (Ctrl/Cmd): the artboard point UNDER the pointer
   * stays exactly put, like Figma/Photoshop.
   */
  const onStageWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();

    const inner = containerRef.current?.querySelector("[data-stage-inner]") as HTMLElement | null;
    if (!inner) return;

    const current = zoom;
    const next = clampZoom(event.deltaY < 0 ? current * 1.1 : current / 1.1);
    if (next === current) return;

    isManualZoomRef.current = true;
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
  const selectedNodeIndices = state.editingPathId
    ? engine.selectedAnchorIndices(state.editingPathId)
    : [];
  const canDeleteSelectedNodes =
    editedPathLayer !== null &&
    selectedNodeIndices.length > 0 &&
    editedPathLayer.points.length - selectedNodeIndices.length >= (editedPathLayer.closed ? 3 : 2);
  const selectedNodeIndex = selectedNodeIndices.length === 1 ? selectedNodeIndices[0] : null;
  const selectedNodePosition =
    editedPathLayer && selectedNodeIndex !== null
      ? worldAnchorPosition(editedPathLayer, selectedNodeIndex)
      : null;
  const selectedNode = editedPathLayer && selectedNodeIndex !== null
    ? editedPathLayer.points[selectedNodeIndex]
    : null;
  const selectedHandleLength = selectedNode?.hOut
    ? Math.hypot(selectedNode.hOut.x - selectedNode.x, selectedNode.hOut.y - selectedNode.y)
    : 40;
  const selectedTangentAngle = selectedNode?.hOut
    ? Math.round(
        (Math.atan2(selectedNode.hOut.y - selectedNode.y, selectedNode.hOut.x - selectedNode.x) * 180) / Math.PI +
          (editedPathLayer?.angle ?? 0),
      )
    : 0;

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

  const brushPointerPos = (event: { clientX: number; clientY: number }) => {
    const rect = brushRectRef.current;
    if (!rect) return pointerPos(event);
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };

  const onMirrorAxisPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mirrorAxisPickMode || preview) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-edit-toolbar]")) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPos(event);
    if (point.x < 0 || point.y < 0 || point.x > doc.artboard.width || point.y > doc.artboard.height) return;
    if (!mirrorAxis) {
      setMirrorAxis({ start: point, end: null });
      return;
    }
    if (Math.hypot(point.x - mirrorAxis.start.x, point.y - mirrorAxis.start.y) < 1) return;
    setMirrorAxis({ ...mirrorAxis, end: point });
    setMirrorAxisPickMode(false);
  };

  const isDrawingRef = useRef(false);
  const brushPtsRef = useRef<FreehandPoint[]>([]);
  const brushSmoothRef = useRef<FreehandPoint | null>(null);
  const brushLastTimeRef = useRef<number | null>(null);
  const brushRectRef = useRef<DOMRect | null>(null);
  const brushEngagedGuideRef = useRef<UserGuide | null>(null);
  const brushEngagedSquareRef = useRef<{ square: SetSquare; edgeIndex: number; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);
  const liveBrushRef = useRef<SVGPathElement>(null);
  const liveGuideBrushRef = useRef<SVGPathElement>(null);
  const brushRafRef = useRef(0);
  const isPenInputRef = useRef(false);
  /** True only once the pen click has crossed PEN_DRAG_THRESHOLD_PX (domain/penGesture). */
  const penDragRef = useRef(false);
  const penEngagedStraightedgeRef = useRef<LockedStraightedgeHit | null>(null);
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
    // While POINT-EDITING, pressing on the EDITED path's hit-area starts the
    // NODE MARQUEE instead of dragging the layer, exactly like Figma's vector
    // mode. Pressing a DIFFERENT layer leaves point-editing and selects it —
    // otherwise the mode (entered automatically right after a stroke is drawn)
    // swallowed the click and the existing line/path could not be re-selected.
    if (state.editingPathId === layerId && !event.altKey) {
      const pos = pointerPos(event);
      // ARM the marquee without painting it. A press that never travels is a
      // CLICK, and a click here must be able to leave point-editing with the
      // layer still selected — there was otherwise no mouse path at all from
      // "editing this path" to "this path is selected", because every press on
      // this box used to be swallowed by a zero-size rubber band.
      nodeMarqueeRef.current = { x0: pos.x, y0: pos.y };
      marqueeEndRef.current = null;
      marqueeShiftRef.current = event.shiftKey;
      nodeMarqueeKindRef.current = "editedLayer";
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }
    // ALT over the edited path (spilled out of the node toolbar's own contract)
    // falls through to the layer move below: while point-editing, the box press
    // would otherwise start a node marquee, and the user could not nudge the
    // whole line without leaving the mode.
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
  // All physical keys are matched by `code` (layout-independent) so a Persian
  // keyboard cannot turn Delete / arrows / Enter into dead keys.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // While the shortcuts overlay is open the document is frozen: every
      // editing key (Delete, arrows, Ctrl+D…) belongs to the modal, not the
      // canvas, so the overlay behaves like the modal it claims to be.
      if (preview || !allowEditingShortcut(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const id = state.selection.layerId;
      const layer = id ? doc.layers.find((l) => l.id === id) : null;
      const code = codeOf(e);

      // H toggles node handles — only meaningful while point-editing.
      if (state.editingPathId && code === "keyh") {
        e.preventDefault();
        engine.toggleShowNodes();
        return;
      }

      // Escape: close pen draft, exit path editing, or deselect — all without
      // a selected layer requirement.
      if (code === "escape") {
        if (state.penDraft) {
          if (state.penDraft.length >= 2) {
            engine.finishPen(false);
          } else {
            engine.cancelPen();
          }
          engine.setTool("select");
          return;
        }
        if (state.editingPathId) {
          engine.setPathEditing(null);
          return;
        }
        if (state.selection.layerId) engine.select(null);
        return;
      }

      // Enter: finish/cancel pen draft, or enter path-editing mode on a path.
      if (code === "enter") {
        if (state.penDraft) {
          e.preventDefault();
          if (state.penDraft.length >= 2) {
            engine.finishPen(false);
          } else {
            engine.cancelPen();
          }
          engine.setTool("select");
          return;
        }
        if (layer?.kind === "path" && state.tool === "select") {
          e.preventDefault();
          engine.setPathEditing(layer.id);
          return;
        }
      }

      const anchor = state.selectedAnchor;

      // NODE MODE: Delete/Backspace removes node GROUP (multi-node) or single
      // anchor. Works without a selected layer — only needs active path editing.
      if (code === "delete" && state.editingPathId) {
        e.preventDefault();
        if (!engine.deleteSelectedAnchors()) {
          if (anchor && state.editingPathId === anchor.layerId) engine.removeAnchorAt(anchor.layerId, anchor.index);
        }
        return;
      }
      if (code === "backspace" && state.editingPathId) {
        e.preventDefault();
        if (!engine.deleteSelectedAnchors()) {
          if (anchor && state.editingPathId === anchor.layerId) engine.removeAnchorAt(anchor.layerId, anchor.index);
        }
        return;
      }

      // Ctrl+A selects all anchors of the edited path.
      if (mod && code === "keya" && state.editingPathId) {
        e.preventDefault();
        engine.selectAllAnchors();
        return;
      }

      // Arrow nudge in node mode — moves the selected node GROUP.
      if (
        state.editingPathId &&
        anchor &&
        (code === "arrowleft" || code === "arrowright" || code === "arrowup" || code === "arrowdown")
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          code === "arrowleft" ? -step : code === "arrowright" ? step : 0;
        const dy =
          code === "arrowup" ? -step : code === "arrowdown" ? step : 0;
        engine.moveSelectedAnchors(dx, dy);
        return;
      }

      // While point-editing, Delete/Backspace on a single selected anchor removes
      // just that anchor.
      if (
        (code === "delete" || code === "backspace") &&
        anchor &&
        state.editingPathId === anchor.layerId
      ) {
        e.preventDefault();
        engine.removeAnchorAt(anchor.layerId, anchor.index);
        return;
      }

      // Layer-level actions require a selected layer.
      if (!layer) return;

      // Delete/Backspace removes the selected layer.
      if (code === "delete" || code === "backspace") {
        e.preventDefault();
        engine.deleteLayer(layer.id);
        return;
      }

      // Ctrl+D duplicates the selected layer.
      if (mod && code === "keyd") {
        e.preventDefault();
        engine.duplicateLayer(layer.id);
        return;
      }

      // Ctrl+C copies the selected layer to the stage clipboard.
      if (mod && code === "keyc") {
        e.preventDefault();
        clipboard.current = JSON.parse(JSON.stringify(layer));
        // Brief confirmation so the user knows the copy landed.
        setCopyFeedback(Date.now());
        if (copyFeedbackTimer.current) window.clearTimeout(copyFeedbackTimer.current);
        copyFeedbackTimer.current = window.setTimeout(() => setCopyFeedback(null), 1200);
        return;
      }

      // Ctrl+V pastes from the stage clipboard (does NOT need a selected layer).
      if (mod && code === "keyv") {
        if (!clipboard.current) return;
        e.preventDefault();
        engine.pasteLayer(clipboard.current);
        return;
      }

      // Arrow nudge (Shift = coarse 10px step). One history entry per keydown.
      const step = e.shiftKey ? 10 : 1;
      if (code === "arrowleft") {
        e.preventDefault();
        engine.nudge(layer.id, -step, 0);
      } else if (code === "arrowright") {
        e.preventDefault();
        engine.nudge(layer.id, step, 0);
      } else if (code === "arrowup") {
        e.preventDefault();
        engine.nudge(layer.id, 0, -step);
      } else if (code === "arrowdown") {
        e.preventDefault();
        engine.nudge(layer.id, 0, step);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [engine, doc, state.selection.layerId, state.penDraft, state.editingPathId, state.selectedAnchor, state.tool, preview]);

  const clipboard = useRef<CardLayer | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);

  // Clear the copy feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current) window.clearTimeout(copyFeedbackTimer.current);
    };
  }, []);

  // Space toggles the pan cursor. Bound on window so the state is right even
  // when focus is on a handle/input elsewhere in the stage.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Space pans the canvas — but only when the help overlay is NOT open,
      // where Space belongs to the modal (scrolling its content).
      if (e.code === "Space" && !isEditableTarget(e.target) && !isShortcutDialogOpen() && !spaceDown) {
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
      const raw = pointerPos(event);
      const draft = state.penDraft;
      // Clicking the FIRST anchor closes the path — the Figma/Illustrator
      // contract. The target is generous, but only offered once there is
      // actually something to close. RAW position on purpose: the Shift angle
      // lock must never push the pointer off the anchor it is closing on.
      if (draft && draft.length >= 2 && Math.hypot(raw.x - draft[0].x, raw.y - draft[0].y) <= CLOSE_SLOP / zoom) {
        engine.finishPen(true);
        setPenCursor(null);
        return;
      }
      // ANGLE LOCK: Shift gives the documented 45° grid, the "set-square"
      // toggle gives its own grid. The new segment is measured from the PREVIOUS
      // anchor, so a horizontal/vertical/diagonal segment is one key away.
      const straightedge = nearestLockedStraightedge(raw, state.guides, state.setSquares, zoom);
      const snappedRaw = straightedge?.point ?? raw;
      const increments = penAngleLock(event);
      const previous = draft && draft.length > 0 ? draft[draft.length - 1] : null;
      const pos = straightedge
        ? snappedRaw
        : previous && increments.length > 0 ? constrainPenPoint(previous, raw, true, increments) : raw;
      penEngagedStraightedgeRef.current = straightedge;
      if (draft && draft.length > 0) {
        if (straightedge) engine.penAddStraightAnchor(pos);
        else engine.penAddAnchor(pos);
      } else engine.penStart(pos);
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
      (event.target as Element).setPointerCapture?.(event.pointerId);
      isDrawingRef.current = true;
      isPenInputRef.current = event.pointerType === "pen";
      const stageElement = containerRef.current?.querySelector("[data-stage-inner]") as HTMLElement | null;
      brushRectRef.current = stageElement?.getBoundingClientRect() ?? null;
      const rawPos = brushPointerPos(event);
      const straightedge = nearestLockedStraightedge(rawPos, state.guides, state.setSquares, zoom);
      const engaged = straightedge?.kind === "guide" ? straightedge.guide : null;
      const squareEdge = straightedge?.kind === "set-square"
        ? { square: straightedge.square, edgeIndex: straightedge.edgeIndex, a: straightedge.a, b: straightedge.b }
        : null;
      brushEngagedGuideRef.current = engaged;
      brushEngagedSquareRef.current = squareEdge;
      setEngagedSetSquareEdge(squareEdge ? { squareId: squareEdge.square.id, edgeIndex: squareEdge.edgeIndex } : null);
      const pos = straightedge?.point ?? rawPos;
      const pt: FreehandPoint = { x: pos.x, y: pos.y, p: event.pressure || 0.5 };
      brushPtsRef.current = [pt];
      brushSmoothRef.current = pt;
      brushLastTimeRef.current = event.timeStamp;
      brushStartRef.current = { x: pos.x, y: pos.y };
      return;
    }
    // NODE MARQUEE: while point-editing, an empty-stage drag rubber-bands a
    // selection rect (Figma's node marquee). Shift keeps what was selected.
    if (state.editingPathId) {
      // The edited layer's own hit-area arms the SAME press and lets it bubble
      // here. Returning is the whole point: re-arming would relabel a click on
      // the layer as a click on empty canvas, and falling through would run the
      // deselect below and throw away the selection we are trying to keep.
      if (nodeMarqueeRef.current) return;
      const pos = pointerPos(event);
      nodeMarqueeRef.current = { x0: pos.x, y0: pos.y };
      marqueeEndRef.current = null;
      marqueeShiftRef.current = event.shiftKey;
      nodeMarqueeKindRef.current = "stage";
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }
    // In selection mode, a press on empty artboard space arms a layer marquee.
    // If the pointer never crosses the click threshold, pointer-up remains a
    // plain deselect (or leaves the existing selection intact with Shift).
    if (state.tool === "select" && !preview) {
      const pos = pointerPos(event);
      const insideArtboard =
        pos.x >= 0 && pos.y >= 0 &&
        pos.x <= doc.artboard.width && pos.y <= doc.artboard.height;
      if (insideArtboard) {
        layerMarqueeRef.current = { x0: pos.x, y0: pos.y };
        layerMarqueeEndRef.current = null;
        layerMarqueeShiftRef.current = event.shiftKey;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        return;
      }
    }
    engine.select(null);
  };

    const brushOptions = () => ({
    size: state.brushWidth || 14,
    thinning: 0.55,
    smoothing: state.freehandTuning.smoothing,
    streamline: state.freehandTuning.smoothing,
    simulatePressure: !isPenInputRef.current,
    last: true,
  });

  const renderLiveBrush = () => {
    brushRafRef.current = 0;
    const samples = brushPtsRef.current;
    if ((brushEngagedGuideRef.current || brushEngagedSquareRef.current) && samples.length > 0) {
      const first = samples[0];
      const last = samples[samples.length - 1] ?? first;
      liveBrushRef.current?.setAttribute("d", "");
      const guidePath = liveGuideBrushRef.current;
      guidePath?.setAttribute("d", `M ${first.x} ${first.y} L ${last.x} ${last.y}`);
      guidePath?.setAttribute("stroke", state.brushColor || "#0ea5e9");
      guidePath?.setAttribute("stroke-width", String(state.brushWidth || 14));
      guidePath?.setAttribute("opacity", String(state.brushOpacity));
      return;
    }
    liveGuideBrushRef.current?.setAttribute("d", "");
    if (samples.length === 1) {
      const p = samples[0];
      const pressureScale = isPenInputRef.current ? Math.max(0.2, Math.min(1, p.p)) : 1;
      const radius = (state.brushWidth || 14) * pressureScale / 2;
      liveBrushRef.current?.removeAttribute("transform");
      liveBrushRef.current?.setAttribute("opacity", String(state.brushOpacity));
      liveBrushRef.current?.setAttribute("d", `M ${p.x - radius} ${p.y} A ${radius} ${radius} 0 1 0 ${p.x + radius} ${p.y} A ${radius} ${radius} 0 1 0 ${p.x - radius} ${p.y} Z`);
      return;
    }
    const outline = getBrushStrokeOutline(samples, brushOptions());
    const geometry = engine.freehandOutlineGeometry(outline, state.freehandTuning.fidelity);
    if (geometry) {
      liveBrushRef.current?.setAttribute("d", pathD(geometry.points, true));
      liveBrushRef.current?.setAttribute("transform", `translate(${geometry.x} ${geometry.y})`);
      liveBrushRef.current?.setAttribute("opacity", String(state.brushOpacity));
    } else {
      liveBrushRef.current?.setAttribute("d", "");
      liveBrushRef.current?.removeAttribute("transform");
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
      const penDraft = state.penDraft;
      const anchor = penDraft && penDraft.length > 0 ? penDraft[penDraft.length - 1] : null;
      const increments = penAngleLock(event);
      const currentHit = nearestLockedStraightedge(pos, state.guides, state.setSquares, zoom);
      const straightedge = penEngagedStraightedgeRef.current ?? currentHit;
      const snapped = straightedge
        ? straightedge.kind === "guide" ? projectOnGuide(straightedge.guide, pos) : closestPointOnSegment(pos, straightedge.a, straightedge.b).point
        : pos;
      // A physical straightedge takes precedence over angle assists and never
      // introduces Bézier handles: the preview and committed segment stay exact.
      const locked = straightedge ? snapped : anchor && increments.length > 0 ? constrainPenPoint(anchor, pos, true, increments) : pos;
      if (penDraft) setPenCursor(locked);
      if (!penDragRef.current && penStartRef.current && shouldBeginHandleDrag(penStartRef.current, pos, zoom)) {
        penDragRef.current = true;
      }
      if (penDragRef.current) {
        if (straightedge) {
          penEngagedStraightedgeRef.current = straightedge;
          engine.penMoveLastAnchor(locked);
        } else {
          engine.penDragHandle(locked);
        }
      }
      return;
    }
    if (isDrawingRef.current && state.tool === "draw") {
      const evs = (event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents?.() ?? [event.nativeEvent];
      for (const ev of evs) {
        const raw = brushPointerPos(ev);
        const start = brushStartRef.current;
        let constrained = raw;
        if (start && (state.freehandMode === "straight" || state.freehandMode === "constrained" || ev.shiftKey)) {
          const anchor = state.freehandMode === "constrained"
            ? (brushSmoothRef.current ?? start)
            : start;
          constrained = constrainToAngle(anchor, raw, {
            increments: state.freehandTuning.angleIncrements,
            tolerance: state.freehandTuning.angleTolerance,
            axisLock: state.freehandTuning.axisLock || ev.shiftKey,
          });
        }
        const engagedGuide = brushEngagedGuideRef.current;
        const engagedSquare = brushEngagedSquareRef.current;
        if (engagedGuide) constrained = projectOnGuide(engagedGuide, raw);
        else if (engagedSquare) constrained = closestPointOnSegment(raw, engagedSquare.a, engagedSquare.b).point;
        const s = brushSmoothRef.current ?? { x: constrained.x, y: constrained.y, p: ev.pressure || 0.5 };
        const previousTime = brushLastTimeRef.current;
        const elapsedMs = previousTime == null ? 0 : Math.max(0, ev.timeStamp - previousTime);
        brushLastTimeRef.current = ev.timeStamp;
        const np = (brushEngagedGuideRef.current || brushEngagedSquareRef.current)
          ? { x: constrained.x, y: constrained.y, p: ev.pressure || 0.5 }
          : smoothFreehandSample(
              s,
              { x: constrained.x, y: constrained.y, p: ev.pressure || 0.5 },
              elapsedMs,
              8 + state.freehandTuning.smoothing * 42,
            );
        const last = brushPtsRef.current[brushPtsRef.current.length - 1];
        // Sampling density is measured in document units, never screen pixels.
        if (last && Math.hypot(np.x - last.x, np.y - last.y) < 1) continue;
        brushSmoothRef.current = np;
        brushPtsRef.current.push(np);
      }
      if (!brushRafRef.current) {
        brushRafRef.current = requestAnimationFrame(renderLiveBrush);
      }
      return;
    }
    // Whole-layer marquee. Clamp to the artboard so dragging beyond its edge
    // does not produce negative/out-of-board selection coordinates.
    if (layerMarqueeRef.current) {
      const origin = layerMarqueeRef.current;
      const current = {
        x: Math.max(0, Math.min(doc.artboard.width, pos.x)),
        y: Math.max(0, Math.min(doc.artboard.height, pos.y)),
      };
      if (layerMarqueeEndRef.current === null &&
          !exceedsClickThreshold({ x: origin.x0, y: origin.y0 }, current, zoom)) {
        return;
      }
      layerMarqueeEndRef.current = current;
      setLayerMarquee({ x0: origin.x0, y0: origin.y0, x1: current.x, y1: current.y });
      return;
    }
    // NODE MARQUEE tracking: sample the pointer while the rubber band is live
    // (no transform is active during a node marquee, so this runs BEFORE the
    // transform guard).
    if (nodeMarqueeRef.current) {
      const pos = pointerPos(event);
      // Stay INVISIBLE until the press has actually travelled. Until then it
      // is still a click, and the click is what leaves point-editing.
      if (marqueeEndRef.current === null) {
        const origin = nodeMarqueeRef.current;
        if (!exceedsClickThreshold({ x: origin.x0, y: origin.y0 }, pos, zoom)) return;
        marqueeEndRef.current = pos;
        setNodeMarquee({ x0: origin.x0, y0: origin.y0, x1: pos.x, y1: pos.y });
        return;
      }
      marqueeEndRef.current = pos;
      setNodeMarquee((current) => (current ? { ...current, x1: pos.x, y1: pos.y } : current));
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
    const snapped = snapLayerPosition(doc, transform.layerId, { x: rawX, y: rawY }, { width: layer.width, height: layer.height }, 6, axisAlignedGuideLines(state.guides, doc.artboard));
    setActiveGuides(snapped.guides);
    const kept = keepInside(snapped.pos.x, snapped.pos.y, layer.width, layer.height);
    engine.transientMove(transform.layerId, kept.x, kept.y);
  };

  const onStagePointerCancel = () => {
    // Cancelled pointer sequences must never commit a partial stroke.
    isDrawingRef.current = false;
    isPenInputRef.current = false;
    if (brushRafRef.current) {
      cancelAnimationFrame(brushRafRef.current);
      brushRafRef.current = 0;
    }
    brushPtsRef.current = [];
    brushSmoothRef.current = null;
    brushLastTimeRef.current = null;
    brushRectRef.current = null;
    brushEngagedGuideRef.current = null;
    brushStartRef.current = null;
    liveBrushRef.current?.setAttribute("d", "");
    liveGuideBrushRef.current?.setAttribute("d", "");
    penStartRef.current = null;
    penDragRef.current = false;
    penEngagedStraightedgeRef.current = null;
  };

  const onStagePointerUp = () => {
    if (layerMarqueeRef.current) {
      const start = layerMarqueeRef.current;
      const end = layerMarqueeEndRef.current;
      const additive = layerMarqueeShiftRef.current;
      layerMarqueeRef.current = null;
      layerMarqueeEndRef.current = null;
      setLayerMarquee(null);

      if (end === null) {
        if (!additive) engine.select(null);
        return;
      }

      const newlySelected = selectLayerIdsByMarquee(doc.layers, { x: start.x0, y: start.y0 }, end);
      const merged = [...new Set([...(additive ? engine.selectedIds() : []), ...newlySelected])];
      if (merged.length === 0) {
        engine.select(null);
      } else {
        engine.select(merged[0]);
        for (const id of merged.slice(1)) engine.select(id, true);
      }
      return;
    }
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (penDragRef.current || penStartRef.current) {
      // A pen click/drag ends the moment the pointer lifts; the DRAFT stays
      // alive until the path is closed or committed.
      penDragRef.current = false;
      penStartRef.current = null;
      penEngagedStraightedgeRef.current = null;
      return;
    }
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      if (brushRafRef.current) {
        cancelAnimationFrame(brushRafRef.current);
        brushRafRef.current = 0;
      }
      renderLiveBrush();
      const pts = brushPtsRef.current;
      const options = {
        color: state.brushColor || "#0ea5e9",
        width: state.brushWidth || 14,
        style: state.brushStyle,
        linecap: state.brushLinecap,
        linejoin: state.brushLinejoin,
        opacity: state.brushOpacity,
      };
      if ((brushEngagedGuideRef.current || brushEngagedSquareRef.current) && pts.length > 0) {
        const start = pts[0];
        const end = pts[pts.length - 1] ?? start;
        engine.commitStraightStroke({ x: start.x, y: start.y }, { x: end.x, y: end.y }, options, isPenInputRef.current ? end.p : 1);
      } else if (pts.length > 1) {
        const outline = getBrushStrokeOutline(pts, brushOptions());
        const committed = engine.commitFreehandOutline(outline, { ...options, fidelity: state.freehandTuning.fidelity });
        if (!committed) {
          const last = pts[pts.length - 1];
          engine.commitFreehandDot({ x: last.x, y: last.y }, options, isPenInputRef.current ? last.p : 1);
        }
      } else if (pts.length === 1) {
        engine.commitFreehandDot({ x: pts[0].x, y: pts[0].y }, options, isPenInputRef.current ? pts[0].p : 1);
      }
      brushEngagedGuideRef.current = null;
      brushEngagedSquareRef.current = null;
      setEngagedSetSquareEdge(null);
      brushRectRef.current = null;
      brushPtsRef.current = [];
      brushSmoothRef.current = null;
      brushLastTimeRef.current = null;
      brushStartRef.current = null;
      liveBrushRef.current?.setAttribute("d", "");
      liveGuideBrushRef.current?.setAttribute("d", "");
      return;
    }
    if (nodeMarqueeRef.current) {
      // Commit the node marquee: whatever the rect caught joins the selection.
      const start = nodeMarqueeRef.current;
      const kind = nodeMarqueeKindRef.current;
      nodeMarqueeRef.current = null;
      nodeMarqueeKindRef.current = null;
      const end = marqueeEndRef.current;
      setNodeMarquee(null);
      if (end === null) {
        // No travel: this was a CLICK, not a rubber band.
        if (kind === "editedLayer") {
          // Leave point-editing and KEEP the layer selected. `setPathEditing`
          // only clears the point-editor keys, so the selection (and with it
          // the inspector, delete and transform handles) survives — the Figma /
          // Illustrator contract where point-editing is a sub-mode OF a
          // selection rather than a replacement for it.
          engine.setPathEditing(null);
        } else {
          // Clicking empty canvas leaves the mode AND drops the selection.
          // `select(null)` already exits point-editing when a path was being
          // edited (see EditorEngine.select).
          engine.select(null);
        }
        return;
      }
      engine.selectAnchorsInRect(
        {
          x: Math.min(start.x0, end.x),
          y: Math.min(start.y0, end.y),
          width: Math.abs(end.x - start.x0),
          height: Math.abs(end.y - start.y0),
        },
        marqueeShiftRef.current,
      );
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

  // --- Drag-and-drop image upload -----------------------------------------
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (preview || !onUploadImage || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, [preview, onUploadImage]);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (preview || !onUploadImage || dropping) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const err = validateCardImageFile(file);
    if (err) { setDropError(err); return; }
    setDropError(null);
    setDropping(true);
    try {
      const src = await onUploadImage(file);
      // Place the image roughly where the user dropped it.
      const pos = pointerPos(e);
      engine.setTool("select");
      engine.addLayer("image", {
        src,
        radius: 12,
        objectFit: "cover",
        x: Math.max(0, pos.x - 150),
        y: Math.max(0, pos.y - 75),
        width: 300,
        height: 150,
      });
    } catch (error) {
      setDropError(error instanceof Error ? error.message : "آپلود تصویر ناموفق بود.");
    } finally {
      setDropping(false);
    }
  }, [preview, onUploadImage, dropping, engine, pointerPos]);

  const isDrawingTool = state.tool === "pen" || state.tool === "draw";

  /**
   * The angular grid a drawing gesture locks onto, in degrees.
   *
   * Shift is the documented Illustrator/Photoshop 45° constraint; the
   * "set-square" (`state.angleAssist`) is the same idea as a toggle with its own
   * increment, so a user who needs 30° does not have to hold a key for it. An
   * empty list means "no lock" — the pointer decides.
   */
  const penAngleLock = (event: { shiftKey: boolean }): number[] => {
    if (event.shiftKey) return [PEN_ANGLE_SNAP_DEGREES];
    return state.angleAssist ? [state.angleAssistIncrement] : [];
  };

  const editingLayer = useMemo(
    () => (editingTextId ? (doc.layers.find((l) => l.id === editingTextId) as TextLayer | undefined) : undefined),
    [editingTextId, doc.layers],
  );

  return (
    <div
      ref={containerRef}
      dir="ltr"
      // No viewport cap any more: the workspace GRID owns the height and this
      // column scrolls when the artboard needs more room, so the canvas is
      // never squeezed into a strip and never silently clipped.
      className={`relative z-0 w-full overflow-hidden rounded-[24px] border border-white/[0.07] ${
        state.tool === "draw" || state.tool === "pen" ? "cursor-crosshair touch-none" : ""
      } ${spaceDown ? "cursor-grab" : ""}`}
      onPointerDownCapture={onMirrorAxisPointerDown}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
       onPointerCancel={onStagePointerCancel}
      onWheel={onStageWheel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        minHeight: 420,
        height: state.editingPathId && !preview
          ? "auto"
          : Math.max(420, Math.round(doc.artboard.height * zoom) + 44),
        background:
          "radial-gradient(circle at 50% 16%, rgba(49, 70, 92, 0.22), transparent 34%), radial-gradient(circle at 12% 88%, rgba(16, 185, 129, 0.045), transparent 28%), #060b12",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025), 0 28px 80px rgba(0,0,0,0.32)",
      }}
    >
      {/* Drag-and-drop overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-[9999] flex items-center justify-center rounded-[24px] border-2 border-dashed border-cyan-400 bg-cyan-500/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-300"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span className="text-sm font-bold text-cyan-200">تصویر را اینجا رها کنید</span>
            <span className="text-[11px] text-slate-400">JPEG، PNG یا WebP — حداکثر ۵ مگابایت</span>
          </div>
        </div>
      )}

      {/* Drop error toast */}
      {dropError && (
        <div className="absolute left-4 top-4 z-[9999] flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-xs font-semibold text-rose-200 shadow-lg backdrop-blur-xl">
          <span>{dropError}</span>
          <button type="button" onClick={() => setDropError(null)} className="ml-1 text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Primary path-edit actions stay visible; precision tools are grouped below. */}
      {state.editingPathId && !preview && (
        <div
          dir="rtl"
          data-node-edit-toolbar=""
          className="relative z-[3500] mx-auto mb-2 flex w-full max-w-none flex-col items-stretch gap-2 rounded-2xl border border-white/10 bg-[#111923]/95 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
            <Grip className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold text-white">ویرایش گره‌ها</span>
            <span className="text-[10px] text-slate-400">{selectedNodeIndices.length} گره انتخاب‌شده</span>
            </div>
            <span className="text-[10px] text-slate-400">
              برای انتخاب روی گره بزنید · برای منحنی‌کردن هر نقطه، روی همان نقطه از خط بکشید · Alt+کشیدن = جابه‌جایی لایه · کلیک روی کادر = خروج از ویرایش
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              title="انتخاب همهٔ گره‌ها (Ctrl+A در حالت گره)"
              onClick={() => engine.selectAllAnchors()}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-white/10 hover:text-white"
            >
              انتخاب همه
            </button>
            <button
              type="button"
              disabled={selectedNodeIndices.length === 0}
              title="تبدیل گره‌های انتخابی به منحنی نرم"
              onClick={() => engine.setSelectedAnchorType("smooth")}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              منحنی نرم
            </button>
            <button
              type="button"
              disabled={selectedNodeIndices.length === 0}
              title="تبدیل گره‌های انتخابی به گوشهٔ تیز"
              onClick={() => engine.setSelectedAnchorType("corner")}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              گوشهٔ تیز
            </button>
            <button
              type="button"
              disabled={!canDeleteSelectedNodes}
              title="حذف گره‌های انتخابی"
              onClick={() => engine.deleteSelectedAnchors()}
              className="rounded-lg border border-rose-400/20 bg-rose-500/5 px-2.5 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40"
            >
              حذف گره
            </button>
            <button
              type="button"
              aria-pressed={state.showNodes}
              title="نمایش یا مخفی‌کردن گره‌ها (H)"
              onClick={() => engine.toggleShowNodes()}
              className={`rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold transition ${
                state.showNodes ? "text-cyan-200 hover:text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {state.showNodes ? "پنهان‌کردن گره‌ها" : "نمایش گره‌ها"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-2">
            <span className="text-[11px] font-bold text-violet-200">قرینه‌سازی</span>
            <span className="text-[10px] text-slate-400">یک محور با دو کلیک روی بوم مشخص کنید</span>
            <div className="mr-auto flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={mirrorAxisPickMode}
                title="دو نقطه روی بوم انتخاب کنید تا محور قرینه‌سازی مشخص شود"
                onClick={() => {
                  setMirrorAxis(null);
                  setMirrorAxisPickMode(true);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                  mirrorAxisPickMode
                    ? "border-violet-300/50 bg-violet-500/25 text-violet-100"
                    : "border-violet-300/20 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                }`}
              >
                {mirrorAxisPickMode ? "حالا دو نقطه روی بوم بزنید" : "انتخاب محور"}
              </button>
              <button
                type="button"
                disabled={
                  !editedPathLayer ||
                  !mirrorAxis?.end ||
                  !engine.canMirrorPathAcrossAxis(editedPathLayer.id)
                }
                title="ساخت یک نسخهٔ قرینه از شکل در سمت دیگر محور"
                onClick={() => {
                  if (!editedPathLayer || !mirrorAxis?.end) return;
                  const id = engine.duplicateMirroredPathAcrossAxis(
                    editedPathLayer.id,
                    mirrorAxis.start,
                    mirrorAxis.end,
                  );
                  if (id) setMirrorAxis(null);
                }}
                className="rounded-lg border border-violet-300/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-bold text-violet-100 hover:bg-violet-500/20 disabled:opacity-40"
              >
                ساخت نسخهٔ قرینه
              </button>
            </div>
          </div>
          <details className="rounded-xl border border-white/10 bg-white/[0.025]">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-slate-300 hover:text-white">
              تنظیمات دقیق گره و عملیات شکل
            </summary>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1">
            <span className="px-1 text-[10px] text-slate-400">جای گره:</span>
            <div className="grid grid-cols-3 gap-0.5">
              {([
                ["↖", 0, 0, "گوشهٔ بالا-چپ"],
                ["↑", 0.5, 0, "وسط بالا"],
                ["↗", 1, 0, "گوشهٔ بالا-راست"],
                ["←", 0, 0.5, "وسط چپ"],
                ["•", 0.5, 0.5, "مرکز آرت‌بورد"],
                ["→", 1, 0.5, "وسط راست"],
                ["↙", 0, 1, "گوشهٔ پایین-چپ"],
                ["↓", 0.5, 1, "وسط پایین"],
                ["↘", 1, 1, "گوشهٔ پایین-راست"],
              ] as const).map(([icon, x, y, label]) => (
                <button
                  key={label}
                  type="button"
                  title={`انتقال گره به ${label}`}
                  disabled={!editedPathLayer || selectedNodeIndex === null}
                  onClick={() => {
                    if (!editedPathLayer || selectedNodeIndex === null) return;
                    engine.setAnchorWorldPosition(editedPathLayer.id, selectedNodeIndex, {
                      x: doc.artboard.width * x,
                      y: doc.artboard.height * y,
                    });
                  }}
                  className="h-5 w-5 rounded text-[11px] text-slate-300 hover:bg-cyan-500/20 hover:text-cyan-100 disabled:opacity-30"
                >
                  {icon}
                </button>
              ))}
            </div>
            <div key={`${state.editingPathId}-${selectedNodeIndex}`} className="flex items-center gap-1 border-r border-white/10 pr-1.5">
              <input
                ref={anchorXInputRef}
                type="number"
                aria-label="مختصات افقی گره"
                title="مختصات X روی آرت‌بورد"
                defaultValue={selectedNodePosition ? Math.round(selectedNodePosition.x) : ""}
                disabled={selectedNodeIndex === null}
                className="w-12 rounded border border-white/10 bg-black/20 px-1 py-1 text-center text-[10px] text-white disabled:opacity-30"
              />
              <input
                ref={anchorYInputRef}
                type="number"
                aria-label="مختصات عمودی گره"
                title="مختصات Y روی آرت‌بورد"
                defaultValue={selectedNodePosition ? Math.round(selectedNodePosition.y) : ""}
                disabled={selectedNodeIndex === null}
                className="w-12 rounded border border-white/10 bg-black/20 px-1 py-1 text-center text-[10px] text-white disabled:opacity-30"
              />
              <button
                type="button"
                title="قرار دادن گره در مختصات واردشده"
                disabled={!editedPathLayer || selectedNodeIndex === null}
                onClick={() => {
                  const x = Number(anchorXInputRef.current?.value);
                  const y = Number(anchorYInputRef.current?.value);
                  if (!editedPathLayer || selectedNodeIndex === null || !Number.isFinite(x) || !Number.isFinite(y)) return;
                  engine.setAnchorWorldPosition(editedPathLayer.id, selectedNodeIndex, { x, y });
                }}
                className="rounded-md bg-cyan-500/15 px-1.5 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-30"
              >
                برو
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            <span className="px-1 text-[10px] text-slate-400">زاویهٔ دسته:</span>
            <div key={`${state.editingPathId}-${selectedNodeIndex}`} className="flex items-center gap-1">
              <input
                ref={tangentAngleInputRef}
                type="number"
                aria-label="زاویه دسته"
                title="زاویه نسبت به آرت‌بورد، بر حسب درجه"
                defaultValue={selectedNodeIndex === null ? 0 : selectedTangentAngle}
                disabled={selectedNodeIndex === null}
                className="w-12 rounded border border-white/10 bg-black/20 px-1 py-1 text-center text-[10px] text-white disabled:opacity-30"
              />
              <span className="text-[9px] text-slate-500">°</span>
              <input
                ref={tangentLengthInputRef}
                type="number"
                aria-label="طول دسته"
                title="طول دستهٔ بزیه"
                min={0}
                max={2000}
                defaultValue={selectedNodeIndex === null ? 40 : Math.round(selectedHandleLength)}
                disabled={selectedNodeIndex === null}
                className="w-12 rounded border border-white/10 bg-black/20 px-1 py-1 text-center text-[10px] text-white disabled:opacity-30"
              />
              <button
                type="button"
                title="اعمال زاویه و طول دسته به گره انتخابی"
                disabled={!editedPathLayer || selectedNodeIndex === null}
                onClick={() => {
                  const angle = Number(tangentAngleInputRef.current?.value);
                  const length = Number(tangentLengthInputRef.current?.value);
                  if (!editedPathLayer || selectedNodeIndex === null || !Number.isFinite(angle) || !Number.isFinite(length)) return;
                  engine.setAnchorTangent(editedPathLayer.id, selectedNodeIndex, angle, length);
                }}
                className="rounded-md bg-emerald-500/15 px-1.5 py-1 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-30"
              >
                اعمال
              </button>
            </div>
          </div>
          <span className="text-[10px] text-slate-400">
            روی خط بکشید تا قوس تغییر کند؛ دابل‌کلیک روی خط برای افزودن گره.
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">ترکیب:</span>
            {([
              ["union", Combine],
              ["subtract", SquareStack],
              ["intersect", GitMerge],
              ["exclude", SquareStack],
            ] as const).map(([op, Icon]) => (
              <button
                key={op}
                type="button"
                title={op}
                disabled={engine.booleanOperands().length < 2}
                onClick={() => engine.booleanSelection(op)}
                className={`rounded-lg border px-1.5 py-1 text-emerald-200 transition disabled:opacity-30 ${
                  engine.booleanOperands().length >= 2
                    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/25"
                    : "border-white/10"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <button
            type="button"
            title="اسنپ هوشمند (لنگرها، لبه‌ها، خطوط راهنما و آرت‌بورد هنگام درگ گره)"
            onClick={() => engine.setSnapping(!state.snapping)}
            className={`rounded-xl border px-2 py-1 text-[11px] font-bold transition ${
              state.snapping
                ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                : "border-white/10 bg-white/5 text-slate-400"
            }`}
          >
            🧲 اسنپ
          </button>

            </div>
          </details>
        </div>
      )}

      {/* Figma-style active-tool micro bar.
          Pinned to the BOTTOM-CENTER of the workspace, below the artboard, so it
          never covers the canvas it controls — the old top-anchored popover sat
          directly on top of the card it was editing.
          It stays MOUNTED while the studio is editable and only toggles
          opacity/translate: unmounting would kill the exit transition and make
          the bar pop out of existence. `w-fit` + the max-width keep it clear of
          the align bar (bottom-left) and the zoom controls (bottom-right), and
          it is `pointer-events-none` while hidden so a fade-out never swallows
          a click meant for the canvas. */}
      {!preview && (
        <div
          dir="rtl"
          data-tool-settings-bar=""
          aria-hidden={!isDrawingTool}
          className={`absolute inset-x-0 bottom-3 z-[3500] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 px-2 py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all duration-200 ease-out ${isDrawingTool ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
        >
          <div className="flex items-center gap-1.5">
            {state.tool === "pen" ? (
              <PenToolIcon className="h-3.5 w-3.5 text-cyan-400" />
            ) : (
              <PencilIcon className="h-3.5 w-3.5 text-cyan-400" />
            )}
            <span className="text-[11px] font-bold text-white">
              {state.tool === "pen" ? "منحنی (Curvature)" : "قلم آزاد"}
            </span>
          </div>

          {state.tool === "pen" && (
            <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => engine.setPenMode("curvature")}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                  state.penMode === "curvature"
                    ? "bg-cyan-500/25 text-cyan-200 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
                title="حالت انحنای روان: هر کلیک یک قوس نرم و زیبا ایجاد می‌کند"
              >
                〰️ منحنی روان
              </button>
              <button
                type="button"
                onClick={() => engine.setPenMode("corner")}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                  state.penMode === "corner"
                    ? "bg-cyan-500/25 text-cyan-200 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
                title="حالت گوشه‌دار: خطوط مستقیم و چندضلعی"
              >
                📐 گوشه‌دار
              </button>
            </div>
          )}

          {state.tool === "draw" && (
            <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
              {([
                ["free", "آزاد"],
                ["straight", "خط دقیق"],
                ["constrained", "زاویه‌دار"],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => engine.setFreehandMode(mode)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                    state.freehandMode === mode ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400 hover:text-white"
                  }`}
                  title={mode === "free" ? "قلم آزاد با Bezier قابل ویرایش" : mode === "straight" ? "خط دقیق با زاویه قابل تنظیم" : "قلم آزاد با قفل زاویه و Snap"}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {state.tool === "draw" && (
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
              <label className="flex items-center gap-1 text-[10px] text-slate-400">
                گام
                <input
                  type="number"
                  min={0.1}
                  max={180}
                  step={0.1}
                  value={state.freehandTuning.angleIncrements[0] ?? 45}
                  onChange={(e) => engine.setFreehandAngleSnapping([Number(e.target.value) || 45])}
                  className="w-10 rounded-md border border-white/10 bg-black/20 px-1 py-0.5 text-center text-[10px] text-white outline-none"
                />
                °
              </label>
              <button
                type="button"
                onClick={() => engine.setFreehandTuning({ axisLock: !state.freehandTuning.axisLock })}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${state.freehandTuning.axisLock ? "bg-cyan-500/20 text-cyan-200" : "text-slate-500"}`}
                title="قفل افقی/عمودی"
              >
                محور
              </button>
            </div>
          )}

          {/* گونیا / زاویه‌بندی — همان قفل زاویه‌ای که Shift می‌دهد، این‌بار به‌صورت کلید دائمی
              و با گام دلخواه. جای درستش همین نوار ابزار ترسیم است: تنها جایی که
              کاربر در حال کشیدن خط است. */}
          <div
            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold transition ${
              state.angleAssist
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : "border-white/10 bg-white/5 text-slate-400"
            }`}
          >
            <button
              type="button"
              data-angle-assist-toggle=""
              aria-pressed={state.angleAssist}
              title="گونیا/زاویه‌بندی: قلم روی شبکهٔ زاویه‌ای قفل می‌شود (Shift همیشه ۴۵ درجه است)"
              onClick={() => engine.setAngleAssist(!state.angleAssist)}
            >
              📐 قفل زاویه
            </button>
            {state.angleAssist ? (
              <select
                data-angle-assist-increment=""
                aria-label="گام زاویه"
                title="گام زاویه‌ای قفل"
                value={state.angleAssistIncrement}
                onChange={(event) => engine.setAngleAssistIncrement(Number(event.target.value))}
                className="rounded border border-white/10 bg-black/30 px-1 py-0.5 font-mono text-[10px] text-amber-100"
              >
                {ANGLE_ASSIST_PRESETS.map((degrees) => (
                  <option key={degrees} value={degrees}>
                    {degrees}°
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">ضخامت</span>
            <input
              type="range"
              min={2}
              max={24}
              value={state.brushWidth}
              onChange={(e) => engine.setBrushWidth(Number(e.target.value))}
              className="h-1 w-14 cursor-pointer rounded bg-white/20 accent-cyan-400"
              aria-label="ضخامت قلم"
            />
            <span className="font-mono text-[10px] text-cyan-300">{state.brushWidth}px</span>
          </div>

          <span aria-hidden="true" className="h-4 w-px bg-white/10" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (state.tool === "pen") engine.finishPen(false);
                engine.setTool("select");
              }}
              title="اتمام و ذخیره ترسیم (Enter)"
              className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 shadow-sm transition hover:bg-emerald-400"
            >
              <Check className="h-3.5 w-3.5" />
              <span>اتمام</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (state.tool === "pen") engine.cancelPen();
                engine.setTool("select");
              }}
              title="انصراف و لغو ترسیم (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-300 transition hover:bg-rose-500/20 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Scaled-fit wrapper: layout size equals the SCALED artboard, so
          auto-centering works in RTL too (the inner layout box overflows the
          wrapper on purpose but its scaled visual exactly fills it). */}
      <div
        className="relative mx-auto flex items-center justify-center"
        style={{
          width: Math.round(doc.artboard.width * zoom),
          height: Math.round(doc.artboard.height * zoom),
          marginTop: 12,
          marginBottom: 12,
        }}
      >
        {/* RULERS + USER GUIDES. View state only — the document never sees them,
            which is why this sits in the wrapper rather than in the layer tree.
            Mounted while EITHER is visible: hiding the ruler scale must not make
            the user's guides vanish (they still snap, so they must still show). */}
        {state.rulers || state.guides.length > 0 ? (
          <RulersAndGuides
            artboard={doc.artboard}
            zoom={zoom}
            pan={pan}
            rulers={state.rulers}
            guides={state.guides}
            selectMode={state.tool === "select"}
            preview={preview}
            /* The set-square locks a guide's angle too: one angular grid for the
               whole drawing aid, not a pen-only setting. */
            angleSnap={state.angleAssist ? state.angleAssistIncrement : null}
            onAdd={(axis, at) => engine.addGuide(axis, at)}
            onAddAngled={(angle, point) => engine.addAngledGuide(angle, point)}
            onMove={(id, point) => engine.moveGuide(id, point)}
            onRotate={(id, angle) => engine.rotateGuide(id, angle)}
            onRemove={(id) => engine.removeGuide(id)}
            onToggleLock={(id) => engine.toggleGuideLock(id)}
            onSnapCreate={(point, axis) => {
              if (!state.snapping) return point;
              const snapped = engine.smartSnapPoint(point, { tolerance: 8 / Math.max(zoom, 0.01) });
              return axis === "x" ? { ...point, x: snapped.x } : { ...point, y: snapped.y };
            }}
            onPin={(vertex, baseAngle) => {
              if (state.tool === "select") setAngleDial({ vertex, baseAngle });
            }}
          />
        ) : null}
      {state.setSquares.length > 0 && !preview ? (
        <SetSquareOverlay
          squares={state.setSquares}
          zoom={zoom}
          pan={pan}
          angleSnap={state.angleAssist ? state.angleAssistIncrement : null}
          engagedEdge={engagedSetSquareEdge}
          interactive={state.tool === "select"}
          onMove={(id, center) => engine.moveSetSquare(id, center)}
          onRotate={(id, angle) => engine.rotateSetSquare(id, angle)}
          onResize={(id, size) => engine.resizeSetSquare(id, size)}
          onToggleLock={(id) => engine.toggleSetSquareLock(id)}
          onSwitchKind={(id) => engine.switchSetSquareKind(id)}
          onRemove={(id) => engine.removeSetSquare(id)}
        />
      ) : null}
      {angleDial && !preview ? (
        <AngleDial
          vertex={angleDial.vertex}
          baseAngle={angleDial.baseAngle}
          artboard={doc.artboard}
          zoom={zoom}
          pan={pan}
          onCommit={(absoluteAngle) => {
            const ok = engine.addLockedAngledGuide(absoluteAngle, angleDial.vertex);
            if (ok) setAngleDial(null);
            return ok;
          }}
          onCancel={() => setAngleDial(null)}
        />
      ) : null}
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

        {mirrorAxis ? (
          <svg
            className="pointer-events-none absolute inset-0 z-[1800] overflow-visible"
            width={doc.artboard.width}
            height={doc.artboard.height}
            viewBox={`0 0 ${doc.artboard.width} ${doc.artboard.height}`}
          >
            {mirrorAxis.end ? (
              <line
                x1={mirrorAxis.start.x}
                y1={mirrorAxis.start.y}
                x2={mirrorAxis.end.x}
                y2={mirrorAxis.end.y}
                stroke="#c084fc"
                strokeWidth={2 / zoom}
                strokeDasharray={`${8 / zoom} ${5 / zoom}`}
              />
            ) : null}
            {[mirrorAxis.start, mirrorAxis.end].filter((point): point is { x: number; y: number } => point !== null).map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={5 / zoom}
                fill="#7e22ce"
                stroke="#f3e8ff"
                strokeWidth={2 / zoom}
              />
            ))}
          </svg>
        ) : null}

        {/* Interactive layer hit-areas (above visuals, below nothing) */}
        {doc.layers.map((layer, index) =>
          layer.hidden ? null : (
            <div
              key={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`لایه ${layer.kind}`}
              className={`absolute rounded-md transition-shadow ${
                selected === layer.id && !preview ? "ring-2 ring-cyan-400 ring-offset-0" : "hover:ring-1 hover:ring-white/40"
              }`}
              style={{
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                transform: layer.angle ? `rotate(${layer.angle}deg)` : undefined,
                zIndex: 1000 + layerZ(index),
                // `move` is a PROMISE that the press moves the layer. Over the box of the
                // path being point-edited it is false — the press starts a node
                // marquee, or (click, no travel) leaves point-editing — so the
                // cursor falls back to the neutral arrow. Alt is the documented
                // way to drag the whole layer from inside the mode, so with Alt
                // down the promise becomes true again.
                cursor: layerHitCursor({
                  tool: state.tool,
                  locked: layer.locked,
                  editing: state.editingPathId === layer.id && !altHeld,
                }),
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
            minimal={selectedLayer.kind === "path" && Boolean(selectedLayer.curve)}
            onHandlePointerDown={onResizeHandlePointerDown}
            onRotatePointerDown={onRotateHandlePointerDown}
          />
        ) : null}

        {/* BEZIER POINT EDITOR — anchors + handles for the path being edited.
            It replaces the transform box (as in Figma) because dragging an
            anchor and dragging the layer frame would otherwise fight. */}
        {editedPathLayer && state.showNodes ? (
          <PathEditOverlay
            engine={engine}
            layer={editedPathLayer}
            zoom={zoom}
            selectedIndex={
              state.selectedAnchor?.layerId === editedPathLayer.id ? state.selectedAnchor.index : null
            }
            selectedIndices={selectedNodeIndices}
            rangeStartIndex={
              state.curveRangeStart?.layerId === editedPathLayer.id ? state.curveRangeStart.index : null
            }
            toBoardPoint={pointerPos}
          />
        ) : null}

        {/* BEND DOT — "grab the line anywhere and curve that spot".

            Outside point-editing this IS the gesture: the dot follows the pointer
            along the shape the layer draws (an arc's apex is only its resting
            position) and the press turns that exact spot into a real node. Inside
            point-editing the PathEditOverlay runs the very same gesture on its own
            hit path, so this overlay steps aside instead of fighting it. */}
        {state.tool === "select" &&
        selectedLayer?.kind === "path" &&
        (selectedLayer as PathLayer).points?.length >= 2 &&
        state.editingPathId !== selectedLayer.id ? (
          <ArcBendHandleOverlay
            engine={engine}
            layer={selectedLayer as PathLayer}
            zoom={zoom}
            toBoardPoint={pointerPos}
          />
        ) : null}

        {/* Visual rendering — the SHARED document projection (`LayerBox`).
            The stage, the export surface and the public card all render this
            same code, so they cannot drift apart. Every layer is rendered
            (hidden ones through opacity 0), exactly like export. */}
        <div className="pointer-events-none absolute inset-0" style={{ background: doc.background }}>
          {doc.layers.map((layer, index) => (
            <LayerBox key={`v-${layer.id}`} layer={layer} z={layerZ(index)} qrRevision={qrRevision} />
          ))}
        </div>

        {/* Layer marquee — drag from empty space to select multiple visible layers. */}
        {layerMarquee && !preview ? (
          <div
            data-layer-marquee=""
            className="pointer-events-none absolute z-[1700] border border-cyan-300/90 bg-cyan-400/10"
            style={{
              left: Math.min(layerMarquee.x0, layerMarquee.x1),
              top: Math.min(layerMarquee.y0, layerMarquee.y1),
              width: Math.abs(layerMarquee.x1 - layerMarquee.x0),
              height: Math.abs(layerMarquee.y1 - layerMarquee.y0),
            }}
          />
        ) : null}
        {/* Node marquee — the rubber band while catching nodes (view state). */}
        {nodeMarquee && !preview ? (
          <div
            className="pointer-events-none absolute z-[1600] border border-cyan-300/80 bg-cyan-400/10"
            style={{
              left: Math.min(nodeMarquee.x0, nodeMarquee.x1),
              top: Math.min(nodeMarquee.y0, nodeMarquee.y1),
              width: Math.abs(nodeMarquee.x1 - nodeMarquee.x0),
              height: Math.abs(nodeMarquee.y1 - nodeMarquee.y0),
            }}
          />
        ) : null}

        {/* Smart guides — merged from BOTH sources: the move/resize gesture's
            local state AND the engine's `snapGuides` (node drags, measure). */}
        {(() => {
          if (preview) return null;
          const seen = new Set<string>();
          const lines: { axis: "x" | "y"; at: number }[] = [];
          for (const g of [...activeGuides, ...state.snapGuides]) {
            const key = `${g.axis}:${g.at}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push({ axis: g.axis, at: g.at });
          }
          if (lines.length === 0) return null;
          return (
            <div className="pointer-events-none absolute inset-0 z-[1500]">
              {lines.map((g, i) =>
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
          );
        })()}

        {/* Working Stroke Preview (perfect-freehand live ref + rAF) */}
        <div className="pointer-events-none absolute inset-0 z-[2000]">
          <svg style={{ width: "100%", height: "100%", overflow: "visible" }} viewBox={`0 0 ${doc.artboard.width} ${doc.artboard.height}`}>
            <path ref={liveBrushRef} fill={state.brushColor || "#0ea5e9"} pointerEvents="none" />
            <path ref={liveGuideBrushRef} fill="none" stroke={state.brushColor || "#0ea5e9"} strokeWidth={state.brushWidth || 14} strokeLinecap="round" pointerEvents="none" />
          </svg>
        </div>

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

      {/* Copy feedback flash — brief confirmation that Ctrl+C landed. */}
      {copyFeedback !== null ? (
        <div
          className="absolute bottom-10 right-3 z-[3001] rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-200 backdrop-blur shadow-lg"
          aria-live="polite"
        >
          کپی شد
        </div>
      ) : null}

      {/* Zoom controls (bottom-right, always reachable; RTL-safe, 10% to 200% range).
          The ruler/guide toggle lives here rather than in the path-node panel because
          rulers align ANY layer — they must be reachable long before point-editing. */}
      {preview ? null : (
        <div onPointerDown={(event) => event.stopPropagation()} className="absolute bottom-3 right-3 z-[3000] flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#0c1626]/95 p-1.5 text-slate-200 backdrop-blur shadow-2xl">
          <button
            type="button"
            data-set-square-add=""
            title="📐 گونیا — افزودن مثلث ترسیم"
            onClick={() => {
              const id = engine.addSetSquare();
              if (!id) {
                setSetSquareNotice("حداکثر ۴ گونیا مجاز است");
                window.setTimeout(() => setSetSquareNotice(""), 2200);
              }
            }}
            className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-amber-200 transition hover:bg-amber-500/15"
          >📐 گونیا{state.setSquares.length ? ` ${state.setSquares.length}` : ""}</button>
          {setSquareNotice ? <span role="status" className="text-[10px] text-rose-200">{setSquareNotice}</span> : null}
          {state.setSquares.some(square => !square.locked) ? (
            <button type="button" data-set-square-clear="" title="حذف گونیاهای آزاد (گونیاهای قفل‌شده باقی می‌مانند)" onClick={() => engine.clearSetSquares()} className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-200">🧹</button>
          ) : null}
          <button
            type="button"
            data-rulers-toggle=""
            aria-pressed={state.rulers}
            title="خط‌کش و خطوط راهنما: از خط‌کش بکشید تا خط راهنما بسازید؛ برای حذف روی خط‌کش رها کنید یا دوبار کلیک کنید"
            onClick={() => engine.setRulers(!state.rulers)}
            className={`rounded-lg px-1.5 py-1 text-[11px] font-bold transition hover:bg-white/10 ${
              state.rulers ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"
            }`}
          >
            📏{state.guides.length > 0 ? ` ${state.guides.length}` : ""}
          </button>
          {state.guides.length > 0 ? (
            <button
              type="button"
              data-guides-clear=""
              title="حذف همهٔ خطوط راهنما (فقط نمایشی‌اند و روی طرح ذخیره نمی‌شوند)"
              onClick={() => engine.clearGuides()}
              className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-200"
            >
              🧹
            </button>
          ) : null}
          <div className="mx-0.5 h-4 w-px bg-white/10" />
          <button
            type="button"
            onClick={zoomOut}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-base font-bold text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="کوچک‌نمایی (−)"
          >
            −
          </button>

          {isEditingZoom ? (
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                min={10}
                max={200}
                autoFocus
                value={zoomInputValue}
                onChange={(e) => setZoomInputValue(e.target.value)}
                onBlur={() => {
                  const parsed = parseInt(zoomInputValue, 10);
                  if (!isNaN(parsed)) {
                    setZoomPreset(Math.min(2.0, Math.max(0.1, parsed / 100)));
                  }
                  setIsEditingZoom(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const parsed = parseInt(zoomInputValue, 10);
                    if (!isNaN(parsed)) {
                      setZoomPreset(Math.min(2.0, Math.max(0.1, parsed / 100)));
                    }
                    setIsEditingZoom(false);
                  } else if (e.key === "Escape") {
                    setIsEditingZoom(false);
                  }
                }}
                className="w-14 rounded-md border border-cyan-400 bg-white/10 px-1 py-0.5 text-center text-xs font-mono font-bold text-cyan-200 outline-none"
              />
              <span className="text-xs font-mono text-cyan-300">%</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setZoomInputValue(String(Math.round(zoom * 100)));
                setIsEditingZoom(true);
              }}
              className="min-w-[56px] rounded-lg px-2 py-1 text-xs font-mono font-bold tabular-nums text-cyan-300 hover:bg-cyan-500/20 transition"
              title="برای تغییر دستی و تایپ درصد زوم کلیک کنید (۱۰٪ تا ۲۰۰٪)"
            >
              {Math.round(zoom * 100)}%
            </button>
          )}

          <button
            type="button"
            onClick={zoomIn}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-base font-bold text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="بزرگ‌نمایی (+)"
          >
            +
          </button>

          <div className="mx-0.5 h-4 w-px bg-white/10" />

          <button
            type="button"
            onClick={() => setZoomPreset(0.5)}
            className={`rounded-lg px-1.5 py-1 text-[10px] font-bold transition hover:bg-white/10 ${
              Math.round(zoom * 100) === 50 ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"
            }`}
            title="نمای ۵۰٪"
          >
            ۵۰٪
          </button>
          <button
            type="button"
            onClick={() => setZoomPreset(1)}
            className={`rounded-lg px-1.5 py-1 text-[10px] font-bold transition hover:bg-white/10 ${
              Math.round(zoom * 100) === 100 ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"
            }`}
            title="اندازه واقعی ۱۰۰٪"
          >
            ۱۰۰٪
          </button>
          <button
            type="button"
            onClick={() => setZoomPreset(2)}
            className={`rounded-lg px-1.5 py-1 text-[10px] font-bold transition hover:bg-white/10 ${
              Math.round(zoom * 100) === 200 ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"
            }`}
            title="بزرگ‌نمایی ۲۰۰٪"
          >
            ۲۰۰٪
          </button>
          <button
            type="button"
            onClick={zoomFit}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="تناسب خودکار با صفحه"
          >
            تناسب
          </button>
        </div>
      )}

      {/* EXPORT SURFACE — 1:1 unscaled artboard, visually hidden but still
          in the DOM so html-to-image can rasterize it. EXACTLY matches the
          stage visuals (same LayeredCard projection), so exported PNG/JPG
          output and the on-screen preview always agree.

          PLACEMENT CONTRACT: it must stay INSIDE this stage container, which
          already clips (`overflow-hidden`). The obvious "park it far off-screen"
          trick (`position: fixed; left: -99999px`) silently backfires: the
          nearest ancestor carrying `backdrop-filter` — the studio wrapper in
          card-maker/page.tsx uses `backdrop-blur-xl` — becomes the containing
          block for fixed descendants in Chromium, so the box resolves like
          `absolute` and grows the DOCUMENT's scrollWidth by ~100 000 px.

          The `opacity-0` lives on THIS wrapper, never on `exportRef` itself:
          html-to-image clones only the ref node into a foreignObject (ancestor
          styles never travel with it), but an opacity on the cloned node itself
          would produce a fully transparent PNG/JPG. `exportRef` keeps its
          explicit width/height so `node.offsetWidth` still drives pixelRatio. */}
      {exportRef ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0">
          <div ref={exportRef} style={{ width: doc.artboard.width, height: doc.artboard.height }}>
            <LayeredCard doc={doc} scale={1} qrRevision={qrRevision} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EditorStage;
