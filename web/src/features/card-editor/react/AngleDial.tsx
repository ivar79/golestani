"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeAngle } from "../domain/guides";
import { clipLineToBoard } from "./RulersAndGuides";

type Point = { x: number; y: number };
type DragMode = "angle" | "baseline" | "vertex" | null;
type Props = {
  vertex: Point;
  baseAngle: number;
  artboard: { width: number; height: number };
  zoom: number;
  pan: Point;
  onCommit: (absoluteAngle: number) => boolean;
  onCancel: () => void;
  onMoveVertex: (vertex: Point) => void;
  onSetBaseAngle: (angle: number) => void;
};

const DEFAULT_SNAP_STEP = 15;
const RADIUS = 68;

function polar(cx: number, cy: number, r: number, angle: number): Point {
  const a = angle * Math.PI / 180;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

export function AngleDial({ vertex, baseAngle, artboard, zoom, pan, onCommit, onCancel, onMoveVertex, onSetBaseAngle }: Props) {
  const [theta, setTheta] = useState(90);
  const [snapStep, setSnapStep] = useState(DEFAULT_SNAP_STEP);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const dragModeRef = useRef<DragMode>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const base = normalizeAngle(baseAngle);
  const cx = pan.x + vertex.x * scale;
  const cy = pan.y + vertex.y * scale;

  const toBoard = useCallback((clientX: number, clientY: number): Point => {
    const rect = hostRef.current?.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(artboard.width, (clientX - (rect?.left ?? 0) - pan.x) / scale)),
      y: Math.max(0, Math.min(artboard.height, (clientY - (rect?.top ?? 0) - pan.y) / scale)),
    };
  }, [artboard.height, artboard.width, pan.x, pan.y, scale]);

  const readTheta = useCallback((clientX: number, clientY: number, shift: boolean) => {
    const rect = hostRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    const raw = normalizeAngle(Math.atan2(y - cy, x - cx) * 180 / Math.PI - base);
    const step = shift ? 1 : snapStep;
    return Math.max(0, Math.min(180, Math.round(raw / step) * step));
  }, [base, cx, cy, snapStep]);

  const readBaseAngle = useCallback((clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    return normalizeAngle(Math.atan2(y - cy, x - cx) * 180 / Math.PI);
  }, [cx, cy]);

  const commit = useCallback(() => {
    if (!onCommit(normalizeAngle(base + theta))) {
      setNotice("حداکثر ۲۴ خط راهنما");
      window.setTimeout(() => setNotice(""), 2200);
    }
  }, [base, onCommit, theta]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Enter" && document.activeElement !== inputRef.current) {
        event.preventDefault(); commit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, onCancel]);

  const chord = clipLineToBoard(vertex, base + theta, artboard, 28);
  const start = polar(cx, cy, RADIUS, base);
  const end = polar(cx, cy, RADIUS, base + 180);
  const needle = polar(cx, cy, RADIUS, base + theta);
  const ticks = Array.from({ length: 13 }, (_, i) => {
    const angle = base + i * DEFAULT_SNAP_STEP;
    const a = polar(cx, cy, RADIUS - (i % 3 === 0 ? 10 : 5), angle);
    const b = polar(cx, cy, RADIUS, angle);
    const label = polar(cx, cy, RADIUS + 14, angle);
    return <g key={i} pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fbbf24" strokeWidth={i % 3 === 0 ? 1.6 : 1} />
      {i % 3 === 0 && <text x={label.x} y={label.y} fill="#fde68a" fontSize={9} textAnchor="middle" dominantBaseline="middle">{i * DEFAULT_SNAP_STEP}°</text>}
    </g>;
  });

  const startDrag = (mode: Exclude<DragMode, null>, event: React.PointerEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragModeRef.current = mode;
    setDragging(mode === "angle");
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    if (mode === "angle") setTheta(readTheta(event.clientX, event.clientY, event.shiftKey));
    if (mode === "baseline") onSetBaseAngle(readBaseAngle(event.clientX, event.clientY));
    if (mode === "vertex") onMoveVertex(toBoard(event.clientX, event.clientY));
  };
  const moveDrag = (event: React.PointerEvent<SVGElement>) => {
    const mode = dragModeRef.current;
    if (!mode) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === "angle") setTheta(readTheta(event.clientX, event.clientY, event.shiftKey));
    if (mode === "baseline") onSetBaseAngle(readBaseAngle(event.clientX, event.clientY));
    if (mode === "vertex") onMoveVertex(toBoard(event.clientX, event.clientY));
  };
  const endDrag = (event: React.PointerEvent<SVGElement>) => {
    event.stopPropagation();
    dragModeRef.current = null;
    setDragging(false);
  };

  return <div ref={hostRef} data-angle-dial="" className="pointer-events-none absolute inset-0 z-40">
    <svg className="absolute inset-0 h-full w-full overflow-visible">
      {chord && <line data-angle-preview="" x1={pan.x + chord.x1 * scale} y1={pan.y + chord.y1 * scale} x2={pan.x + chord.x2 * scale} y2={pan.y + chord.y2 * scale} stroke="#67e8f9" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />}
      <path d={`M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 1 1 ${end.x} ${end.y}`} fill="none" stroke="transparent" strokeWidth={24} pointerEvents="stroke" style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={event => startDrag("angle", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      <path d={`M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 1 1 ${end.x} ${end.y}`} fill="none" stroke="#fbbf24" strokeWidth={2} pointerEvents="none" />
      <line x1={cx} y1={cy} x2={start.x} y2={start.y} stroke="#94a3b8" strokeOpacity={0.8} strokeWidth={1.5} pointerEvents="none" />
      <line data-angle-baseline-hit="" x1={cx} y1={cy} x2={start.x} y2={start.y} stroke="transparent" strokeWidth={18} pointerEvents="stroke" style={{ cursor: "grab" }}
        onPointerDown={event => startDrag("baseline", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      <line data-angle-needle-hit="" x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="transparent" strokeWidth={18} pointerEvents="stroke" style={{ cursor: "grab" }}
        onPointerDown={event => startDrag("angle", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      {ticks}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#fbbf24" strokeWidth={dragging ? 3.5 : 2.5} strokeLinecap="round" pointerEvents="none" />
      <circle data-angle-center-hit="" cx={cx} cy={cy} r={16} fill="transparent" pointerEvents="all" style={{ cursor: "move" }}
        onPointerDown={event => startDrag("vertex", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      <circle cx={cx} cy={cy} r={5} fill="#fbbf24" stroke="#111827" strokeWidth={2} pointerEvents="none" />
    </svg>
    <div dir="ltr" className="pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-amber-300/30 bg-slate-950/95 p-2 shadow-xl"
      style={{ left: Math.max(4, Math.min(cx - 85, artboard.width * scale - 210)), top: Math.max(4, cy + 76) }}
      onPointerDown={event => event.stopPropagation()}>
      <label className="text-[10px] text-amber-100">θ</label>
      <input ref={inputRef} aria-label="زاویه نقاله" type="number" min={0} max={180} step={snapStep} value={theta}
        onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) setTheta(Math.max(0, Math.min(180, n))); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
        className="w-14 rounded border border-white/15 bg-black px-1 py-1 text-center font-mono text-xs text-white" />
      <span className="text-xs text-amber-100">°</span>
      <button type="button" aria-label="گام زاویه" title="گام زاویه ۱۵° / ۱°" onClick={() => setSnapStep(step => step === 15 ? 1 : 15)} className="rounded bg-cyan-500/15 px-2 py-1 text-[10px] text-cyan-100">{snapStep}°</button>
      <button type="button" aria-label="ثبت زاویه" onClick={commit} className="rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100">✓</button>
      <button type="button" aria-label="لغو زاویه" onClick={onCancel} className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-100">✕</button>
      {notice && <span role="status" className="text-[10px] text-rose-200">{notice}</span>}
    </div>
  </div>;
}
