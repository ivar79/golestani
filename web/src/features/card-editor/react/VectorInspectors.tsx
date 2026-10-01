"use client";

/**
 * VectorInspectors — the shape and path inspector sections.
 *
 * Split out of the monolithic panels file so the vector tools own their own,
 * testable surface:
 *   - ShapeInspectorSection: shape preset grid (with LIVE thumbnails rendered by
 *     the real shape renderer), radius, polygon sides, fill, stroke.
 *   - PathInspectorSection: open/close, fill, stroke, and the Bezier POINT
 *     editor controls (smooth / corner / delete / add).
 *
 * Everything here writes through the engine only — no local copies of document
 * state — so the inspector can never disagree with the canvas.
 */

import type { ShapeKind, ShapeLayer, PathLayer, CardLayer } from "../domain/document";
import { SHAPE_KIND_LABELS } from "../domain/document";
import { EDITOR_PALETTE } from "../domain/palette";
import {
  POLYGON_DEFAULT_SIDES,
  POLYGON_MAX_SIDES,
  POLYGON_MIN_SIDES,
  SHAPE_KINDS,
  DEFAULT_SHAPE_STROKE_COLOR,
} from "../domain/shapes";
import type { EditorEngine } from "../engine/EditorEngine";
import { ColorPickerField } from "./ColorPickerField";
import { GradientField } from "./GradientField";
import { ShapeSvg } from "./LayeredCardRenderer";
import { StrokeEditor } from "./StrokeEditor";
import { useCardEditor } from "./useCardEditor";
import { LUXURY_MATERIALS } from "../domain/luxuryMaterials";
import { curveProfilePoints, type CurveProfile } from "../domain/curveLine";
import { useEntitlements, PremiumBadge } from "@/components/cards/FeatureGate";
import { Lock } from "lucide-react";
import Link from "next/link";

/** Luxury material picker component (Glass, Velvet, Gold Foil, Chrome Silver, Neon Glow). */
export function LuxuryMaterialPicker({
  engine,
  layer,
}: {
  engine: EditorEngine;
  layer: CardLayer;
}) {
  const entitlements = useEntitlements();
  const isPro = entitlements.plan !== "Free" && entitlements.plan !== "free";
  const currentEffect = layer.effect ?? "none";

  return (
    <div className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
          <span>متریال‌های لوکس</span>
          <PremiumBadge label="حرفه‌ای" />
        </span>
        {!isPro && (
          <Link
            href="/pricing"
            className="flex items-center gap-1 text-[9px] font-bold text-amber-400 hover:underline"
          >
            <Lock className="h-2.5 w-2.5" />
            ارتقا به پرو
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => engine.applyLuxuryMaterial(layer.id, "none")}
          className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition ${
            currentEffect === "none"
              ? "border-cyan-400 bg-cyan-500/20 text-white"
              : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
          }`}
        >
          <div className="h-4 w-4 rounded-full border border-white/20 bg-slate-700" />
          <span className="text-[9px] font-semibold">عادی</span>
        </button>

        {LUXURY_MATERIALS.map((mat) => {
          const active = currentEffect === mat.effect;
          return (
            <button
              key={mat.key}
              type="button"
              title={mat.description}
              onClick={() => {
                if (!isPro) {
                  return;
                }
                engine.applyLuxuryMaterial(layer.id, mat.key);
              }}
              className={`relative flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition ${
                active
                  ? "border-amber-400 bg-amber-500/20 text-amber-200 ring-1 ring-amber-400"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-amber-400/40 hover:text-white"
              } ${!isPro ? "opacity-65" : ""}`}
            >
              <div
                className="h-4 w-4 rounded-full border border-white/30 shadow-sm"
                style={{ background: mat.previewCss }}
              />
              <span className="text-[9px] font-bold truncate max-w-full">{mat.label}</span>
              {!isPro && (
                <span className="absolute -top-1 -right-1">
                  <Lock className="h-3 w-3 text-amber-300" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!isPro && (
        <p className="text-[9px] text-amber-300/80 leading-3">
          متریال‌های شیشه‌ای، مخملی، طلایی متالیک و نئون فقط در پلن اشتراک حرفه‌ای فعال هستند.
        </p>
      )}
    </div>
  );
}

/** A slider whose drag is a single undoable gesture (live → commit). */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onLive,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onLive: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300">
        <span>{label}</span>
        <span className="tabular-nums text-slate-400">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onLive(Number(event.target.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="w-full accent-cyan-400"
      />
    </label>
  );
}

/**
 * A shape preset button's icon — rendered by the REAL shape renderer, so the
 * grid can never advertise a shape the canvas draws differently.
 */
function ShapeThumb({ kind, radius, sides }: { kind: ShapeKind; radius: number; sides?: number }) {
  const layer: ShapeLayer = {
    id: `thumb-${kind}`,
    kind: "shape",
    x: 0,
    y: 0,
    width: 30,
    height: 22,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: "currentColor",
    shape: kind,
    radius: kind === "rect" ? Math.min(radius, 6) : 0,
    sides: kind === "polygon" ? sides ?? POLYGON_DEFAULT_SIDES : undefined,
    strokeWidth: kind === "line" ? 3 : 0,
  };
  return (
    <span className="block h-[22px] w-[30px]">
      <ShapeSvg layer={layer} />
    </span>
  );
}

export function ShapeInspectorSection({ engine, layer }: { engine: EditorEngine; layer: ShapeLayer }) {
  const isLine = layer.shape === "line";
  const fallbackStroke = isLine
    ? layer.background ?? layer.color ?? DEFAULT_SHAPE_STROKE_COLOR
    : DEFAULT_SHAPE_STROKE_COLOR;

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">شکل</span>
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPE_KINDS.map((kind) => {
            const active = layer.shape === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                title={SHAPE_KIND_LABELS[kind]}
                onClick={() => engine.updateLayer(layer.id, { shape: kind } as never)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition ${
                  active
                    ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                    : "border-white/10 bg-white/5 text-slate-400 hover:border-cyan-400/40 hover:text-slate-200"
                }`}
              >
                <ShapeThumb kind={kind} radius={layer.radius} sides={layer.sides} />
                <span className="text-[9px] font-semibold leading-none">{SHAPE_KIND_LABELS[kind]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {layer.shape === "rect" ? (
        <SliderRow
          label="گوشه گرد (Radius)"
          value={layer.radius}
          min={0}
          max={200}
          onLive={(value) => engine.transientPatch(layer.id, { radius: value } as never)}
          onCommit={() => engine.commitTransient()}
        />
      ) : null}

      {layer.shape === "polygon" ? (
        <SliderRow
          label="تعداد اضلاع"
          value={layer.sides ?? POLYGON_DEFAULT_SIDES}
          min={POLYGON_MIN_SIDES}
          max={POLYGON_MAX_SIDES}
          onLive={(value) => engine.transientPatch(layer.id, { sides: value } as never)}
          onCommit={() => engine.commitTransient()}
        />
      ) : null}

      {isLine ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-4 text-slate-400">
          خط فقط «خط دور» دارد: رنگ و ضخامت خط از بخش پایین تنظیم می‌شود (بدون رنگ پرکننده).
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">حالت شکل</span>
            <div className="flex rounded-lg bg-black/20 p-0.5">
              <button
                type="button"
                onClick={() => {
                  if (!layer.background) {
                    engine.updateLayer(layer.id, { background: "#0ea5e9" } as never);
                  }
                }}
                className={`rounded-md px-2 py-1 text-[10px] font-bold transition ${
                  layer.background
                    ? "bg-cyan-500/25 text-cyan-200"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                ⬛ تو پر
              </button>
              <button
                type="button"
                onClick={() => {
                  const updates: Partial<ShapeLayer> = { background: null };
                  if (!layer.strokeWidth || layer.strokeWidth <= 0) {
                    updates.strokeWidth = 3;
                    updates.stroke = layer.stroke || "#0ea5e9";
                  }
                  engine.updateLayer(layer.id, updates as never);
                }}
                className={`rounded-md px-2 py-1 text-[10px] font-bold transition ${
                  !layer.background
                    ? "bg-cyan-500/25 text-cyan-200"
                    : "text-slate-400 hover:text-white"
                }`}
                title="شکل تو خالی با خط دور دلخواه (مناسب دایره‌ها و کادرهای تو خالی)"
              >
                🔲 تو خالی
              </button>
            </div>
          </div>

          {layer.background ? (
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ پرکننده (Fill)</span>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {EDITOR_PALETTE.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    title={swatch}
                    onClick={() => engine.updateLayer(layer.id, { background: swatch } as never)}
                    className={`h-6 w-6 rounded-full border-2 ${
                      layer.background === swatch ? "border-cyan-400" : "border-white/20"
                    }`}
                    style={{ background: swatch }}
                  />
                ))}
              </div>
              <div className="mb-2">
                <span className="mb-1.5 block text-[10px] font-semibold text-slate-400">گرادیان (اختیاری)</span>
                <GradientField
                  value={layer.background}
                  onChange={(css) => engine.updateLayer(layer.id, { background: css } as never)}
                />
              </div>
              <ColorPickerField
                value={layer.background ?? layer.color}
                onChange={(color) => engine.transientPatch(layer.id, { background: color } as never)}
                onGestureEnd={() => engine.commitTransient()}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.04] p-2 text-[10px] text-cyan-300">
              شکل در حالت «تو خالی» قرار دارد. ضخامت و رنگ خط دور را در بخش زیر تنظیم کنید.
            </div>
          )}
        </div>
      )}

      <LuxuryMaterialPicker engine={engine} layer={layer} />

      <StrokeEditor
        engine={engine}
        layerId={layer.id}
        stroke={layer}
        fallbackColor={fallbackStroke}
        allowNoStroke={!isLine}
      />
    </div>
  );
}

export function PathInspectorSection({ engine, layer }: { engine: EditorEngine; layer: PathLayer }) {
  const state = useCardEditor(engine);
  const editing = state.editingPathId === layer.id;
  const selection = state.selectedAnchor?.layerId === layer.id ? state.selectedAnchor.index : null;
  // A closed path needs 3 anchors, an open one 2 — below that it is not a shape.
  const minimum = layer.closed ? 3 : 2;
  const canDelete = selection !== null && layer.points.length > minimum;
  const isTwoPointCurve = !layer.closed && layer.points.length === 2;

  return (
    <div className="space-y-3">
      {/* 1-Click Auto Smooth / Curvature Actions (Adobe Curvature Tool Standard) */}
      <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/[0.08] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-cyan-300">کنترل هوشمند انحنا (Curvature)</span>
          <span className="text-[10px] font-mono text-slate-400">{layer.points.length} نقطه</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => engine.autoSmoothLayer(layer.id)}
            className="flex items-center justify-center gap-1 rounded-lg border border-cyan-400 bg-cyan-500/25 py-2 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/40 transition shadow-sm"
            title="تبدیل خودکار تمام خطوط شکسته به یک موج پیوسته و منحنی روان"
          >
            <span>✨ تبدیل به منحنی روان</span>
          </button>
          <button
            type="button"
            onClick={() => engine.straightenLayer(layer.id)}
            className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-semibold text-slate-300 hover:text-white transition"
            title="تبدیل تمام نقاط به گوشه‌های تیز و خطوط مستقیم"
          >
            <span>📐 گوشه‌دار / صاف</span>
          </button>
        </div>
      </div>

      {layer.pathMode === "curve" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-white">پروفایل منحنی</span>
            <span className="text-[9px] text-slate-500">مسیر واقعی / قابل ویرایش</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ["arc", "قوس"],
              ["sine", "سینوسی متقارن"],
              ["sine-asymmetric", "سینوسی نامتقارن"],
              ["s", "موج S"],
            ] as const).map(([profile, label]) => {
              const active = (layer.curveProfile ?? (isTwoPointCurve ? "arc" : "sine")) === profile;
              return (
                <button
                  key={profile}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const nextProfile = profile as CurveProfile;
                    const nextPoints = curveProfilePoints(
                      Math.max(40, layer.width),
                      Math.max(40, layer.height),
                      nextProfile,
                      0.38,
                    );
                    engine.updateLayer(layer.id, {
                      curveProfile: nextProfile,
                      bend: nextProfile === "arc" ? layer.bend ?? 0.42 : undefined,
                      points: nextPoints,
                      rawD: undefined,
                    } as never);
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold transition ${
                    active
                      ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-200"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => engine.setPathEditing(layer.id)}
            className="w-full rounded-lg border border-cyan-300/20 bg-cyan-400/[0.04] py-1.5 text-[9px] font-bold text-cyan-200 hover:bg-cyan-400/10"
          >
            ویرایش نقاط و دستگیره‌ها
          </button>
        </div>
      )}

      {/* Arc Curvature Slider (Canva-like intuitive curve control).
          `bend` is the canonical model; the slider presents it as a ±100%
          percentage, matching the -100..100 `curvature` of older builds. */}
      {isTwoPointCurve && (
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/[0.05] p-3 space-y-2.5">
          <SliderRow
            label="انحنای کمان (قوس خط)"
            value={Math.round((layer.bend ?? 0) * 100)}
            min={-100}
            max={100}
            step={2}
            suffix="%"
            onLive={(value) => engine.setPathBend(layer.id, value / 100)}
            onCommit={() => engine.commitTransient()}
          />
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                engine.setPathBend(layer.id, -0.5);
                engine.commitTransient();
              }}
              className="rounded-lg border border-white/10 bg-white/5 py-1 text-[10px] font-semibold text-slate-300 hover:text-white"
            >
              کمان بالا ⌒
            </button>
            <button
              type="button"
              onClick={() => {
                engine.setPathBend(layer.id, 0);
                engine.commitTransient();
              }}
              className="rounded-lg border border-white/10 bg-white/5 py-1 text-[10px] font-semibold text-slate-300 hover:text-white"
            >
              مستقیم ━
            </button>
            <button
              type="button"
              onClick={() => {
                engine.setPathBend(layer.id, 0.5);
                engine.commitTransient();
              }}
              className="rounded-lg border border-white/10 bg-white/5 py-1 text-[10px] font-semibold text-slate-300 hover:text-white"
            >
              کمان پایین ‿
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={editing}
          onClick={() => engine.setPathEditing(editing ? null : layer.id)}
          className={`flex-1 rounded-lg border py-1.5 text-[11px] font-bold transition ${
            editing
              ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
              : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
          }`}
        >
          {editing ? "پایان ویرایش نقاط" : "ویرایش نقاط (Bezier)"}
        </button>
        <button
          type="button"
          aria-pressed={layer.closed}
          onClick={() => engine.setPathClosed(layer.id, !layer.closed)}
          className={`flex-1 rounded-lg border py-1.5 text-[11px] font-bold transition ${
            layer.closed
              ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
              : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
          }`}
        >
          {layer.closed ? "مسیر بسته" : "مسیر باز"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">نقاط منحنی</span>
            <span className="text-[10px] tabular-nums text-slate-400">
              {layer.points.length} نقطه{selection !== null ? ` — انتخاب: ${selection + 1}` : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={selection === null}
              onClick={() => selection !== null && engine.smoothAnchor(layer.id, selection)}
              className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white disabled:opacity-40"
            >
              نرم‌کردن نقطه
            </button>
            <button
              type="button"
              disabled={selection === null}
              onClick={() => selection !== null && engine.straightenAnchor(layer.id, selection)}
              className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white disabled:opacity-40"
            >
              گوشه‌کردن نقطه
            </button>
            <button
              type="button"
              disabled={!canDelete}
              onClick={() => selection !== null && engine.removeAnchorAt(layer.id, selection)}
              className="col-span-2 rounded-lg border border-rose-400/30 bg-rose-500/10 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
            >
              حذف نقطهٔ انتخاب‌شده
            </button>
          </div>
          <p className="text-[10px] leading-4 text-slate-400">
            روی نقطه بکشید تا جابه‌جا شود، دسته‌ها را بکشید تا انحنا تغییر کند، با نگه‌داشتن Alt تقارن دسته‌ها
            می‌شکند و دابل‌کلیک روی خط، نقطهٔ جدید اضافه می‌کند.
          </p>
        </div>
      ) : null}

      {/* Luxury materials */}
      <LuxuryMaterialPicker engine={engine} layer={layer} />

      {layer.closed ? (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ پرکردن</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {EDITOR_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                title={swatch}
                onClick={() => engine.updateLayer(layer.id, { fill: swatch } as never)}
                className={`h-6 w-6 rounded-full border-2 ${
                  layer.fill === swatch ? "border-cyan-400" : "border-white/20"
                }`}
                style={{ background: swatch }}
              />
            ))}
            <button
              type="button"
              title="بدون پرکردن"
              onClick={() => engine.updateLayer(layer.id, { fill: null } as never)}
              className={`h-6 rounded-full border px-2 text-[9px] font-bold ${
                layer.fill === null ? "border-cyan-400 text-cyan-200" : "border-white/20 text-slate-400"
              }`}
            >
              بدون
            </button>
          </div>
          <ColorPickerField
            value={layer.fill}
            onChange={(color) => engine.transientPatch(layer.id, { fill: color } as never)}
            onGestureEnd={() => engine.commitTransient()}
          />
        </div>
      ) : null}

      <StrokeEditor
        engine={engine}
        layerId={layer.id}
        stroke={layer}
        fallbackColor="#0ea5e9"
        allowNoStroke={false}
      />
    </div>
  );
}
