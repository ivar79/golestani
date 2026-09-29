"use client";

/**
 * GradientField — the gradient editor for document background + shape fills.
 *
 * Architecture contract: the document model owns the state — this picker is a
 * pure projection of the editor's Gradient value object (domain/gradient.ts)
 * and emits the resulting CSS string through `onChange`. react-colorful /
 * hex inputs are used for stop colors, but the component itself never owns a
 * color value independent of the gradient (single source of truth).
 */
import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Trash2 } from "lucide-react";
import {
  createGradient,
  gradientToCss,
  addStop,
  removeStop,
  updateStop,
  type Gradient,
} from "../domain/gradient";

type Props = {
  /** Current CSS string (solid or gradient) — parsed into the editor model. */
  value: string | null;
  /** Live change (transient — the caller keeps the document in step). */
  onChange: (css: string) => void;
  /**
   * The gesture ended (pointer up / blur / discrete click): commit once.
   */
  onGestureEnd?: () => void;
};

type Mode = "solid" | "linear" | "radial";

function detectMode(value: string | null): Mode {
  if (!value) return "solid";
  if (value.startsWith("radial-gradient(")) return "radial";
  if (value.startsWith("linear-gradient(")) return "linear";
  return "solid";
}

export function GradientField({ value, onChange, onGestureEnd }: Props) {
  const mode = detectMode(value);
  const [editingStop, setEditingStop] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingStop === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setEditingStop(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [editingStop]);

  const gradient: Gradient =
    mode === "linear" || mode === "radial"
      ? parseGradientCss(value ?? "", mode)
      : createGradient({ type: "linear", angle: 135 });

  const emit = (next: Gradient): void => {
    onChange(gradientToCss(next));
  };

  const commit = (): void => {
    onGestureEnd?.();
  };

  const emitCommitted = (next: Gradient): void => {
    emit(next);
    commit();
  };

  const switchMode = (next: Mode): void => {
    if (next === mode) return;
    if (next === "solid") {
      onChange(gradient.stops[0]?.color ?? "#ffffff");
      commit();
      return;
    }
    emitCommitted(createGradient({ type: next === "radial" ? "radial" : "linear", angle: gradient.angle, stops: gradient.stops }));
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
      {/* Mode switch */}
      <div className="flex gap-1.5 rounded-lg border border-white/10 bg-white/5 p-1">
        {(["solid", "linear", "radial"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`flex-1 rounded-md py-1.5 text-[11px] font-bold transition ${
              mode === m ? "bg-cyan-500/25 text-cyan-300 shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            {m === "solid" ? "یکدست" : m === "linear" ? "گرادیان خطی" : "گرادیان شعاعی"}
          </button>
        ))}
      </div>

      {mode === "solid" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">
            رنگ زمینه یکدست انتخاب شده است. برای تغییر رنگ، از پالت زیر یا حالت گرادیان استفاده کنید.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditingStop(editingStop === 0 ? null : 0)}
              className="h-9 w-12 rounded-lg border border-white/20 shadow-inner"
              style={{ background: gradient.stops[0]?.color ?? "#ffffff" }}
              title="انتخاب رنگ یکدست"
            />
            <span className="font-mono text-xs text-slate-300">
              {gradient.stops[0]?.color ?? "#ffffff"}
            </span>
          </div>
          {editingStop === 0 && (
            <div
              ref={popoverRef}
              className="relative z-50 mt-2 rounded-xl border border-white/15 bg-[#0a1424] p-3 shadow-2xl"
            >
              <HexColorPicker
                color={gradient.stops[0]?.color ?? "#ffffff"}
                onChange={(c) => {
                  onChange(c);
                  commit();
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Angle (linear only) */}
          {mode === "linear" && (
            <label className="block rounded-lg border border-white/5 bg-white/[0.02] p-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">زاویه تابش گرادیان</span>
                <span className="font-mono font-bold text-cyan-300">{Math.round(gradient.angle)}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={Math.round(gradient.angle)}
                onChange={(e) => emit({ ...gradient, angle: Number(e.target.value) })}
                onPointerUp={commit}
                onBlur={commit}
                className="w-full accent-cyan-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
              />
            </label>
          )}

          {/* Live preview strip */}
          <div
            className="h-10 w-full rounded-xl border border-white/15 shadow-inner"
            style={{ background: gradientToCss(gradient) }}
          />

          {/* Stop list */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-slate-300">نقاط رنگ گرادیان:</div>
            {gradient.stops.map((stop, index) => (
              <div
                key={index}
                className="relative rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-2"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && editingStop === index) setEditingStop(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title="تغییر رنگ نقطه"
                      onClick={() => setEditingStop(editingStop === index ? null : index)}
                      className="h-7 w-7 shrink-0 rounded-lg border border-white/30 shadow-sm transition hover:scale-105"
                      style={{ background: stop.color }}
                    />
                    <span className="font-mono text-xs text-slate-300">{stop.color}</span>
                  </div>

                  <button
                    type="button"
                    title="حذف این نقطه"
                    disabled={gradient.stops.length <= 2}
                    onClick={() => emitCommitted(removeStop(gradient, index))}
                    className="flex items-center justify-center h-6 w-6 rounded-md border border-rose-500/30 text-rose-400 hover:bg-rose-500/15 disabled:opacity-20 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Offset & Opacity sliders with explicit labels */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5 text-[10px]">
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>موقعیت</span>
                      <span className="font-mono text-cyan-300">{Math.round(stop.offset)}٪</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(stop.offset)}
                      onChange={(e) => emit(updateStop(gradient, index, { offset: Number(e.target.value) }))}
                      onPointerUp={commit}
                      onBlur={commit}
                      className="w-full accent-cyan-400 h-1 bg-white/10 rounded cursor-pointer"
                      aria-label="موقعیت نقطه رنگ"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>شفافیت</span>
                      <span className="font-mono text-cyan-300">{Math.round(stop.opacity * 100)}٪</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(stop.opacity * 100)}
                      onChange={(e) => emit(updateStop(gradient, index, { opacity: Number(e.target.value) / 100 }))}
                      onPointerUp={commit}
                      onBlur={commit}
                      className="w-full accent-cyan-400 h-1 bg-white/10 rounded cursor-pointer"
                      aria-label="شفافیت نقطه رنگ"
                    />
                  </div>
                </div>

                {editingStop === index && (
                  <div
                    ref={popoverRef}
                    className="relative z-50 mt-2 rounded-xl border border-white/15 bg-[#0a1424] p-3 shadow-2xl"
                  >
                    <HexColorPicker
                      color={stop.color}
                      onChange={(c) => emit(updateStop(gradient, index, { color: c }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {gradient.stops.length < 6 && (
            <button
              type="button"
              onClick={() => emitCommitted(addStop(gradient, 50))}
              className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition"
            >
              + افزودن نقطه رنگ جدید
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default GradientField;

/**
 * Parse a CSS gradient string our editor produces back into the Gradient
 * model. Only the shapes gradientToCss emits are handled — hand-written CSS
 * outside that shape keeps the field in "solid" mode.
 */
function parseGradientCss(css: string, mode: "linear" | "radial"): Gradient {
  const isRadial = mode === "radial";
  const inner = css
    .replace(/^radial-gradient\(/, "")
    .replace(/^linear-gradient\(/, "")
    .replace(/\)$/, "");
  const parts = splitTopLevel(inner);
  let angle = 135;
  let stops = parts;
  if (!isRadial && parts.length > 1) {
    const first = parts[0].trim();
    const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/.exec(first);
    if (angleMatch) {
      angle = Number(angleMatch[1]);
      stops = parts.slice(1);
    }
  } else if (isRadial) {
    // radial-gradient(circle at center, ...) — drop the shape descriptor.
    if (!parts[0].includes("%") && !parts[0].startsWith("#") && !parts[0].startsWith("rgb")) {
      stops = parts.slice(1);
    }
  }
  const parsed = stops.map((raw) => {
    const [color, offsetRaw] = raw.trim().split(/\s+/);
    const offset = offsetRaw?.endsWith("%") ? Number(offsetRaw.slice(0, -1)) : 0;
    return { offset: Number.isFinite(offset) ? offset : 0, color: color ?? "#000000", opacity: 1 };
  });
  return createGradient({ type: mode, angle, stops: parsed });
}

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") out.push(current);
  return out;
}

