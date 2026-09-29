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
   * When omitted, every change the caller receives is already final on its
   * own (the legacy per-change contract, e.g. the shape fill section).
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

  // Close the stop-color popover on click-outside (pointerdown anywhere that
  // is not the popover itself). The color drags commit on pointerUp, so by the
  // time a press lands outside the popover the edit is already final.
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

  // The working gradient model — derived from the current CSS value, or the
  // default two-stop when the field is still solid/empty.
  const gradient: Gradient =
    mode === "linear" || mode === "radial"
      ? parseGradientCss(value ?? "", mode)
      : createGradient({ type: "linear", angle: 135 });

  const emit = (next: Gradient): void => {
    onChange(gradientToCss(next));
  };

  /**
   * End the pending gesture. A caller that doesn't model transient state
   * (no `onGestureEnd`) has its `onChange` commit on every change already, so
   * this is a no-op there and the legacy behaviour is preserved exactly.
   */
  const commit = (): void => {
    onGestureEnd?.();
  };

  /**
   * A DISCRETE action (mode switch, add/remove stop): the change goes out as
   * transient state and is then committed as exactly ONE history record.
   */
  const emitCommitted = (next: Gradient): void => {
    emit(next);
    commit();
  };

  const switchMode = (next: Mode): void => {
    if (next === mode) return;
    if (next === "solid") {
      // Committing back to solid uses the gradient's first stop color.
      onChange(gradient.stops[0]?.color ?? "#ffffff");
      commit();
      return;
    }
    emitCommitted(createGradient({ type: next === "radial" ? "radial" : "linear", angle: gradient.angle, stops: gradient.stops }));
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      {/* Mode switch */}
      <div className="mb-3 flex gap-1.5">
        {(["solid", "linear", "radial"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
              mode === m ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"
            }`}
          >
            {m === "solid" ? "یکدست" : m === "linear" ? "خطی" : "دایره‌ای"}
          </button>
        ))}
      </div>

      {mode === "solid" ? (
        <p className="text-[10px] leading-4 text-slate-500">
          پس‌زمینه یکدست است. برای ساخت طلق رنگی، «خطی» یا «دایره‌ای» را انتخاب کنید.
        </p>
      ) : (
        <>
          {/* Angle (linear only) */}
          {mode === "linear" && (
            <label className="mb-2 block">
              <span className="mb-1 block text-[10px] text-slate-500">زاویه: {Math.round(gradient.angle)}°</span>
              <input
                type="range"
                min={0}
                max={360}
                value={Math.round(gradient.angle)}
                onChange={(e) => emit({ ...gradient, angle: Number(e.target.value) })}
                onPointerUp={commit}
                onBlur={commit}
                className="w-full accent-cyan-400"
              />
            </label>
          )}

          {/* Live preview strip */}
          <div
            className="mb-2 h-10 w-full rounded-lg border border-white/10"
            style={{ background: gradientToCss(gradient) }}
          />

          {/* Stop list */}
          <div className="space-y-1.5">
            {gradient.stops.map((stop, index) => (
              <div
                key={index}
                className="relative flex items-center gap-2"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && editingStop === index) setEditingStop(null);
                }}
              >
                <button
                  type="button"
                  title="رنگ این نقطه"
                  onClick={() => setEditingStop(editingStop === index ? null : index)}
                  className="h-6 w-6 shrink-0 rounded-md border border-white/20"
                  style={{ background: stop.color }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(stop.offset)}
                  onChange={(e) => emit(updateStop(gradient, index, { offset: Number(e.target.value) }))}
                  onPointerUp={commit}
                  onBlur={commit}
                  className="flex-1 accent-cyan-400"
                  aria-label="موقعیت نقطه رنگ"
                />
                <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                  {Math.round(stop.offset)}٪
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(stop.opacity * 100)}
                  onChange={(e) => emit(updateStop(gradient, index, { opacity: Number(e.target.value) / 100 }))}
                  onPointerUp={commit}
                  onBlur={commit}
                  className="w-14 accent-cyan-400"
                  aria-label="شفافیت نقطه رنگ"
                />
                <button
                  type="button"
                  title="حذف نقطه"
                  disabled={gradient.stops.length <= 2}
                  onClick={() => emitCommitted(removeStop(gradient, index))}
                  className="shrink-0 rounded-md px-1 text-rose-400 hover:bg-rose-500/15 disabled:opacity-30"
                >
                  −
                </button>
                {editingStop === index && (
                  <div
                    ref={popoverRef}
                    // Anchored INSIDE this row (relative) so it can never escape the
                    // panel: it drops below the row, hugs the row's inline-end edge
                    // and is capped at the row width.
                    className="absolute end-0 top-full z-50 mt-1 w-64 max-w-full rounded-lg border border-white/10 bg-[#0c1626] p-2 shadow-xl"
                  >
                    <div onPointerUp={commit}>
                      <HexColorPicker
                        color={stop.color}
                        onChange={(c) => emit(updateStop(gradient, index, { color: c }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {gradient.stops.length < 6 && (
            <button
              type="button"
              onClick={() => emitCommitted(addStop(gradient, 50))}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white"
            >
              + افزودن نقطه رنگ
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
