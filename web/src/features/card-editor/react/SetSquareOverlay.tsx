"use client";

import { useRef } from "react";
import { SET_SQUARE_MAX_SIZE, SET_SQUARE_MIN_SIZE, setSquareVertices, type SetSquare } from "../domain/setSquare";

type Point = { x: number; y: number };
type Drag = { id: string; kind: "move" | "rotate" | "resize"; start: Point; center: Point; initialAngle: number; initialSize: number; initialPointerAngle: number; initialDistance: number };
type Props = {
  squares: SetSquare[];
  zoom: number;
  pan: Point;
  angleSnap: number | null;
  engagedEdge?: { squareId: string; edgeIndex: number } | null;
  onMove: (id: string, center: Point) => void;
  onRotate: (id: string, angle: number) => void;
  onResize: (id: string, size: number) => void;
  onToggleLock: (id: string) => void;
  onSwitchKind: (id: string) => void;
  onRemove: (id: string) => void;
};

function pointAngle(a: Point, b: Point) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
function pointDistance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function SetSquareOverlay({ squares, zoom, pan, angleSnap, engagedEdge, onMove, onRotate, onResize, onToggleLock, onSwitchKind, onRemove }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const toBoard = (event: { clientX: number; clientY: number }): Point => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: (event.clientX - (rect?.left ?? 0) - pan.x) / scale, y: (event.clientY - (rect?.top ?? 0) - pan.y) / scale };
  };
  const begin = (event: React.PointerEvent<SVGElement>, square: SetSquare, kind: Drag["kind"]) => {
    event.preventDefault(); event.stopPropagation();
    if (square.locked) return;
    const p = toBoard(event);
    dragRef.current = { id: square.id, kind, start: p, center: { x: square.cx, y: square.cy }, initialAngle: square.angle, initialSize: square.size, initialPointerAngle: pointAngle({ x: square.cx, y: square.cy }, p), initialDistance: pointDistance({ x: square.cx, y: square.cy }, p) };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };
  const move = (event: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    const p = toBoard(event);
    if (drag.kind === "move") onMove(drag.id, { x: drag.center.x + p.x - drag.start.x, y: drag.center.y + p.y - drag.start.y });
    if (drag.kind === "rotate") {
      let angle = drag.initialAngle + pointAngle(drag.center, p) - drag.initialPointerAngle;
      if (angleSnap && angleSnap > 0) angle = Math.round(angle / angleSnap) * angleSnap;
      onRotate(drag.id, angle);
    }
    if (drag.kind === "resize") {
      const size = drag.initialSize * pointDistance(drag.center, p) / Math.max(1, drag.initialDistance);
      onResize(drag.id, Math.max(SET_SQUARE_MIN_SIZE, Math.min(SET_SQUARE_MAX_SIZE, size)));
    }
  };
  const end = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); dragRef.current = null; };

  return <div ref={hostRef} data-set-square-overlay="" className="pointer-events-none absolute inset-0 z-30">
    <svg className="absolute inset-0 h-full w-full overflow-visible">
      {squares.map(square => {
        const vertices = setSquareVertices(square);
        const screen = vertices.map(p => ({ x: pan.x + p.x * scale, y: pan.y + p.y * scale }));
        const center = { x: pan.x + square.cx * scale, y: pan.y + square.cy * scale };
        const hypotenuseMid = { x: (screen[1].x + screen[2].x) / 2, y: (screen[1].y + screen[2].y) / 2 };
        const rotateHandle = { x: center.x, y: center.y - Math.max(34, square.size * scale * 0.72) };
        const points = screen.map(p => `${p.x},${p.y}`).join(" ");
        return <g key={square.id} data-set-square={square.id} data-locked={square.locked ? "yes" : "no"}>
          <polygon points={points} fill="#fbbf24" fillOpacity={square.locked ? 0.12 : 0.08} stroke="#fbbf24" strokeOpacity={0.9} strokeWidth={1.5} pointerEvents="none" />
          {screen.map((p, i) => <line key={i} x1={p.x} y1={p.y} x2={screen[(i+1)%3].x} y2={screen[(i+1)%3].y} stroke={engagedEdge?.squareId === square.id && engagedEdge.edgeIndex === i ? "#67e8f9" : "#fbbf24"} strokeWidth={engagedEdge?.squareId === square.id && engagedEdge.edgeIndex === i ? 4 : 1.5} strokeOpacity={0.95} pointerEvents="none" />)}
          <polygon data-set-square-body={square.id} points={points} fill="transparent" stroke="transparent" strokeWidth={16} style={{ pointerEvents: square.locked ? "none" : "auto", cursor: square.locked ? "default" : "move" }} onPointerDown={e => begin(e, square, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          <circle cx={rotateHandle.x} cy={rotateHandle.y} r={7} fill={square.locked ? "#475569" : "#0f172a"} stroke={square.locked ? "#64748b" : "#fde68a"} strokeWidth={1.5} pointerEvents="none" />
          <circle data-set-square-rotate={square.id} cx={rotateHandle.x} cy={rotateHandle.y} r={13} fill="transparent" style={{ pointerEvents: square.locked ? "none" : "auto", cursor: "grab" }} onPointerDown={e => begin(e, square, "rotate")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          <circle cx={hypotenuseMid.x} cy={hypotenuseMid.y} r={6} fill={square.locked ? "#475569" : "#0f172a"} stroke={square.locked ? "#64748b" : "#67e8f9"} strokeWidth={1.5} pointerEvents="none" />
          <circle data-set-square-resize={square.id} cx={hypotenuseMid.x} cy={hypotenuseMid.y} r={12} fill="transparent" style={{ pointerEvents: square.locked ? "none" : "auto", cursor: "nwse-resize" }} onPointerDown={e => begin(e, square, "resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        </g>;
      })}
    </svg>
    {squares.map(square => <div key={square.id} data-set-square-controls={square.id} className="pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-amber-300/25 bg-slate-950/95 p-1 shadow-lg"
      style={{ left: Math.max(2, pan.x + square.cx * scale - 52), top: Math.max(2, pan.y + square.cy * scale + 10) }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}>
      <button type="button" aria-label={square.locked ? "بازکردن قفل گونیا" : "قفل گونیا"} title={square.locked ? "بازکردن قفل" : "قفل"} onClick={() => onToggleLock(square.id)} className="rounded px-1.5 py-1 text-[10px] text-amber-100">{square.locked ? "🔒" : "🔓"}</button>
      <button type="button" aria-label="تغییر نوع گونیا" title="۴۵° ↔ ۳۰°/۶۰°" disabled={square.locked} onClick={() => onSwitchKind(square.id)} className="rounded px-1.5 py-1 text-[10px] text-amber-100 disabled:opacity-40">{square.kind === "45-45-90" ? "45°" : "30°/60°"}</button>
      <button type="button" aria-label="حذف گونیا" title="حذف گونیا" disabled={square.locked} onClick={() => onRemove(square.id)} className="rounded px-1.5 py-1 text-[10px] text-rose-200 disabled:opacity-40">×</button>
    </div>)}
  </div>;
}
