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
  Square,
  Trash2,
  Type,
} from "lucide-react";
import type { CardDocument, CardLayer, BadgeLayer, LayerKind, QrLayer, ShapeKind } from "../domain/document";
import { LAYER_KIND_LABELS, SHAPE_KIND_LABELS } from "../domain/document";
import { EDITOR_PALETTE } from "../domain/palette";
import {
  STROKE_LINE_CAP_LABELS,
  STROKE_LINE_JOIN_LABELS,
  STROKE_STYLE_LABELS,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
} from "../domain/stroke";

/** Structural access to badge-only fields (used for the style editor). */
type BadgeLayerLike = Pick<BadgeLayer, "style">;
import type { EditorEngine } from "../engine/EditorEngine";
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

/** Toolbox entries: a layer kind, or one of the two DRAWING tools. */
type ToolboxEntry = LayerKind | "pointer" | "pen";

const TOOLBOX: { kind: ToolboxEntry; icon: typeof Type; label: string }[] = [
  { kind: "pointer", icon: MousePointer2, label: "انتخاب" },
  { kind: "text", icon: Type, label: "متن" },
  { kind: "shape", icon: Square, label: "شکل" },
  { kind: "pen", icon: PenTool, label: "قلم منحنی" },
  { kind: "path", icon: Pencil, label: "قلم آزاد" },
  { kind: "image", icon: ImagePlus, label: "تصویر / لوگو" },
  { kind: "qr", icon: QrCode, label: "کد QR" },
  { kind: "badge", icon: BadgeCheck, label: "نشان" },
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
}: {
  engine: EditorEngine;
  onUploadImage?: (file: File) => Promise<string>;
}) {
  const state = useCardEditor(engine);
  const entitlements = useEntitlements();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Capability mirrors (UX only — the server re-checks every save).
  const layerLimit = layerLimitState(entitlements.capabilities, state.doc.layers.length);
  const addBlocked = layerLimit.state === "reached";

  function activate(kind: ToolboxEntry) {
    if (kind === "pointer") {
      engine.setTool("select");
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

    if (addBlocked || !layerKindAllowed(entitlements.capabilities, kind)) return;
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    engine.setTool("select");
    engine.addLayer(kind);
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

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">افزودن لایه</h3>
      <div className="grid grid-cols-3 gap-2">
        {TOOLBOX.map(({ kind, icon: Icon, label }) => {
          const isPointer = kind === "pointer";
          const isDrawingTool = kind === "path" || kind === "pen";
          const kindAllowed = isPointer
            ? true
            : isDrawingTool
              ? layerKindAllowed(entitlements.capabilities, "path")
              : layerKindAllowed(entitlements.capabilities, kind);
          // EVERY tool that produces a layer obeys the layer cap.
          const addsLayer = !isPointer;
          const disabled = !kindAllowed || (addsLayer && addBlocked) || (kind === "image" && (uploading || !onUploadImage));
          const lockReason = !kindAllowed
            ? "این قابلیت در پلن شما فعال نیست"
            : (addsLayer && addBlocked)
              ? "سقف تعداد لایه‌های کارت پر شده است"
              : null;
          const isSelected =
            (kind === "pointer" && state.tool === "select") ||
            (kind === "path" && state.tool === "draw") ||
            (kind === "pen" && state.tool === "pen");
          return (
            <button
              key={kind}
              type="button"
              onClick={() => activate(kind)}
              disabled={disabled}
              title={lockReason ?? undefined}
              aria-disabled={disabled}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11px] font-semibold transition ${
                isSelected ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-400/40 hover:text-white"
              } disabled:opacity-40`}
            >
              {kind === "image" && uploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              ) : (
                <Icon className={`h-4 w-4 ${isSelected ? "text-white" : "text-cyan-400"}`} />
              )}
              {label}
              {!kindAllowed && (
                <span className="absolute left-1.5 top-1.5">
                  <PremiumBadge label="قفل" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {addBlocked && (
        <p className="mt-2 text-[10px] font-semibold text-amber-300">
          سقف لایه‌های پلن شما پر شده است — برای افزودن لایهٔ جدید، لایه‌ای را حذف کنید یا پلن را ارتقا دهید.
        </p>
      )}
      {!addBlocked && layerLimit.remaining !== null && (
        <p className="mt-2 text-[10px] text-slate-500">
          {layerLimit.remaining} لایه تا سقف پلن شما باقی است.
        </p>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void onImagePicked(e.target.files?.[0] ?? null)}
      />
      {uploadError && <p className="mt-2 text-[10px] font-semibold text-rose-300">{uploadError}</p>}
      <p className="mt-3 text-[10px] leading-4 text-slate-500">
        لایه QR از endpoint رسمی کارت شما پر می‌شود ({state.doc.layers.find((l) => l.kind === "qr") ? "موجود" : "افزودن جدید"}).
      </p>
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
  const bg = state.doc.background;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">پس‌زمینه کارت</h3>
      <div className="mb-3 h-12 w-full rounded-lg border border-white/10" style={{ background: bg }} />
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

      <p className="mt-3 text-[10px] leading-4 text-slate-500">
        {pen
          ? "کلیک = نقطه، کلیک و کشیدن = نقطهٔ نرم با دو دسته، کلیک روی نقطهٔ اول = بستن مسیر، Esc = پایان مسیر باز."
          : "روی بوم بکشید تا مسیر ساخته شود. مسیرها مثل سایر لایه‌ها قابل ویرایش و جابه‌جایی هستند."}
      </p>
    </div>
  );
}

export function InspectorPanel({
  engine,
  onUploadImage,
}: {
  engine: EditorEngine;
  onUploadImage?: (file: File) => Promise<string>;
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          ویژگی‌های لایه — {LAYER_KIND_LABELS[selected.kind]}
        </h3>
        {selected.locked && <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">قفل</span>}
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
          {/* Mirror (flip) toggles — applied in the renderer via scaleX/Y. */}
          <div className="mt-3 flex gap-2">
            {(
              [
                { key: "flipX", label: "آینه افقی" },
                { key: "flipY", label: "آینه عمودی" },
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
        <p className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-4 text-slate-400">
          محتوای این QR به صفحهٔ رسمی کسب‌وکار شما متصل است و از endpoint سامانه پر می‌شود.
        </p>
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

      {/* TRANSFORM — exact numeric position/size/rotation for the selected layer. */}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-300">موقعیت و اندازه</span>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] text-slate-500">X (افقی)</span>
            <input
              type="number"
              step={1}
              value={Math.round(selected.x)}
              onChange={(e) => engine.setLayerBox(selected.id, { x: Number(e.target.value) } as never)}
              className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white tabular-nums outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-slate-500">Y (عمودی)</span>
            <input
              type="number"
              step={1}
              value={Math.round(selected.y)}
              onChange={(e) => engine.setLayerBox(selected.id, { y: Number(e.target.value) } as never)}
              className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white tabular-nums outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-slate-500">عرض</span>
            <input
              type="number"
              step={1}
              min={8}
              value={Math.round(selected.width)}
              onChange={(e) => engine.setLayerBox(selected.id, { width: Math.max(8, Number(e.target.value)) } as never)}
              className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white tabular-nums outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-slate-500">ارتفاع</span>
            <input
              type="number"
              step={1}
              min={8}
              value={Math.round(selected.height)}
              onChange={(e) => engine.setLayerBox(selected.id, { height: Math.max(8, Number(e.target.value)) } as never)}
              className="w-full rounded-lg border border-white/15 bg-white/5 p-1.5 text-xs text-white tabular-nums outline-none focus:border-cyan-400"
            />
          </label>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] text-slate-500">چرخش: {Math.round(selected.angle)}°</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={Math.round(selected.angle)}
            onChange={(e) => engine.setLayerBox(selected.id, { angle: Number(e.target.value) } as never)}
            className="w-full accent-cyan-400"
          />
        </label>
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
