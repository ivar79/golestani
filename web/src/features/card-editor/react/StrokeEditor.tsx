"use client";

/**
 * StrokeEditor — the professional stroke control block.
 *
 * Shared by the shape and the path inspectors, because a stroke means the same
 * thing for both: colour, width, dash pattern, cap, join and alpha.
 *
 * LIVE vs COMMIT: sliders and the colour picker write through the engine's
 * TRANSIENT path while the gesture is in flight (real-time preview on the
 * canvas) and commit exactly ONE history entry when it ends. Discrete controls
 * (swatches, segmented buttons) apply immediately as their own single record.
 * That is the same contract drags already use — no history churn per pixel.
 */

import type { StrokeLineCap, StrokeLineJoin, StrokeStyleKind } from "../domain/document";
import { EDITOR_PALETTE } from "../domain/palette";
import {
  clampStrokeWidth,
  STROKE_LINE_CAP_LABELS,
  STROKE_LINE_JOIN_LABELS,
  STROKE_STYLE_LABELS,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
  type StrokeSource,
} from "../domain/stroke";
import type { EditorEngine } from "../engine/EditorEngine";
import { ColorPickerField } from "./ColorPickerField";

const STYLE_ORDER: StrokeStyleKind[] = ["solid", "dashed", "dotted"];
const CAP_ORDER: StrokeLineCap[] = ["butt", "round", "square"];
const JOIN_ORDER: StrokeLineJoin[] = ["miter", "round", "bevel"];

/** A small segmented control (stroke style / cap / join, and the brush's own). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  labels,
  onChange,
  disabled,
  disabledHint,
}: {
  label: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold text-slate-300">{label}</span>
      <div
        className="flex gap-1 rounded-lg bg-black/20 p-1"
        title={disabled ? disabledHint : undefined}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-md py-1 text-[10px] font-bold transition ${
              value === option ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400 hover:text-slate-200"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StrokeEditor({
  engine,
  layerId,
  stroke,
  /** Painted when the layer has no explicit stroke colour of its own. */
  fallbackColor,
  /** Shapes may have NO stroke at all (width 0); a path must always draw one. */
  allowNoStroke,
}: {
  engine: EditorEngine;
  layerId: string;
  stroke: StrokeSource;
  fallbackColor: string;
  allowNoStroke: boolean;
}) {
  const style = stroke.strokeStyle ?? "solid";
  const linecap = stroke.strokeLinecap ?? "round";
  const linejoin = stroke.strokeLinejoin ?? "round";
  const opacity = Math.round((stroke.strokeOpacity ?? 1) * 100);
  const color = stroke.stroke ?? fallbackColor;
  const width = stroke.strokeWidth ?? 0;
  const minWidth = allowNoStroke ? 0 : STROKE_WIDTH_MIN;

  /** Live edit — no history until the gesture ends. */
  const live = (patch: StrokeSource) => engine.transientPatch(layerId, patch as never);
  /** Gesture ended — record the whole live gesture as ONE undo step. */
  const commit = () => engine.commitTransient();
  /** Discrete change — its own single history record. */
  const apply = (patch: StrokeSource) => engine.updateLayer(layerId, patch as never);

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-white">خط دور (Stroke)</h4>
        <span className="text-[10px] tabular-nums text-slate-500">
          {width > 0 ? `${width}px` : "بدون خط"}
        </span>
      </div>

      {/* Colour */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ خط</span>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {EDITOR_PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => apply({ stroke: swatch })}
              className={`h-6 w-6 rounded-full border-2 ${
                color.toLowerCase() === swatch ? "border-cyan-400" : "border-white/20"
              }`}
              style={{ background: swatch }}
            />
          ))}
        </div>
        <ColorPickerField
          value={color}
          onChange={(next) => live({ stroke: next })}
          onGestureEnd={commit}
        />
      </div>

      {/* Width — the real-time slider the product asked for (0/1 … 50). */}
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>ضخامت خط</span>
          <span className="tabular-nums text-slate-400">{width}px</span>
        </span>
        <input
          type="range"
          min={minWidth}
          max={STROKE_WIDTH_MAX}
          step={1}
          value={width}
          aria-label="ضخامت خط"
          onChange={(event) => {
            const next = Number(event.target.value);
            // Shapes may go down to 0 = "no stroke"; a path must keep one.
            live({ strokeWidth: allowNoStroke && next <= 0 ? 0 : clampStrokeWidth(next) });
          }}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="w-full accent-cyan-400"
        />
      </label>

      <SegmentedControl
        label="استایل خط"
        options={STYLE_ORDER}
        value={style}
        labels={STROKE_STYLE_LABELS}
        onChange={(next) => apply({ strokeStyle: next })}
      />

      <div className="grid grid-cols-2 gap-2">
        <SegmentedControl
          label="سر خط (Cap)"
          options={CAP_ORDER}
          value={style === "dotted" ? "round" : linecap}
          labels={STROKE_LINE_CAP_LABELS}
          onChange={(next) => apply({ strokeLinecap: next })}
          // A dotted stroke is a sub-pixel dash: with butt/square caps it paints
          // NOTHING, so dotted always resolves to round caps. Disabled and
          // explained rather than silently ignored.
          disabled={style === "dotted"}
          disabledHint="خط نقطه‌چین همیشه سرِ گرد دارد، چون نقطه با سرِ صاف رسم نمی‌شود."
        />
        <SegmentedControl
          label="گوشه (Join)"
          options={JOIN_ORDER}
          value={linejoin}
          labels={STROKE_LINE_JOIN_LABELS}
          onChange={(next) => apply({ strokeLinejoin: next })}
        />
      </div>

      {/* Stroke-only alpha (independent of the layer's own opacity). */}
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>شفافیت خط</span>
          <span className="tabular-nums text-slate-400">{opacity}٪</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          aria-label="شفافیت خط"
          onChange={(event) => live({ strokeOpacity: Number(event.target.value) / 100 })}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="w-full accent-cyan-400"
        />
      </label>
    </div>
  );
}

export default StrokeEditor;
