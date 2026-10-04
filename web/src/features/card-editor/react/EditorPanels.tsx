"use client";

/**
 * EditorPanels — Toolbox (add layers), Inspector (selected layer props) and
 * LayersPanel (order/lock/hide/delete) for the card editor.
 *
 * Controls only expose values that already exist in the project's design
 * system (Vazirmatn + system fonts, palette hexes from CardCanvas tokens).
 * Premium gating stays with the existing entitlement contract in card-maker.
 *
 * Image/Logo contract: the picked file is persisted through the card
 * endpoint's existing multipart media flow (`front_image` → public disk);
 * the layer stores the returned system /storage/… path so the document
 * round-trips the server-side whitelist (blob URLs never persist).
 * Color editing is kind-aware: text layers edit the text color,
 * badge/shape layers edit their background, QR layers edit the module
 * (dark) color — each maps to the field its renderer actually reads.
 */

import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  MousePointer2,
  Pencil,
  PenTool,
  Plus,
  QrCode,
  Sparkles,
  Square,
  Trash2,
  Type,
  Waves,
  Spline,
  Combine,
  SquareStack,
} from "lucide-react";
import type { CardDocument, CardLayer, BadgeLayer, LayerKind, QrLayer, ShapeKind } from "../domain/document";
import { LAYER_KIND_LABELS, SHAPE_KIND_LABELS } from "../domain/document";
import { EDITOR_PALETTE } from "../domain/palette";
import type { CurveKind } from "../domain/curveGeometry";
import {
  STROKE_LINE_CAP_LABELS,
  STROKE_LINE_JOIN_LABELS,
  STROKE_STYLE_LABELS,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
} from "../domain/stroke";

/** Structural access to badge-only fields (used for the style editor). */
type BadgeLayerLike = Pick<BadgeLayer, "style">;
import type { EditorEngine, NumericField } from "../engine/EditorEngine";
import { BOOLEAN_OP_LABELS, type BooleanOp } from "../domain/geometry/booleanOps";
import { useCardEditor } from "./useCardEditor";
import { ColorPickerField } from "./ColorPickerField";
import { GradientField } from "./GradientField";
import { SegmentedControl } from "./StrokeEditor";
import { PathInspectorSection, ShapeInspectorSection } from "./VectorInspectors";
import {
  useEntitlements,
  PremiumBadge,
} from "@/components/cards/FeatureGate";
import {
  layerKindAllowed,
  layerLimitState,
} from "@/lib/entitlements";

/**
 * One inspector field that accepts Figma-style expressions: `+10`, `*2`,
 * `50%`, `1/3`. All parsing and clamping live in the ENGINE
 * (`setNumericField`) — this component stays a thin, controlled-free input:
 * it keeps only what is being typed and lets the document be the truth.
 */
function NumericFieldInput({
  engine,
  layerId,
  field,
  label,
  value,
}: {
  engine: EditorEngine;
  layerId: string;
  field: NumericField;
  label: string;
  value: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-slate-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        dir="ltr"
        value={text ?? String(Math.round(value * 10) / 10)}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== "Tab") return;
          const raw = text;
          if (raw === null) return; // untouched — nothing to commit
          const ok = engine.setNumericField(layerId, field, raw);
          setInvalid(!ok);
          if (ok) setText(null);
          e.preventDefault();
        }}
        onBlur={() => {
          const raw = text;
          if (raw === null) return;
          if (engine.setNumericField(layerId, field, raw)) {
            setText(null);
            setInvalid(false);
          }
          // An invalid entry keeps the text on screen (red) so the user can fix
          // it instead of silently snapping back.
        }}
        title="عدد، یا عبارت: ‎+10‎ ، ‎*2‎ ، ‎50%‎ ، ‎1/3‎"
        className={`w-full rounded-lg border bg-white/5 p-1.5 text-xs text-white tabular-nums outline-none focus:border-cyan-400 ${
          invalid ? "border-rose-500 text-rose-300" : "border-white/15"
        }`}
      />
    </label>
  );
}

/**
 * The four Figma boolean operations, enabled when ≥2 path layers are selected.
 * The result replaces the operands and inherits the BOTTOM layer's look —
 * exactly the Illustrator/Figma convention.
 */
function BooleanToolbar({ engine, selectedCount }: { engine: EditorEngine; selectedCount: number }) {
  const enabled = selectedCount >= 2;
  const ops: { op: BooleanOp; icon: typeof Combine; hint: string }[] = [
    { op: "union", icon: Combine, hint: "ترکیب همه در یک شکل" },
    { op: "subtract", icon: SquareStack, hint: "کم کردن بالایی‌ها از پایینی" },
    { op: "intersect", icon: Combine, hint: "فقط هم‌پوشانی" },
    { op: "exclude", icon: SquareStack, hint: "هم‌پوشانی حذف می‌شود" },
  ];
  return (
    <div
      className="rounded-xl border p-3 space-y-2"
      style={{ borderColor: enabled ? "rgba(52,211,153,0.35)" : "rgba(255,255,255,0.08)", background: enabled ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold" style={{ color: enabled ? "#6ee7b7" : "#64748b" }}>
          عملیات ترکیب شکل (Boolean)
        </span>
        <span className="text-[9px] text-slate-500">{enabled ? "۴ عملیات" : "≥۲ مسیر لازم است"}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {ops.map(({ op, icon: Icon, hint }) => (
          <button
            key={op}
            type="button"
            disabled={!enabled}
            title={`${BOOLEAN_OP_LABELS[op]} — ${hint}`}
            onClick={() => engine.booleanSelection(op)}
            className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[10px] font-semibold transition ${
              enabled
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/25"
                : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-600"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {BOOLEAN_OP_LABELS[op]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Toolbox entries: a layer kind, or one of the two DRAWING tools or direct curved line. */
type ToolboxEntry = LayerKind | "pointer" | "pen" | "curved_line";

const TOOLBOX: { kind: ToolboxEntry; icon: typeof Type; label: string }[] = [
  { kind: "pointer", icon: MousePointer2, label: "انتخاب و جابه‌جایی" },
  { kind: "text", icon: Type, label: "افزودن متن" },
  { kind: "shape", icon: Square, label: "افزودن شکل" },
  { kind: "curved_line", icon: Waves, label: "خط منحنی آماده" },
  { kind: "pen", icon: PenTool, label: "رسم مسیر گره‌دار" },
  { kind: "path", icon: Pencil, label: "قلم آزاد" },
  { kind: "image", icon: ImagePlus, label: "افزودن تصویر" },
  { kind: "qr", icon: QrCode, label: "افزودن کد QR" },
  { kind: "badge", icon: BadgeCheck, label: "افزودن نشان" },
];

const SHAPE_PRESETS: {
  kind: ShapeKind;
  label: string;
  icon: React.ReactNode;
  radius?: number;
  partial?: Partial<CardLayer>;
}[] = [
  {
    kind: "ellipse",
    label: "دایره توپر",
    icon: <div className="h-5 w-5 bg-cyan-400 rounded-full" />,
  },
  {
    kind: "ellipse",
    label: "دایره توخالی",
    icon: <div className="h-5 w-5 border-2 border-cyan-400 rounded-full" />,
    partial: { background: null, stroke: "#0ea5e9", strokeWidth: 3 },
  },
  {
    kind: "rect",
    label: "مستطیل توپر",
    icon: <div className="h-4 w-6 bg-cyan-400 rounded-sm" />,
  },
  {
    kind: "rect",
    label: "کادر توخالی",
    icon: <div className="h-4 w-6 border-2 border-cyan-400 rounded-sm" />,
    partial: { background: null, stroke: "#0ea5e9", strokeWidth: 3 },
  },
  {
    kind: "rect",
    label: "مستطیل گرد",
    radius: 16,
    icon: <div className="h-4 w-6 border-2 border-current rounded-lg" />,
  },
  {
    kind: "triangle",
    label: "مثلث",
    icon: (
      <svg className="h-5 w-5 stroke-current stroke-2 fill-none" viewBox="0 0 24 24">
        <polygon points="12,3 22,21 2,21" />
      </svg>
    ),
  },
  {
    kind: "star",
    label: "ستاره",
    icon: (
      <svg className="h-5 w-5 stroke-current stroke-2 fill-none" viewBox="0 0 24 24">
        <polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" />
      </svg>
    ),
  },
  {
    kind: "polygon",
    label: "شش‌ضلعی",
    icon: (
      <svg className="h-5 w-5 stroke-current stroke-2 fill-none" viewBox="0 0 24 24">
        <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
      </svg>
    ),
  },
  {
    kind: "line",
    label: "خط ساده",
    icon: <div className="h-0.5 w-6 bg-current" />,
  },
  {
    kind: "arrow",
    label: "فلش",
    icon: (
      <svg className="h-5 w-5 stroke-current stroke-2 fill-none" viewBox="0 0 24 24">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12,5 19,12 12,19" />
      </svg>
    ),
  },
];

/**
 * Font picker — only families the project already ships (Vazirmatn web font +
 * generic system stacks). Mixed Persian/English renders natively via these.
 */
const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "vazir", label: "وزیر (پیش‌فرض)" },
  { value: "sans", label: "بدون سریف سیستم" },
  { value: "serif", label: "سریف کلاسیک" },
  { value: "monospace", label: "تک‌پهنا (Monospace)" },
];

export function Toolbox({
  engine,
  onUploadImage,
  qrPayload,
}: {
  engine: EditorEngine;
  onUploadImage?: (file: File) => Promise<string>;
  /** Canonical QR payload (the edited business's slug) seeded into new QR layers. */
  qrPayload?: string;
}) {
  const state = useCardEditor(engine);
  const entitlements = useEntitlements();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [showCurvePicker, setShowCurvePicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Capability mirrors (UX only — the server re-checks every save).
  const layerLimit = layerLimitState(entitlements.capabilities, state.doc.layers.length);
  const addBlocked = layerLimit.state === "reached";

  function activate(kind: ToolboxEntry) {
    if (kind === "pointer") {
      engine.setTool("select");
      setShowShapePicker(false);
      return;
    }
    if (kind === "shape") {
      if (addBlocked || !layerKindAllowed(entitlements.capabilities, "shape")) return;
      setShowCurvePicker(false);
      setShowShapePicker((v) => !v);
      return;
    }
    setShowShapePicker(false);
    if (kind === "curved_line") {
      if (addBlocked || !layerKindAllowed(entitlements.capabilities, "path")) return;
      setShowShapePicker(false);
      setShowCurvePicker((v) => !v);
      return;
    }
    // Both DRAWING tools create a `path` layer, so both answer to the same
    // `path` capability and to the layer cap (which the draw tool used to slip
    // past, producing a document the server then rejected at save time).
    if (kind === "path" || kind === "pen") {
      if (addBlocked || !layerKindAllowed(entitlements.capabilities, "path")) return;
      engine.setTool(kind === "pen" ? "pen" : "draw");
      return;
    }

    if (addBlocked || !layerKindAllowed(entitlements.capabilities, kind as LayerKind)) return;
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    engine.setTool("select");
    // The QR tool must produce a REAL code: a fresh layer is seeded with the
    // edited business's slug (the only payload our own QR endpoint can render).
    // An empty payload used to leave the layer at its placeholder forever.
    if (kind === "qr") {
      engine.addLayer("qr", qrPayload ? { payload: qrPayload } : undefined);
      return;
    }
    engine.addLayer(kind as LayerKind);
  }

  async function onImagePicked(file: File | null) {
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!file || !onUploadImage) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setUploadError("فقط JPEG، PNG یا WebP مجاز است.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const src = await onUploadImage(file);
      engine.setTool("select");
      engine.addLayer("image", { src, radius: 12, objectFit: "cover" });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "آپلود تصویر ناموفق بود.");
    } finally {
      setUploading(false);
    }
  }

  const primaryTools: ToolboxEntry[] = ["pointer", "text", "shape", "curved_line", "pen", "path"];
  const addTools: ToolboxEntry[] = ["image", "qr", "badge"];

  const renderToolButton = (kind: ToolboxEntry) => {
    const item = TOOLBOX.find((entry) => entry.kind === kind)!;
    const Icon = item.icon;
    const isPointer = kind === "pointer";
    const isDrawingTool = kind === "path" || kind === "pen" || kind === "curved_line";
    const kindAllowed = isPointer
      ? true
      : isDrawingTool
        ? layerKindAllowed(entitlements.capabilities, "path")
        : layerKindAllowed(entitlements.capabilities, kind);
    const addsLayer = !isPointer;
    const disabled =
      !kindAllowed ||
      (addsLayer && addBlocked) ||
      (kind === "image" && (uploading || !onUploadImage));
    const isSelected =
      (kind === "pointer" && state.tool === "select") ||
      (kind === "path" && state.tool === "draw") ||
      (kind === "pen" && state.tool === "pen") ||
      (kind === "shape" && showShapePicker) ||
      (kind === "curved_line" && showCurvePicker);
    return (
      <button
        key={kind}
        type="button"
        onClick={() => activate(kind)}
        disabled={disabled}
        title={item.label}
        aria-pressed={isSelected}
        className={`group flex w-[124px] shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-right transition md:w-full ${
          isSelected
            ? "border-cyan-300/50 bg-cyan-400/10 text-white"
            : "border-transparent bg-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06] hover:text-white"
        } disabled:opacity-35`}
      >
        {kind === "image" && uploading ? (
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
        ) : (
          <Icon className={`h-4 w-4 shrink-0 ${isSelected ? "text-cyan-200" : "text-slate-300 group-hover:text-white"}`} />
        )}
        <span className="min-w-0 text-[11px] font-semibold leading-4">
          {item.label}
        </span>
        {!kindAllowed && <span className="absolute -left-1 -top-1"><PremiumBadge label="" /></span>}
      </button>
    );
  };

  return (
    <div
      className="relative z-[5000] flex w-full shrink-0 flex-row items-stretch gap-1 overflow-x-auto overflow-y-hidden rounded-[18px] border border-white/[0.09] bg-[#0d131c] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)] md:h-full md:w-auto md:flex-col md:overflow-x-hidden md:overflow-y-auto"
      role="toolbar"
      aria-label="ابزارهای استودیو"
    >
      <h3 className="hidden px-1 pb-1 text-right text-[11px] font-bold tracking-tight text-slate-300 md:block">ابزار کار</h3>

      {primaryTools.map((kind) => renderToolButton(kind))}

      <div className="mx-1 w-px shrink-0 bg-white/10 md:mx-0 md:my-1 md:h-px md:w-full" />
      <h3 className="hidden px-1 pb-1 text-right text-[11px] font-bold tracking-tight text-slate-300 md:block">افزودن محتوا</h3>
      {addTools.map((kind) => renderToolButton(kind))}

      {showShapePicker && (
        <div className="absolute left-0 top-full z-[10000] mt-2 w-[290px] rounded-2xl border border-white/10 bg-[#0b121e]/96 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:left-auto md:right-full md:top-0 md:mt-0 md:mr-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-white">اشکال</span>
            <button type="button" onClick={() => setShowShapePicker(false)} className="text-[10px] text-slate-500 hover:text-white">بستن</button>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {SHAPE_PRESETS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  engine.setTool("select");
                  engine.addShape(item.kind, {
                    ...(item.radius !== undefined ? { radius: item.radius } : {}),
                    ...(item.partial ?? {}),
                  });
                  setShowShapePicker(false);
                }}
                title={item.label}
                className="group flex h-12 flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-white"
              >
                <span className="group-hover:scale-110 transition-transform">{item.icon}</span>
                <span className="max-w-full truncate text-[8px]">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCurvePicker && (
        <div className="absolute left-0 top-full z-[10000] mt-2 w-[300px] rounded-2xl border border-white/10 bg-[#0b121e]/96 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:left-auto md:right-full md:top-[94px] md:mt-0 md:mr-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-white">
              <Spline className="h-3.5 w-3.5 text-cyan-300" />
              خط منحنی
            </span>
            <button type="button" onClick={() => setShowCurvePicker(false)} className="text-[10px] text-slate-500 hover:text-white">بستن</button>
          </div>
          <p className="mb-2 text-[9px] leading-4 text-slate-500">قوس، سینوسی متقارن و موج نامتقارن را به‌صورت مسیر واقعی و قابل ویرایش بساز.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ["arc", "قوس", "⌒"],
              ["sine", "سینوسی متقارن", "〰"],
              ["sine-asymmetric", "سینوسی نامتقارن", "∿"],
              ["s", "موج S", "S"],
            ] as const).map(([profile, label, glyph]) => (
              <button
                key={profile}
                type="button"
                onClick={() => {
                  if (addBlocked || !layerKindAllowed(entitlements.capabilities, "path")) return;
                  engine.setTool("select");
                  engine.addCurve(profile as CurveKind);
                  setShowCurvePicker(false);
                }}
                className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2 text-right hover:border-cyan-300/40 hover:bg-cyan-400/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-lg text-cyan-200 group-hover:text-white">{glyph}</span>
                <span className="text-[10px] font-semibold text-slate-300 group-hover:text-white">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {addBlocked ? (
        <span className="mt-1 text-center text-[8px] leading-3 text-amber-300">سقف لایه پر است</span>
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void onImagePicked(e.target.files?.[0] ?? null)}
      />
      {uploadError ? <p className="max-w-[110px] text-center text-[9px] font-semibold text-rose-300">{uploadError}</p> : null}
    </div>
  );
}

/**
 * BackgroundPanel — document background: solid color or CSS gradient.
 * The document model owns the value; this panel only projects + emits it.
 * Sliders emit TRANSIENT changes (one drag = live preview, zero history) and
 * commit exactly once when the gesture ends, so dragging a gradient never
 * floods undo with intermediate states.
 */
export function BackgroundPanel({ engine }: { engine: EditorEngine }) {
  const state = useCardEditor(engine);
  const entitlements = useEntitlements();
  const isPro = entitlements.plan !== "Free" && entitlements.plan !== "free";
  const bg = state.doc.background;

  const BG_LUXURY_PRESETS = [
    { label: "مخملی رویال", value: "linear-gradient(135deg, #090d16 0%, #111827 50%, #060910 100%)", preview: "#090d16" },
    { label: "طلایی متالیک", value: "linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)", preview: "#BF953F" },
    { label: "نقره‌ای کروم", value: "linear-gradient(135deg, #8a8a8a 0%, #e0e0e0 25%, #ffffff 50%, #cccccc 75%, #757575 100%)", preview: "#e0e0e0" },
    { label: "زرشکی مات", value: "linear-gradient(135deg, #2b0914 0%, #4a0e23 50%, #1a050c 100%)", preview: "#2b0914" },
    { label: "سرمه‌ای نئون", value: "linear-gradient(135deg, #0b1c33 0%, #082444 60%, #0284c7 100%)", preview: "#0b1c33" },
    { label: "شیشه‌ای تیره", value: "linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%)", preview: "#1e293b" },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4 space-y-3">
      <h3 className="text-sm font-bold text-white">پس‌زمینه کارت</h3>
      <div className="h-12 w-full rounded-lg border border-white/10" style={{ background: bg }} />

      {/* Luxury Background Presets */}
      <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-300">
            <Sparkles className="h-3 w-3" />
            <span>متریال‌های پس‌زمینه لوکس</span>
            <PremiumBadge label="حرفه‌ای" />
          </span>
          {!isPro && (
            <span className="text-[9px] font-bold text-amber-400/90 flex items-center gap-0.5">
              <Lock className="h-2.5 w-2.5" />
              پلن پرو
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {BG_LUXURY_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                if (!isPro) return;
                engine.setBackground(preset.value);
              }}
              className={`relative flex items-center gap-1.5 rounded-lg border p-1.5 text-[10px] font-semibold transition ${
                bg === preset.value
                  ? "border-amber-400 bg-amber-500/20 text-amber-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-amber-400/40 hover:text-white"
              } ${!isPro ? "opacity-60" : ""}`}
            >
              <div
                className="h-3.5 w-3.5 rounded-full border border-white/30 shrink-0"
                style={{ background: preset.value }}
              />
              <span className="truncate">{preset.label}</span>
              {!isPro && (
                <span className="absolute -top-1 -right-1">
                  <Lock className="h-2.5 w-2.5 text-amber-300" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <GradientField
        value={bg}
        onChange={(css) => engine.transientBackground(css)}
        onGestureEnd={() => engine.commitBackground()}
      />
    </div>
  );
}

/**
 * DrawingPanel — settings for BOTH drawing tools.
 *
 * The freehand brush and the Bezier pen share one block because they create the
 * same kind of layer (`path`); the pen additionally shows its click/drag/close
 * contract. Width, style, cap, join and opacity all reach the committed stroke,
 * so nothing offered here is decorative.
 */
export function DrawingPanel({ engine }: { engine: EditorEngine }) {
  const state = useCardEditor(engine);
  const pen = state.tool === "pen";
  if (state.tool !== "draw" && !pen) return null;

  const splitHint =
    state.brushStyle === "dotted" ? "خط نقطه‌چین همیشه سرِ گرد دارد." : undefined;

  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-[#0c1626]/80 p-4">
      <h3 className="mb-3 text-sm font-bold text-cyan-200">{pen ? "قلم منحنی (Pen)" : "قلم آزاد"}</h3>

      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>ضخامت خط</span>
          <span className="tabular-nums text-slate-400">{state.brushWidth}px</span>
        </span>
        <input
          type="range"
          min={STROKE_WIDTH_MIN}
          max={STROKE_WIDTH_MAX}
          value={state.brushWidth}
          aria-label="ضخامت خط"
          onChange={(e) => engine.setBrushWidth(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
      </label>

      <div className="mt-3">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ خط</span>
        <div className="flex flex-wrap gap-1.5">
          {EDITOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => engine.setBrushColor(color)}
              className={`h-6 w-6 rounded-full border-2 ${state.brushColor === color ? "border-cyan-400" : "border-white/20"}`}
              style={{ background: color }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3">
        <SegmentedControl
          label="استایل خط"
          options={["solid", "dashed", "dotted"] as const}
          value={state.brushStyle}
          labels={STROKE_STYLE_LABELS}
          onChange={(style) => engine.setBrushStroke({ style })}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SegmentedControl
          label="سر خط"
          options={["butt", "round", "square"] as const}
          value={state.brushStyle === "dotted" ? "round" : state.brushLinecap}
          labels={STROKE_LINE_CAP_LABELS}
          onChange={(linecap) => engine.setBrushStroke({ linecap })}
          disabled={state.brushStyle === "dotted"}
          disabledHint={splitHint}
        />
        <SegmentedControl
          label="گوشه"
          options={["miter", "round", "bevel"] as const}
          value={state.brushLinejoin}
          labels={STROKE_LINE_JOIN_LABELS}
          onChange={(linejoin) => engine.setBrushStroke({ linejoin })}
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>شفافیت خط</span>
          <span className="tabular-nums text-slate-400">{Math.round(state.brushOpacity * 100)}٪</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(state.brushOpacity * 100)}
          aria-label="شفافیت خط"
          onChange={(e) => engine.setBrushStroke({ opacity: Number(e.target.value) / 100 })}
          className="w-full accent-cyan-400"
        />
      </label>

      {!pen && (
        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <div className="text-[10px] font-bold text-cyan-200">دقت قلم آزاد</div>
          <label className="block">
            <span className="mb-1 flex justify-between text-[10px] text-slate-400"><span>صاف‌سازی</span><span>{Math.round(state.freehandTuning.smoothing * 100)}%</span></span>
            <input type="range" min={0} max={100} value={Math.round(state.freehandTuning.smoothing * 100)} onChange={(e) => engine.setFreehandTuning({ smoothing: Number(e.target.value) / 100 })} className="w-full accent-cyan-400" />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between text-[10px] text-slate-400"><span>حفظ جزئیات / Fidelity</span><span>{Math.round(state.freehandTuning.fidelity * 100)}%</span></span>
            <input type="range" min={0} max={100} value={Math.round(state.freehandTuning.fidelity * 100)} onChange={(e) => engine.setFreehandTuning({ fidelity: Number(e.target.value) / 100 })} className="w-full accent-cyan-400" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-500">گام زاویه</span>
              <input type="number" min={0.1} max={180} step={0.1} value={state.freehandTuning.angleIncrements[0] ?? 45} onChange={(e) => engine.setFreehandAngleSnapping([Number(e.target.value) || 45])} dir="ltr" className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white outline-none focus:border-cyan-400" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-500">تلورانس زاویه</span>
              <input type="number" min={0.5} max={45} step={0.1} value={state.freehandTuning.angleTolerance} onChange={(e) => engine.setFreehandTuning({ angleTolerance: Number(e.target.value) || 5 })} dir="ltr" className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white outline-none focus:border-cyan-400" />
            </label>
          </div>
          <button type="button" onClick={() => engine.setFreehandTuning({ axisLock: !state.freehandTuning.axisLock })} className={`w-full rounded-lg border py-1.5 text-[10px] font-bold ${state.freehandTuning.axisLock ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"}`}>
            {state.freehandTuning.axisLock ? "قفل محور افقی/عمودی: فعال" : "قفل محور افقی/عمودی: خاموش"}
          </button>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-4 text-slate-500">
        {pen
          ? "کلیک = نقطه، کلیک و کشیدن = نقطهٔ نرم با دو دسته، کلیک روی نقطهٔ اول = بستن مسیر، Esc = پایان مسیر باز."
          : "روی بوم بکشید؛ خروجی با Pipeline واقعی به Bezier قابل ویرایش تبدیل می‌شود. Enter یا دابل‌کلیک برای ویرایش Nodeها."}
      </p>
    </div>
  );
}

export function InspectorPanel({
  engine,
  onUploadImage,
  businessSlug,
}: {
  engine: EditorEngine;
  onUploadImage?: (file: File) => Promise<string>;
  /** The edited business's slug — the QR tool's canonical payload. */
  businessSlug?: string;
}) {
  const state = useCardEditor(engine);
  const selected = state.doc.layers.find((l) => l.id === state.selection.layerId) ?? null;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const entitlements = useEntitlements();

  // TYPOGRAPHY CAPABILITY: the document's font families are the SAME entitlement
  // as the template font (card_fonts), enforced server-side on every save. The
  // picker therefore only offers entitled families — and keeps a grandfathered
  // one visible, so the UI can never show a family the card is not using.
  const fontOptions = (() => {
    const raw = entitlements.capabilities["card_fonts"];
    if (!Array.isArray(raw)) return FONT_OPTIONS; // capability absent → unrestricted
    const allowed = raw.map(String);
    const filtered = FONT_OPTIONS.filter((option) => allowed.includes(option.value));
    const current = selected?.kind === "text" ? selected.fontFamily : undefined;
    if (current && !allowed.includes(current)) {
      const shipped = FONT_OPTIONS.find((option) => option.value === current);
      if (shipped) return [...filtered, shipped];
    }
    return filtered;
  })();

  async function onImageFilePicked(file: File | null) {
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!file || !onUploadImage || !selected || selected.kind !== "image") return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setImageError("فقط JPEG، PNG یا WebP مجاز است.");
      return;
    }
    setImageError(null);
    setReplacing(true);
    try {
      const src = await onUploadImage(file);
      engine.updateLayer(selected.id, { src } as never);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "آپلود تصویر ناموفق بود.");
    } finally {
      setReplacing(false);
    }
  }

  if (!selected) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4 text-xs text-slate-400">
        برای ویرایش، یک لایه را روی بوم یا از فهرست انتخاب کنید.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            ویژگی‌های لایه — {LAYER_KIND_LABELS[selected.kind]}
          </h3>
          <span className="text-[10px] text-slate-400">شناسه: {selected.name || selected.kind}</span>
        </div>

        {/* Action buttons: Delete / Duplicate / Lock */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => engine.duplicateLayer(selected.id)}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="کپی / همانندسازی لایه (Ctrl+D)"
          >
            <Copy className="h-3 w-3" />
            <span>کپی</span>
          </button>

          <button
            type="button"
            onClick={() => engine.toggleLocked(selected.id)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              selected.locked
                ? "border-amber-400/40 bg-amber-500/20 text-amber-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
            }`}
            title={selected.locked ? "باز کردن قفل" : "قفل کردن لایه"}
          >
            {selected.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
          </button>

          <button
            type="button"
            onClick={() => engine.deleteLayer(selected.id)}
            className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 shadow-sm transition hover:border-rose-500/60 hover:bg-rose-500/30 hover:text-rose-100"
            title="حذف این لایه (کلید Delete یا Backspace)"
          >
            <Trash2 className="h-3 w-3" />
            <span>حذف لایه</span>
          </button>
        </div>
      </div>

      {selected.kind === "text" && (
        <>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">متن</span>
            <textarea
              dir="rtl"
              value={selected.text}
              onChange={(e) => engine.updateLayer(selected.id, { text: e.target.value } as never)}
              rows={2}
              className="w-full rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">فونت</span>
            <select
              value={selected.fontFamily}
              onChange={(e) => engine.updateLayer(selected.id, { fontFamily: e.target.value } as never)}
              className="w-full rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
            >
              {fontOptions.map((font) => (
                <option key={font.value} value={font.value} className="bg-[#0c1626]">
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-300">اندازه: {selected.fontSize}</span>
              <input
                type="range"
                min={12}
                max={96}
                value={selected.fontSize}
                onChange={(e) => engine.updateLayer(selected.id, { fontSize: Number(e.target.value) } as never)}
                className="w-full accent-cyan-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-300">ضخامت: {selected.fontWeight}</span>
              <select
                value={selected.fontWeight}
                onChange={(e) => engine.updateLayer(selected.id, { fontWeight: Number(e.target.value) } as never)}
                className="w-full rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
              >
                <option value={400} className="bg-[#0c1626]">معمولی</option>
                <option value={600} className="bg-[#0c1626]">نیمه‌ضخیم</option>
                <option value={800} className="bg-[#0c1626]">ضخیم</option>
              </select>
            </label>
          </div>
          {/* Decorations: italic / underline / strikethrough */}
          <div className="flex gap-2">
            {(
              [
                { key: "italic", label: "کج" },
                { key: "underline", label: "زیرخط" },
                { key: "strikethrough", label: "خط‌خورده" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => engine.updateLayer(selected.id, { [key]: !selected[key] } as never)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                  selected[key] ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-300">فاصله خطوط: {selected.lineHeight ?? 1.25}</span>
              <input
                type="range"
                min={0.8}
                max={2.4}
                step={0.05}
                value={selected.lineHeight ?? 1.25}
                onChange={(e) => engine.updateLayer(selected.id, { lineHeight: Number(e.target.value) } as never)}
                className="w-full accent-cyan-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-300">فاصله حروف: {selected.letterSpacing ?? 0}</span>
              <input
                type="range"
                min={-2}
                max={12}
                step={0.5}
                value={selected.letterSpacing ?? 0}
                onChange={(e) => engine.updateLayer(selected.id, { letterSpacing: Number(e.target.value) } as never)}
                className="w-full accent-cyan-400"
              />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">تراز</span>
            <div className="flex gap-2">
              {(["start", "center", "end"] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => engine.updateLayer(selected.id, { align } as never)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                    selected.align === align ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"
                  }`}
                >
                  {align === "start" ? "راست" : align === "center" ? "وسط" : "چپ"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {selected.kind === "image" && (
        <div>
          <span className="mb-1 block text-[11px] font-semibold text-slate-300">فایل تصویر</span>
          <p className="mb-2 truncate rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-slate-400" title={selected.src}>
            {selected.src || "—"}
          </p>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={replacing}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-slate-300 hover:text-white disabled:opacity-40"
          >
            {replacing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            تعویض فایل تصویر
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void onImageFilePicked(e.target.files?.[0] ?? null)}
          />
          {imageError && <p className="mt-2 text-[10px] font-semibold text-rose-300">{imageError}</p>}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">گوشه گرد</span>
            <input
              type="range"
              min={0}
              max={100}
              value={selected.radius}
              onChange={(e) => engine.updateLayer(selected.id, { radius: Number(e.target.value) } as never)}
              className="w-full accent-cyan-400"
            />
          </label>
          <select
            value={selected.objectFit}
            onChange={(e) => engine.updateLayer(selected.id, { objectFit: e.target.value } as never)}
            className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
          >
            <option value="cover" className="bg-[#0c1626]">پرکردن کادر (cover)</option>
            <option value="contain" className="bg-[#0c1626]">جا شدن کامل (contain)</option>
          </select>
        </div>
      )}

      {selected.kind === "qr" && (
        <div className="space-y-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.05] p-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-200">مقصد کد QR (نامک کسب‌وکار)</span>
            <input
              dir="ltr"
              value={(selected as QrLayer).payload}
              placeholder={businessSlug ?? "my-business"}
              onChange={(e) => {
                // A QR payload IS a business slug: the code is rendered by our
                // own endpoint, so anything else could never resolve. Invalid
                // characters are dropped as the user types instead of being
                // saved and silently failing later.
                const next = e.target.value.replace(/[^A-Za-z0-9_-]/g, "");
                engine.updateLayer(selected.id, { payload: next } as never);
              }}
              className="w-full rounded-lg border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </label>
          <p className="text-[10px] leading-4 text-slate-400">
            کد QR از نشانی رسمی همان کسب‌وکار ساخته می‌شود (صفحهٔ <span dir="ltr">/b/{businessSlug ?? "…"}</span>) و روی بوم، پیش‌نمایش و خروجی یکسان است.
          </p>
          {!(selected as QrLayer).payload ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-2 py-1.5 text-[10px] leading-4 text-amber-200">
              تا وقتی نامک مقصد خالی باشد، این لایه فقط جای‌گیر است و کدی تولید نمی‌شود.
            </p>
          ) : null}
          {businessSlug && (selected as QrLayer).payload !== businessSlug ? (
            <button
              type="button"
              onClick={() => engine.updateLayer(selected.id, { payload: businessSlug } as never)}
              className="w-full rounded-lg border border-cyan-400/40 bg-cyan-500/15 py-1.5 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/25"
            >
              بازگشت به صفحهٔ همین کسب‌وکار
            </button>
          ) : null}
        </div>
      )}

      {selected.kind === "path" && <PathInspectorSection engine={engine} layer={selected} />}

      {selected.kind === "badge" && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">متن نشان</span>
            <input
              dir="rtl"
              value={selected.text}
              onChange={(e) => engine.updateLayer(selected.id, { text: e.target.value } as never)}
              className="w-full rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-300">نوع نشان</span>
            <div className="flex gap-2">
              {(["verified", "promoted"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => engine.updateLayer(selected.id, { style } as never)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                    (selected as BadgeLayerLike).style === style ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"
                  }`}
                >
                  {style === "verified" ? "✓ تأییدشده" : "★ ویژه"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selected.kind === "shape" && <ShapeInspectorSection engine={engine} layer={selected} />}

      {/* BOOLEAN — the four Figma operations (needs ≥2 selected paths). */}
      <BooleanToolbar engine={engine} selectedCount={state.selection.ids.length} />

      {/* TRANSFORM — exact numeric position/size/rotation, with Figma-style
          expressions: `+10`, `*2`, `50%`, `1/3` (Enter or blur commits). */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">موقعیت و اندازه</span>
        <div className="grid grid-cols-2 gap-2">
          <NumericFieldInput engine={engine} layerId={selected.id} field="x" label="X (افقی)" value={selected.x} />
          <NumericFieldInput engine={engine} layerId={selected.id} field="y" label="Y (عمودی)" value={selected.y} />
          <NumericFieldInput engine={engine} layerId={selected.id} field="width" label="عرض" value={selected.width} />
          <NumericFieldInput engine={engine} layerId={selected.id} field="height" label="ارتفاع" value={selected.height} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* FRACTIONAL ROTATION: the exact field accepts decimals and
              expressions (`17.3`, `+2.5`, `*2`), while the slider below stays
              at 1° steps and is therefore NOT rounded onto the field — the two
              are independent inputs, so a 0.1° rotation survives a slider touch
              only when the slider is actually dragged. */}
          <NumericFieldInput engine={engine} layerId={selected.id} field="angle" label="چرخش (درجه)" value={selected.angle ?? 0} />
          <div className="flex items-end pb-1">
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round(selected.angle ?? 0)}
              onChange={(e) => engine.setLayerBox(selected.id, { angle: Number(e.target.value) } as never)}
              className="w-full accent-cyan-400"
              title="چرخش سریع (۱ درجه‌ای) — برای زاویه اعشاری از کادر چرخش استفاده کنید"
            />
          </div>
        </div>
        {/* MIRROR — layer-level flip for EVERY kind (text, shape, path, QR,
            badge, image). It lives in the shared transform block, not inside
            the image inspector, because the frame transform mirrors any layer
            about its own centre on the canvas and in the SVG/PDF export. */}
        <div className="mt-2">
          <span className="mb-1 block text-[10px] text-slate-500">آینه کردن</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { axis: "x", key: "flipX", label: "آینه افقی ⇆" },
                { axis: "y", key: "flipY", label: "آینه عمودی ⇅" },
              ] as const
            ).map(({ axis, key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={Boolean(selected[key])}
                onClick={() => engine.toggleFlip(selected.id, axis)}
                title="آینه‌کردن لایه حول مرکز خودش؛ در ذخیره، بازخوانی و خروجی حفظ می‌شود"
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                  selected[key]
                    ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                    : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick transform actions */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => engine.duplicateLayer(selected.id)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white"
          >
            کپی لایه
          </button>
          <button
            type="button"
            onClick={() => engine.setLayerBox(selected.id, { angle: 0 } as never)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white"
          >
            صاف کردن
          </button>
        </div>
      </div>

      {/* ARRANGE — z-order controls, synced to the layer panel & renderer. */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">ترتیب لایه</span>
        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" title="به جلو" onClick={() => engine.bringToFront(selected.id)} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">⤒</button>
          <button type="button" title="یک سطح به جلو" onClick={() => engine.reorder(selected.id, 1)} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↑</button>
          <button type="button" title="یک سطح به عقب" onClick={() => engine.reorder(selected.id, -1)} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↓</button>
          <button type="button" title="به عقب" onClick={() => engine.sendToBack(selected.id)} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">⤓</button>
        </div>
      </div>

      {/* ALIGN — single-layer align against the artboard edges/center. */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">تراز کردن در بوم</span>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" title="تراز به چپ" onClick={() => engine.alignToArtboard(selected.id, "left")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↤</button>
          <button type="button" title="تراز به وسط افقی" onClick={() => engine.alignToArtboard(selected.id, "centerX")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↔</button>
          <button type="button" title="تراز به راست" onClick={() => engine.alignToArtboard(selected.id, "right")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↦</button>
          <button type="button" title="تراز به بالا" onClick={() => engine.alignToArtboard(selected.id, "top")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↥</button>
          <button type="button" title="تراز به وسط عمودی" onClick={() => engine.alignToArtboard(selected.id, "centerY")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↕</button>
          <button type="button" title="تراز به پایین" onClick={() => engine.alignToArtboard(selected.id, "bottom")} className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] text-slate-300 hover:text-white">↧</button>
        </div>
      </div>

      {/* Kind-aware color: text → text color, badge/shape → background, qr → module color. */}
      {selected.kind === "text" && (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ متن</span>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EDITOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => engine.updateLayer(selected.id, { color } as never)}
                className={`h-6 w-6 rounded-full border-2 ${selected.color === color ? "border-cyan-400" : "border-white/20"}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <ColorPickerField
            value={selected.color}
            onChange={(c) => engine.transientPatch(selected.id, { color: c } as never)}
            onGestureEnd={() => engine.commitTransient("color:text")}
          />
        </div>
      )}

      {/* A shape's fill now lives in its own section (ShapeInspectorSection), so
          this block is badge-only — no duplicated colour control. */}
      {selected.kind === "badge" && (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ پس‌زمینه</span>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EDITOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => engine.updateLayer(selected.id, { background: color } as never)}
                className={`h-6 w-6 rounded-full border-2 ${selected.background === color ? "border-cyan-400" : "border-white/20"}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <ColorPickerField
            value={selected.background}
            onChange={(c) => engine.transientPatch(selected.id, { background: c } as never)}
            onGestureEnd={() => engine.commitTransient("color:background")}
          />
        </div>
      )}

      {selected.kind === "qr" && (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">رنگ ماژول QR</span>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EDITOR_PALETTE.slice(0, 6).map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => engine.updateLayer(selected.id, { dark: color } as never)}
                className={`h-6 w-6 rounded-full border-2 ${(selected as QrLayer).dark === color ? "border-cyan-400" : "border-white/20"}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <ColorPickerField
            value={(selected as QrLayer).dark}
            onChange={(c) => engine.transientPatch(selected.id, { dark: c } as never)}
            onGestureEnd={() => engine.commitTransient("color:qr")}
          />
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-slate-300">شفافیت: {Math.round(selected.opacity * 100)}٪</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(selected.opacity * 100)}
          onChange={(e) => engine.updateLayer(selected.id, { opacity: Number(e.target.value) / 100 } as never)}
          className="w-full accent-cyan-400"
        />
      </label>
    </div>
  );
}

export function LayersPanel({ engine, doc }: { engine: EditorEngine; doc: CardDocument }) {
  const state = useCardEditor(engine);
  const ordered = [...doc.layers].reverse(); // top-most first for display
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function layerLabel(layer: CardLayer): string {
    if (layer.name && layer.name.trim() !== "") return layer.name;
    if (layer.kind === "text") {
      const text = (layer as { text?: string }).text?.slice(0, 18) ?? "";
      return `${LAYER_KIND_LABELS.text}${text ? ` — ${text}` : ""}`;
    }
    if (layer.kind === "shape") {
      const shape = (layer as { shape?: ShapeKind }).shape ?? "rect";
      return `${LAYER_KIND_LABELS.shape} — ${SHAPE_KIND_LABELS[shape] ?? shape}`;
    }
    if (layer.kind === "badge") {
      const badgeText = (layer as { text?: string }).text ?? "";
      return `${LAYER_KIND_LABELS.badge}${badgeText ? ` — ${badgeText}` : ""}`;
    }
    return LAYER_KIND_LABELS[layer.kind];
  }

  function commitRename(layerId: string): void {
    if (renameValue.trim() !== "") engine.renameLayer(layerId, renameValue.trim());
    setRenaming(null);
    setRenameValue("");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">لایه‌ها ({doc.layers.length})</h3>
      <ul className="space-y-1.5">
        {ordered.map((layer) => {
          const isSelected = state.selection.layerId === layer.id;
          const isRenaming = renaming === layer.id;
          return (
            <li
              key={layer.id}
              className={`flex items-center justify-between gap-2 rounded-xl border p-2 ${
                isSelected ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  dir="rtl"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(layer.id);
                    if (e.key === "Escape") {
                      setRenaming(null);
                      setRenameValue("");
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-cyan-400 bg-white/5 px-2 py-1 text-xs text-white outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => engine.select(layer.id)}
                  onDoubleClick={() => {
                    setRenaming(layer.id);
                    setRenameValue(layerLabel(layer));
                  }}
                  title="برای تغییر نام، دابل‌کلیک کنید"
                  className="min-w-0 flex-1 text-right text-xs font-semibold text-slate-200"
                >
                  <span className="block truncate">{layerLabel(layer)}</span>
                </button>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" title="به جلو" onClick={() => engine.bringToFront(layer.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="به عقب" onClick={() => engine.sendToBack(layer.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="کپی لایه" onClick={() => engine.duplicateLayer(layer.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button type="button" title={layer.hidden ? "نمایش" : "مخفی"} onClick={() => engine.toggleHidden(layer.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  {layer.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button type="button" title={layer.locked ? "باز کردن قفل" : "قفل"} onClick={() => engine.toggleLocked(layer.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  {layer.locked ? <Lock className="h-3.5 w-3.5 text-amber-300" /> : <LockOpen className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  title="حذف"
                  onClick={() => engine.deleteLayer(layer.id)}
                  disabled={layer.locked}
                  className="rounded-md p-1 text-rose-400 hover:bg-rose-500/15 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {doc.layers.length === 0 && (
        <p className="rounded-xl border border-white/10 p-4 text-center text-xs text-slate-500">
          لایه‌ای وجود ندارد — از جعبه ابزار اضافه کنید.
        </p>
      )}
      <button
        type="button"
        onClick={() => engine.addLayer("text")}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-bold text-slate-300 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        لایه متن جدید
      </button>
    </div>
  );
}

export default InspectorPanel;
