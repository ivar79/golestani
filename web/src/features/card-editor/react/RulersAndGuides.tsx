"use client";

/**
 * RULERS + USER GUIDES — the measuring layer of the artboard.
 *
 * Mounted INSIDE the scaled-fit wrapper (the box whose size already equals the
 * scaled artboard), so every position here comes from one formula:
 *
 *     screen = pan + artboard * zoom
 *
 * Two deliberate choices:
 *   1. The ruler strips are drawn INSIDE the board's outer edge (Figma does the
 *      same). Outside strips would be clipped by the workspace's `overflow-hidden`
 *      and would force a layout change to the stage — an editing aid must never
 *      resize the thing it measures.
 *   2. Nothing here touches the document. Guides are view state, so this
 *      component only ever calls the `on…` callbacks; the engine owns the list
 *      and the save payload never sees it.
 *
 * A guide is a LINE AT ANY ANGLE (domain/guides.ts), not just an x/y value, so
 * this file draws and hit-tests real rotated geometry:
 *   - the visible line is the guide clipped to the board (plus a small pad), so
 *     it spans exactly as far as the board does at any angle;
 *   - the hit target is the same segment with a wide transparent stroke, which
 *     is what makes a thin diagonal line grabbable.
 *
 * The ruler reads as a RULER, not a plain line:
 *   - three tick classes (labelled major / medium half-step / fine minor) at a
 *     spacing chosen so two labels are never closer than `minLabelGap`;
 *   - a live POINTER INDICATOR: a marker on each strip that follows the cursor
 *     and shows the coordinate under it (the cue that tells you the strip is a
 *     scale, and the fastest way to read a position);
 *   - the coordinate of the board's own 0 is labelled like every other step.
 *
 * Interactions:
 *   - drag OUT of a ruler              → create an axis guide
 *   - drag the ruler ELBOW (top-left)  → create an ANGLED guide at that angle
 *   - drag a guide                     → move it (translate)
 *   - drag a guide's round handle      → ROTATE it to any angle
 *   - drop a guide back on its ruler   → delete it
 *   - double-click a guide             → delete it
 *
 * The two axes mean different things while dragging an AXIS guide, and
 * conflating them is the bug this file exists to avoid:
 *   - on the guide's OWN axis a value past the edge simply CLAMPS (x = 0 is a
 *     perfectly good guide), so the drag tracks `raw` next to the clamped value;
 *   - on the CROSS axis, going past the strip it came from is the "put it back"
 *     gesture — a vertical guide (pulled from the TOP ruler) is deleted by
 *     dropping it above the board, a horizontal one (from the LEFT ruler) by
 *     dropping it to the left. Without that, a delete could never be expressed:
 *     the own axis always clamps first.
 *
 * An ANGLED guide moves by TRANSLATION instead: its two coordinates are both
 * meaningful, so "follow the pointer on one axis" has no meaning for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RULER_THICKNESS,
  angleFromDrag,
  axisForAngle,
  clampAxis,
  clampPoint,
  guideAngleForAxis,
  guideAxisForRuler,
  normalizeAngle,
  rulerTicks,
  type GuideAxis,
  type UserGuide,
} from "../domain/guides";

/** How far past the owning ruler the pointer must be for a drop to mean "delete". */
const DROP_SLOP_PX = 16;
/** Screen-px travel before a ruler press counts as pulling a guide out. */
const CREATE_THRESHOLD_PX = 3;
/** Screen-px of guide line drawn past each board edge (visual only). */
const LINE_PAD_PX = 28;
/** Hit stroke width in screen px — a 1px diagonal is impossible to grab. */
const HIT_STROKE_PX = 12;
/** Shift is the universal "constrain rotation" modifier. */
const SHIFT_ROTATE_STEP = 15;

type Point = { x: number; y: number };

type Drag = {
  kind: "create" | "move" | "rotate" | "angled";
  /** Present while moving/rotating an existing guide. */
  id: string | null;
  /** Which strip owns the gesture ("create" only). */
  axis: GuideAxis | null;
  /** Live guide angle in degrees (90 = vertical). */
  angle: number;
  /** Committed anchor point of the dragged line (artboard units). */
  x: number;
  y: number;
  /** The anchor at press time — angled guides translate relative to this. */
  anchor: Point;
  /** The pointer at press time (artboard units) — a translate's zero point. */
  press: Point;
  /** Unclamped pointer position (artboard units). */
  rawX: number;
  rawY: number;
  /** True once the pointer went past the ruler this guide belongs to. */
  droppedOnRuler: boolean;
  /** True once the press travelled far enough to count as a real drag. */
  moved: boolean;
  /** Pointer position at press time, in SCREEN px, for the travel threshold. */
  origin: { clientX: number; clientY: number };
};

type Props = {
  artboard: { width: number; height: number };
  zoom: number;
  pan: { x: number; y: number };
  guides: UserGuide[];
  /**
   * Show the ruler STRIPS. Guides are drawn regardless — Illustrator's rule:
   * hiding the ruler scale is a view preference, it is not "throw my guides
   * away". A guide that still snaps but is invisible would be worse than either
   * choice, so the lines stay on screen as long as they exist.
   */
  rulers?: boolean;
  /**
   * The angle-assist increment in degrees when the "set-square" is ON, or null.
   * It locks the angle of an elbow drag and of a rotation, so a user who needs
   * 30° gets exactly 30° instead of "about 30°".
   */
  angleSnap?: number | null;
  onAdd: (axis: GuideAxis, at: number) => void;
  /** Create a guide at ANY angle through `point` (0 = horizontal, 90 = vertical). */
  onAddAngled: (angle: number, point: Point) => void;
  onMove: (id: string, point: Point) => void;
  /** Spin an existing guide around its own anchor. */
  onRotate: (id: string, angle: number) => void;
  onRemove: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onPin?: (vertex: Point, baseAngle: number) => void;
  /** Preview mode never shows design aids. */
  preview?: boolean;
};

/**
 * Where an infinite line through `anchor` at `angle` leaves the board.
 *
 * This is what makes an angled guide look right: a fixed-length bar either stops
 * short of a corner or sticks out past the edge, while the chord between these
 * two points touches exactly the board edges — the same promise a horizontal
 * guide keeps.
 */
export function clipLineToBoard(
  anchor: Point,
  angle: number,
  artboard: { width: number; height: number },
  pad: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const normalized = normalizeAngle(angle);
  const radians = (normalized * Math.PI) / 180;
  // cos(90°) is 6e-17, not 0, and that residue would leak a 0.00000000000003px
  // wobble into every axis-aligned guide. The axes are EXACT here.
  const dx = normalized === 90 ? 0 : normalized === 0 ? 1 : Math.cos(radians);
  const dy = normalized === 90 ? 1 : normalized === 0 ? 0 : Math.sin(radians);
  const loX = -pad;
  const hiX = artboard.width + pad;
  const loY = -pad;
  const hiY = artboard.height + pad;
  let t0 = Number.NEGATIVE_INFINITY;
  let t1 = Number.POSITIVE_INFINITY;

  const slab = (p: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    return t1 >= t0;
  };

  if (!slab(anchor.x, dx, loX, hiX) || !slab(anchor.y, dy, loY, hiY)) return null;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return {
    x1: tidy(anchor.x + t0 * dx),
    y1: tidy(anchor.y + t0 * dy),
    x2: tidy(anchor.x + t1 * dx),
    y2: tidy(anchor.y + t1 * dy),
  };
}

/** Kill the 1e-14 residue a rotation leaves behind, so edges read exactly. */
function projectOnGuideForUi(guide: UserGuide, point: Point): Point {
  const radians = (guide.angle * Math.PI) / 180;
  const nx = -Math.sin(radians);
  const ny = Math.cos(radians);
  const signed = (point.x - guide.x) * nx + (point.y - guide.y) * ny;
  return { x: point.x - signed * nx, y: point.y - signed * ny };
}

function tidy(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function RulersAndGuides({
  artboard,
  zoom,
  pan,
  guides,
  rulers = true,
  angleSnap = null,
  onAdd,
  onAddAngled,
  onMove,
  onRotate,
  onRemove,
  onToggleLock,
  onPin,
  preview = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const lastPointerRef = useRef<string>("");

  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const snapIncrements = angleSnap && angleSnap > 0 ? [angleSnap] : [];

  /** Client point → artboard point, using the wrapper rect and the pan offset. */
  const toArtboard = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / scale,
        y: (clientY - rect.top - pan.y) / scale,
      };
    },
    [pan.x, pan.y, scale],
  );

  /**
   * The pointer indicator only needs the position to the nearest screen pixel,
   * so a sub-pixel move must not re-render the whole overlay on every event.
   */
  useEffect(() => {
    if (!rulers || preview) return;
    const onMove = (event: PointerEvent) => {
      const point = toArtboard(event.clientX, event.clientY);
      const key = `${Math.round(point.x * scale)},${Math.round(point.y * scale)}`;
      if (key === lastPointerRef.current) return;
      lastPointerRef.current = key;
      setPointer(point);
    };
    const onLeave = () => {
      lastPointerRef.current = "";
      setPointer(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [preview, rulers, scale, toArtboard]);

  /**
   * Did the pointer go back past the ruler this guide belongs to?
   *
   * A vertical guide lives under the TOP strip and a horizontal one under the
   * LEFT strip, so "put it back" is the CROSS coordinate going negative — never
   * the guide's own coordinate, which clamps.
   */
  const backOnRuler = useCallback(
    (axis: GuideAxis, point: Point) => {
      const cross = axis === "x" ? point.y : point.x;
      return cross < -DROP_SLOP_PX / scale;
    },
    [scale],
  );

  const start = useCallback((next: Drag, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = next;
    setDrag(next);
    // jsdom (and older browsers) may not implement capture; the optional call
    // keeps the gesture working either way.
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }, []);

  const update = useCallback(
    (event: React.PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const point = toArtboard(event.clientX, event.clientY);
      const travelled = Math.hypot(
        event.clientX - current.origin.clientX,
        event.clientY - current.origin.clientY,
      );
      const moved = current.moved || travelled > CREATE_THRESHOLD_PX;
      const increments = event.shiftKey ? [SHIFT_ROTATE_STEP] : snapIncrements;
      let next: Drag = {
        ...current,
        rawX: point.x,
        rawY: point.y,
        moved,
      };

      if (current.kind === "rotate" || current.kind === "angled") {
        // Both gestures are "point at the direction you want": the line pivots
        // around an anchor that never moves.
        next = {
          ...next,
          angle: angleFromDrag(current.anchor, point, increments),
        };
      } else if (current.kind === "create") {
        const axis = current.axis ?? "x";
        const value = axis === "x" ? point.x : point.y;
        const extent = axis === "x" ? artboard.width : artboard.height;
        next = {
          ...next,
          x: axis === "x" ? clampAxis(value, extent) : artboard.width / 2,
          y: axis === "y" ? clampAxis(value, extent) : artboard.height / 2,
          droppedOnRuler: backOnRuler(axis, point),
        };
      } else if (isAxisAlignedAngle(current.angle)) {
        // An axis guide follows ONE pointer coordinate: the other one is noise,
        // and its cross coordinate is what expresses "drop me back on the ruler".
        const axis = current.axis ?? "x";
        const value = axis === "x" ? point.x : point.y;
        const extent = axis === "x" ? artboard.width : artboard.height;
        next = {
          ...next,
          x: axis === "x" ? clampAxis(value, extent) : current.anchor.x,
          y: axis === "y" ? clampAxis(value, extent) : current.anchor.y,
          droppedOnRuler: backOnRuler(axis, point),
        };
      } else {
        // An angled guide TRANSLATES: both of its coordinates are meaningful, so
        // there is no single axis it could follow. The anchor is clamped to the
        // board, which is why the whole line stays grabbable.
        const axis = axisForAngle(current.angle);
        const anchor = clampPoint(
          {
            x: current.anchor.x + (point.x - current.press.x),
            y: current.anchor.y + (point.y - current.press.y),
          },
          artboard,
        );
        next = { ...next, x: anchor.x, y: anchor.y, droppedOnRuler: backOnRuler(axis, point) };
      }

      dragRef.current = next;
      setDrag(next);
    },
    [artboard, backOnRuler, snapIncrements, toArtboard],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current || !commit || !current.moved) return;

      if (current.kind === "angled") {
        // A corner drag that never left the elbow is a stray click, not a line.
        onAddAngled(current.angle, { x: current.anchor.x, y: current.anchor.y });
        return;
      }

      if (current.kind === "rotate") {
        if (!current.id) return;
        onRotate(current.id, current.angle);
        return;
      }

      if (current.kind === "create") {
        // Dropping a line back onto the strip it came from means "never mind".
        if (current.droppedOnRuler) return;
        const axis = current.axis ?? "x";
        onAdd(axis, axis === "x" ? current.x : current.y);
        return;
      }

      const id = current.id;
      if (!id) return;
      // Dropping a guide back onto its ruler deletes it.
      if (current.droppedOnRuler) {
        onRemove(id);
        return;
      }
      // Off the board on its OWN axis is not a delete — it pins to the edge.
      onMove(id, { x: current.x, y: current.y });
    },
    [onAdd, onAddAngled, onMove, onRemove, onRotate],
  );

  if (preview) return null;

  const ticksTop = rulerTicks(-pan.x / scale, (artboard.width - pan.x) / scale, scale, { maxTicks: 240 });
  const ticksLeft = rulerTicks(-pan.y / scale, (artboard.height - pan.y) / scale, scale, { maxTicks: 240 });
  /** Spacing between labelled ticks — recovers the "medium" half-step below. */
  const topStep = majorStep(ticksTop);
  const leftStep = majorStep(ticksLeft);

  const toScreenX = (value: number) => pan.x + value * scale;
  const toScreenY = (value: number) => pan.y + value * scale;
  const toScreen = (point: Point) => ({ x: toScreenX(point.x), y: toScreenY(point.y) });

  /** The live geometry of a guide (or of the drag preview) as a screen chord. */
  const chordFor = (angle: number, anchor: Point) => {
    const clipped = clipLineToBoard(anchor, angle, artboard, LINE_PAD_PX / scale);
    if (!clipped) return null;
    return {
      x1: toScreenX(clipped.x1),
      y1: toScreenY(clipped.y1),
      x2: toScreenX(clipped.x2),
      y2: toScreenY(clipped.y2),
    };
  };

  const dragAxis = drag && drag.kind === "create" ? (drag.axis ?? "x") : null;
  const dragGuide = drag && drag.id ? guides.find((guide) => guide.id === drag.id) : undefined;
  const dragAngle =
    drag === null
      ? 0
      : drag.kind === "move" && dragGuide
        ? dragGuide.angle
        : drag.kind === "create" && dragAxis
          ? guideAngleForAxis(dragAxis)
          : drag.angle;
  const dragChord = drag && drag.moved ? chordFor(dragAngle, { x: drag.x, y: drag.y }) : null;

  return (
    <div
      ref={hostRef}
      data-rulers={rulers ? "on" : "off"}
      // The overlay is a measuring layer, not a surface: only the strips, the
      // lines and the handles take pointer events, so a click on empty board
      // still reaches the canvas underneath.
      className="pointer-events-none absolute inset-0 z-[1700]"
    >
      {/* TOP RULER — drag out of it to create a vertical guide. */}
      {rulers ? (
        <div
          data-ruler="top"
          role="presentation"
          title="خط‌کش افقی — برای ساختن خط راهنمای عمودی از آن بکشید"
          onPointerDown={(event) => {
            const point = toArtboard(event.clientX, event.clientY);
            start(
              {
                kind: "create",
                id: null,
                axis: guideAxisForRuler("top"),
                angle: guideAngleForAxis(guideAxisForRuler("top")),
                x: clampAxis(point.x, artboard.width),
                y: artboard.height / 2,
                anchor: { x: point.x, y: point.y },
                press: { x: point.x, y: point.y },
                rawX: point.x,
                rawY: point.y,
                droppedOnRuler: false,
                moved: false,
                origin: { clientX: event.clientX, clientY: event.clientY },
              },
              event,
            );
          }}
          onPointerMove={update}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          className="pointer-events-auto absolute cursor-col-resize select-none border-b border-white/10 bg-gradient-to-b from-[#0d1626] to-[#0a1220] text-slate-400 backdrop-blur-sm"
          // `left-0 right-0` is load-bearing: a strip with only a height
          // shrink-wraps to its SVG and stops covering the board, so only the
          // first few hundred pixels would ever create a guide.
          style={{ top: 0, left: 0, right: 0, height: RULER_THICKNESS }}
        >
          <svg width="100%" height={RULER_THICKNESS} className="block">
            {ticksTop.map((tick) => {
              const x = toScreenX(tick.value);
              const length = tick.major ? 9 : isHalfStep(tick.value, topStep) ? 6 : 3.5;
              return (
                <line
                  key={`top-${tick.value}`}
                  data-tick={tick.major ? "major" : "minor"}
                  x1={x}
                  y1={RULER_THICKNESS - length}
                  x2={x}
                  y2={RULER_THICKNESS}
                  stroke={tick.major ? "#7dd3fc" : "currentColor"}
                  strokeOpacity={tick.major ? 0.7 : isHalfStep(tick.value, topStep) ? 0.45 : 0.25}
                />
              );
            })}
            {pointer ? (
              <line
                data-ruler-cursor="top"
                x1={toScreenX(pointer.x)}
                y1={0}
                x2={toScreenX(pointer.x)}
                y2={RULER_THICKNESS}
                stroke="#22d3ee"
                strokeWidth={1}
                strokeOpacity={0.9}
              />
            ) : null}
          </svg>
          {ticksTop
            .filter((tick) => tick.major)
            .map((tick) => (
              <span
                key={`top-label-${tick.value}`}
                className="absolute top-[1px] select-none font-mono text-[8px] leading-none text-slate-400"
                style={{ left: toScreenX(tick.value) + 3 }}
              >
                {tick.label}
              </span>
            ))}
          {pointer ? (
            <span
              dir="ltr"
              data-ruler-readout="top"
              className="pointer-events-none absolute top-[1px] rounded bg-cyan-500/90 px-1 font-mono text-[8px] leading-tight text-white"
              style={{ left: Math.min(Math.max(toScreenX(pointer.x) + 3, 0), artboard.width * scale - 26) }}
            >
              {Math.round(pointer.x)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* LEFT RULER — drag out of it to create a horizontal guide. */}
      {rulers ? (
        <div
          data-ruler="left"
          role="presentation"
          title="خط‌کش عمودی — برای ساختن خط راهنمای افقی از آن بکشید"
          onPointerDown={(event) => {
            const point = toArtboard(event.clientX, event.clientY);
            start(
              {
                kind: "create",
                id: null,
                axis: guideAxisForRuler("left"),
                angle: guideAngleForAxis(guideAxisForRuler("left")),
                x: artboard.width / 2,
                y: clampAxis(point.y, artboard.height),
                anchor: { x: point.x, y: point.y },
                press: { x: point.x, y: point.y },
                rawX: point.x,
                rawY: point.y,
                droppedOnRuler: false,
                moved: false,
                origin: { clientX: event.clientX, clientY: event.clientY },
              },
              event,
            );
          }}
          onPointerMove={update}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          className="pointer-events-auto absolute cursor-row-resize select-none border-r border-white/10 bg-gradient-to-r from-[#0d1626] to-[#0a1220] text-slate-400 backdrop-blur-sm"
          style={{ top: 0, bottom: 0, left: 0, width: RULER_THICKNESS }}
        >
          <svg height="100%" width={RULER_THICKNESS} className="block">
            {ticksLeft.map((tick) => {
              const y = toScreenY(tick.value);
              const length = tick.major ? 9 : isHalfStep(tick.value, leftStep) ? 6 : 3.5;
              return (
                <line
                  key={`left-${tick.value}`}
                  data-tick={tick.major ? "major" : "minor"}
                  x1={RULER_THICKNESS - length}
                  y1={y}
                  x2={RULER_THICKNESS}
                  y2={y}
                  stroke={tick.major ? "#7dd3fc" : "currentColor"}
                  strokeOpacity={tick.major ? 0.7 : isHalfStep(tick.value, leftStep) ? 0.45 : 0.25}
                />
              );
            })}
            {pointer ? (
              <line
                data-ruler-cursor="left"
                x1={0}
                y1={toScreenY(pointer.y)}
                x2={RULER_THICKNESS}
                y2={toScreenY(pointer.y)}
                stroke="#22d3ee"
                strokeWidth={1}
                strokeOpacity={0.9}
              />
            ) : null}
          </svg>
          {ticksLeft
            .filter((tick) => tick.major)
            .map((tick) => (
              <span
                key={`left-label-${tick.value}`}
                className="absolute left-[1px] origin-top-left select-none font-mono text-[8px] leading-none text-slate-400"
                style={{ top: toScreenY(tick.value) + 3, transform: "rotate(90deg) translateX(9px)" }}
              >
                {tick.label}
              </span>
            ))}
          {pointer ? (
            <span
              dir="ltr"
              data-ruler-readout="left"
              className="pointer-events-none absolute left-[1px] origin-top-left rounded bg-cyan-500/90 px-1 font-mono text-[8px] leading-tight text-white"
              style={{ top: toScreenY(pointer.y) + 3, transform: "rotate(90deg) translateY(-11px)" }}
            >
              {Math.round(pointer.y)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* THE ELBOW — the ruler origin. Drag it to draw a guide at ANY angle,
          which is the only place a drag direction can mean "diagonal". */}
      {rulers ? (
        <div
          data-ruler-origin=""
          role="presentation"
          title="زاویه‌سنج — بکشید تا خط راهنمای مورب بسازید"
          onPointerDown={(event) => {
            const point = toArtboard(event.clientX, event.clientY);
            start(
              {
                kind: "angled",
                id: null,
                axis: null,
                angle: guideAngleForAxis("y"),
                x: point.x,
                y: point.y,
                anchor: clampPoint(point, artboard),
                press: clampPoint(point, artboard),
                rawX: point.x,
                rawY: point.y,
                droppedOnRuler: false,
                moved: false,
                origin: { clientX: event.clientX, clientY: event.clientY },
              },
              event,
            );
          }}
          onPointerMove={update}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          className="pointer-events-auto absolute cursor-crosshair border border-white/15 bg-[#0d1626]"
          style={{ top: 0, left: 0, width: RULER_THICKNESS, height: RULER_THICKNESS }}
        >
          <svg width={RULER_THICKNESS} height={RULER_THICKNESS} className="block">
            <path d="M2 13 L13 2" stroke="#22d3ee" strokeOpacity={0.75} strokeWidth={1.2} />
            <circle cx={3} cy={3} r={1.6} fill="#7dd3fc" />
          </svg>
        </div>
      ) : null}

      {/* GUIDES — drag to move, drag the handle to rotate, double-click to remove. */}
      <svg
        data-guides-layer=""
        className="pointer-events-none absolute inset-0 overflow-visible"
        width="100%"
        height="100%"
      >
        {guides.map((guide) => {
          const chord = chordFor(guide.angle, { x: guide.x, y: guide.y });
          if (!chord) return null;
          const active = hoveredId === guide.id || (drag?.id === guide.id && drag.moved);
          const axisAligned = isAxisAlignedAngle(guide.angle);
          const handle = rotateHandleAt(chord);
          return (
            <g key={guide.id}>
              <line
                data-guide={guide.id}
                data-angle={guide.angle}
                data-axis-aligned={axisAligned ? "yes" : "no"}
                data-x={guide.x}
                data-y={guide.y}
                x1={chord.x1}
                y1={chord.y1}
                x2={chord.x2}
                y2={chord.y2}
                stroke="#67e8f9"
                strokeOpacity={active ? 1 : 0.7}
                strokeWidth={1}
                pointerEvents="none"
              />
              {/* The hit target: same segment, invisible, wide. */}
              <line
                data-guide-hit={guide.id}
                x1={chord.x1}
                y1={chord.y1}
                x2={chord.x2}
                y2={chord.y2}
                stroke="transparent"
                strokeWidth={HIT_STROKE_PX}
                strokeLinecap="round"
                pointerEvents="stroke"
                style={{ cursor: axisAligned ? (isVertical(guide.angle) ? "col-resize" : "row-resize") : "move" }}
                onPointerOver={() => setHoveredId(guide.id)}
                onPointerOut={() => setHoveredId(null)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onRemove(guide.id);
                }}
                onPointerDown={(event) => {
                  const point = toArtboard(event.clientX, event.clientY);
                  if (guide.locked) {
                    event.preventDefault();
                    event.stopPropagation();
                    onPin?.(projectOnGuideForUi(guide, point), guide.angle);
                    return;
                  }
                  start(
                    {
                      kind: "move",
                      id: guide.id,
                      axis: axisForAngle(guide.angle),
                      angle: guide.angle,
                      x: guide.x,
                      y: guide.y,
                      anchor: { x: guide.x, y: guide.y },
                      press: point,
                      rawX: point.x,
                      rawY: point.y,
                      droppedOnRuler: false,
                      moved: false,
                      origin: { clientX: event.clientX, clientY: event.clientY },
                    },
                    event,
                  );
                }}
                onPointerMove={update}
                onPointerUp={() => finish(true)}
                onPointerCancel={() => finish(false)}
              />
              {/* Lock state is visible and directly controllable without entering another mode. */}
              <g data-guide-lock-control={guide.id}>
                <circle
                  cx={guide.x * scale + pan.x}
                  cy={guide.y * scale + pan.y}
                  r={9}
                  fill={guide.locked ? "#164e63" : "#07111d"}
                  stroke={guide.locked ? "#67e8f9" : "#94a3b8"}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
                <text
                  x={guide.x * scale + pan.x}
                  y={guide.y * scale + pan.y + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#e0f2fe"
                  pointerEvents="none"
                >{guide.locked ? "L" : "·"}</text>
                <circle
                  data-guide-lock-grip={guide.id}
                  cx={guide.x * scale + pan.x}
                  cy={guide.y * scale + pan.y}
                  r={13}
                  fill="transparent"
                  style={{ cursor: "pointer", pointerEvents: "auto" }}
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleLock?.(guide.id); }}
                />
              </g>
              {/* ROTATE HANDLE — always visible; locked guides expose it disabled. */}
              {true ? (
                <g data-guide-rotate={guide.id} data-disabled={guide.locked ? "yes" : "no"} opacity={guide.locked ? 0.45 : 1}>
                  <circle cx={handle.x} cy={handle.y} r={9} fill="#07111d" stroke="#a5f3fc" strokeWidth={1.5} />
                  <line
                    x1={handle.x - 3.5}
                    y1={handle.y}
                    x2={handle.x + 3.5}
                    y2={handle.y}
                    stroke="#a5f3fc"
                    strokeWidth={1}
                  />
                  <circle
                    data-guide-rotate-grip={guide.id}
                    cx={handle.x}
                    cy={handle.y}
                    r={11}
                    fill="transparent"
                    style={{ cursor: "grab" }}
                    onPointerDown={(event) => {
                      if (guide.locked) { event.preventDefault(); event.stopPropagation(); return; }
                      start(
                        {
                          kind: "rotate",
                          id: guide.id,
                          axis: axisForAngle(guide.angle),
                          angle: guide.angle,
                          x: guide.x,
                          y: guide.y,
                          anchor: { x: guide.x, y: guide.y },
                          press: { x: guide.x, y: guide.y },
                          rawX: guide.x,
                          rawY: guide.y,
                          droppedOnRuler: false,
                          moved: false,
                          origin: { clientX: event.clientX, clientY: event.clientY },
                        },
                        event,
                      );
                    }}
                    onPointerMove={update}
                    onPointerUp={() => finish(true)}
                    onPointerCancel={() => finish(false)}
                  />
                </g>
              ) : null}
            </g>
          );
        })}

        {/* The guide currently being created or dragged. */}
        {drag && drag.moved && dragChord ? (
          <line
            data-guide-drag=""
            x1={dragChord.x1}
            y1={dragChord.y1}
            x2={dragChord.x2}
            y2={dragChord.y2}
            stroke={drag.droppedOnRuler ? "#fb7185" : "#67e8f9"}
            strokeOpacity={0.85}
            strokeWidth={1}
            strokeDasharray={drag.kind === "angled" || drag.kind === "rotate" ? "4 3" : undefined}
            pointerEvents="none"
          />
        ) : null}
      </svg>

      {/* Exact readout while dragging: the number is the contract, not the pixel. */}
      {drag && drag.kind !== "create" && drag.moved ? (
        <span
          dir="ltr"
          data-guide-readout=""
          className={`pointer-events-none absolute rounded px-1.5 py-0.5 font-mono text-[9px] text-white ${
            drag.droppedOnRuler ? "bg-rose-500/90" : "bg-cyan-500/90"
          }`}
          style={{ left: toScreenX(drag.x) + 8, top: toScreenY(drag.y) - 18 }}
        >
          {drag.droppedOnRuler
            ? "حذف"
            : drag.kind === "rotate" || drag.kind === "angled"
              ? `${drag.angle}°`
              : `${round1(drag.x)}, ${round1(drag.y)}`}
        </span>
      ) : null}
    </div>
  );
}

/* --------------------------------- helpers --------------------------------- */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Only the two axis directions get a resize cursor and follow one coordinate. */
function isAxisAlignedAngle(angle: number): boolean {
  const normalized = normalizeAngle(angle);
  return normalized === 0 || normalized === 90;
}

function isVertical(angle: number): boolean {
  return normalizeAngle(angle) === 90;
}

/** Spacing between labelled ticks, recovered from the tick list itself. */
function majorStep(ticks: { value: number; major: boolean }[]): number {
  const majors = ticks.filter((tick) => tick.major).map((tick) => tick.value);
  for (let i = 1; i < majors.length; i += 1) {
    const step = majors[i] - majors[i - 1];
    if (step > 0) return step;
  }
  return 0;
}

/** True for the tick exactly halfway between two labelled ticks. */
function isHalfStep(value: number, step: number): boolean {
  if (step <= 0) return false;
  const relative = value / step;
  return Math.abs(relative - Math.round(relative) - 0.5) < 1e-6 || Math.abs(relative - Math.round(relative) + 0.5) < 1e-6;
}

/**
 * Where the rotate grip sits: the middle of the visible chord, so the gesture
 * "grab the line and swing it" reads the same at every angle and zoom.
 */
function rotateHandleAt(chord: { x1: number; y1: number; x2: number; y2: number }): Point {
  return { x: (chord.x1 + chord.x2) / 2, y: (chord.y1 + chord.y2) / 2 };
}
