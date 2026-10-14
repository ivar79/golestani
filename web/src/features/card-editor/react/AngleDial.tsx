"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeAngle } from "../domain/guides";
import { clipLineToBoard } from "./RulersAndGuides";

type Point = { x: number; y: number };
type Props = {
  vertex: Point;
  baseAngle: number;
  artboard: { width: number; height: number };
  zoom: number;
  pan: Point;
  onCommit: (absoluteAngle: number) => boolean;
  onCancel: () => void;
};

const SNAP_STEP = 15;
const RADIUS = 68;

function polar(cx: number, cy: number, r: number, angle: number): Point {
  const a = angle * Math.PI / 180;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

export function AngleDial({ vertex, baseAngle, artboard, zoom, pan, onCommit, onCancel }: Props) {
  const [theta, setTheta] = useState(90);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const base = normalizeAngle(baseAngle);
  const cx = pan.x + vertex.x * scale;
  const cy = pan.y + vertex.y * scale;

  const readTheta = useCallback((clientX: number, clientY: number, shift: boolean) => {
    const rect = hostRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    const raw = normalizeAngle(Math.atan2(y - cy, x - cx) * 180 / Math.PI - base);
    const bounded = Math.max(0, Math.min(180, raw > 180 ? 360 - raw : raw));
    return Math.round((shift ? bounded : Math.round(bounded / SNAP_STEP) * SNAP_STEP) * 10) / 10;
  }, [base, cx, cy]);

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
    const angle = base + i * SNAP_STEP;
    const a = polar(cx, cy, RADIUS - (i % 3 === 0 ? 10 : 5), angle);
    const b = polar(cx, cy, RADIUS, angle);
    const label = polar(cx, cy, RADIUS + 14, angle);
    return <g key={i} pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fbbf24" strokeWidth={i % 3 === 0 ? 1.6 : 1} />
      {i % 3 === 0 && <text x={label.x} y={label.y} fill="#fde68a" fontSize={9} textAnchor="middle" dominantBaseline="middle">{i * SNAP_STEP}°</text>}
    </g>;
  });

  return <div ref={hostRef} data-angle-dial="" className="pointer-events-none absolute inset-0 z-40">
    <svg className="absolute inset-0 h-full w-full overflow-visible">
      {chord && <line data-angle-preview="" x1={pan.x + chord.x1 * scale} y1={pan.y + chord.y1 * scale} x2={pan.x + chord.x2 * scale} y2={pan.y + chord.y2 * scale} stroke="#67e8f9" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />}
      <path d={`M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 1 1 ${end.x} ${end.y}`} fill="none" stroke="transparent" strokeWidth={24} pointerEvents="stroke" style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); dragRef.current = true; setDragging(true); (event.currentTarget as Element).setPointerCapture?.(event.pointerId); setTheta(readTheta(event.clientX,event.clientY,event.shiftKey)); }}
        onPointerMove={event => { if (dragRef.current) setTheta(readTheta(event.clientX,event.clientY,event.shiftKey)); }}
        onPointerUp={() => { dragRef.current = false; setDragging(false); }}
        onPointerCancel={() => { dragRef.current = false; setDragging(false); }} />
      <path d={`M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 1 1 ${end.x} ${end.y}`} fill="none" stroke="#fbbf24" strokeWidth={2} pointerEvents="none" />
      <line x1={cx} y1={cy} x2={start.x} y2={start.y} stroke="#94a3b8" strokeOpacity={0.8} strokeWidth={1.5} pointerEvents="none" />
      <line data-angle-needle-hit="" x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="transparent" strokeWidth={18} pointerEvents="stroke" style={{ cursor: "grab" }}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); dragRef.current = true; setDragging(true); (event.currentTarget as Element).setPointerCapture?.(event.pointerId); setTheta(readTheta(event.clientX,event.clientY,event.shiftKey)); }}
        onPointerMove={event => { if (dragRef.current) setTheta(readTheta(event.clientX,event.clientY,event.shiftKey)); }}
        onPointerUp={() => { dragRef.current = false; setDragging(false); }}
        onPointerCancel={() => { dragRef.current = false; setDragging(false); }} />
      {ticks}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#fbbf24" strokeWidth={dragging ? 3.5 : 2.5} strokeLinecap="round" pointerEvents="none" />
      <circle cx={cx} cy={cy} r={5} fill="#fbbf24" stroke="#111827" strokeWidth={2} pointerEvents="none" />
    </svg>
    <div dir="ltr" className="pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-amber-300/30 bg-slate-950/95 p-2 shadow-xl"
      style={{ left: Math.max(4, Math.min(cx - 85, artboard.width * scale - 180)), top: Math.max(4, cy + 76) }}
      onPointerDown={event => event.stopPropagation()}>
      <label className="text-[10px] text-amber-100">θ</label>
      <input ref={inputRef} aria-label="زاویه نقاله" type="number" min={0} max={180} step={1} value={theta}
        onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) setTheta(Math.max(0, Math.min(180, n))); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
        className="w-14 rounded border border-white/15 bg-black px-1 py-1 text-center font-mono text-xs text-white" />
      <span className="text-xs text-amber-100">°</span>
      <button type="button" aria-label="ثبت زاویه" onClick={commit} className="rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100">✓</button>
      <button type="button" aria-label="لغو زاویه" onClick={onCancel} className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-100">✕</button>
      {notice && <span role="status" className="text-[10px] text-rose-200">{notice}</span>}
    </div>
  </div>;
}
