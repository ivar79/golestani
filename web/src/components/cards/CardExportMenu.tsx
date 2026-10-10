"use client";

/**
 * CardExportMenu — the single export surface for a card.
 *
 * The four options are not four decorations: PNG/JPG come from rasterizing the
 * live artboard, SVG/PDF are serialized from the card DOCUMENT as real vectors.
 * So the menu must be honest about which inputs it actually has:
 *
 *   - `doc === null` means the card is being drawn by the legacy template
 *     renderer, which has no document model. Vector export is then genuinely
 *     impossible, and the option says so instead of silently exporting a raster
 *     inside an .svg file.
 *   - `isAllowedValue(caps, "card_exports", format)` is the plan gate. A locked
 *     format still shows (discoverability) but is not clickable.
 *
 * Resolution applies to the raster formats only — vector output has no
 * resolution, and pretending otherwise would be a fake control.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileCode2, FileImage, FileText, Loader2, Lock } from "lucide-react";
import { isAllowedValue, type CapabilityMap } from "@/lib/entitlements";
import {
  EXPORT_FORMATS,
  RASTER_SCALES,
  type ExportFormat,
  type RasterScale,
} from "@/features/card-editor/export/formats";

const FORMAT_ICONS: Record<ExportFormat, typeof FileImage> = {
  png: FileImage,
  jpg: FileImage,
  svg: FileCode2,
  pdf: FileText,
};

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

function fa(value: number): string {
  return String(value).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

export function CardExportMenu({
  capabilities,
  artboardSize,
  busy,
  onExport,
}: {
  capabilities: CapabilityMap;
  /**
   * The live document's artboard size, or null when no document exists — i.e.
   * the legacy (non-layered) template renderer governs the card, which has no
   * vector model at all. Also drives the honest output-pixel readout.
   */
  artboardSize: { width: number; height: number } | null;
  busy: boolean;
  onExport: (format: ExportFormat, scale: RasterScale) => void;
}) {
  const hasDocument = artboardSize !== null;
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<RasterScale>(2);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — the panel is a transient affordance and
  // must never trap the pointer over the preview.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pixelHint = artboardSize
    ? `${fa(artboardSize.width * scale)}×${fa(artboardSize.height * scale)} پیکسل`
    : "";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        title="دریافت خروجی طرح"
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        <span>{busy ? "در حال ساخت…" : "خروجی"}</span>
        <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="فرمت خروجی"
          className="absolute left-0 top-full z-[80] mt-2 max-h-[min(70vh,480px)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0c1626] p-3 shadow-2xl shadow-black/50"
        >
          {/* Resolution — raster only, and labelled as such. */}
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-[11px] font-semibold text-slate-300">کیفیت تصویر</span>
            <div className="flex rounded-xl border border-white/10 bg-white/5 p-0.5">
              {RASTER_SCALES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScale(value)}
                  aria-pressed={scale === value}
                  title={`${value}× اندازه کارت`}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    scale === value ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {fa(value)}×
                </button>
              ))}
            </div>
          </div>
          {pixelHint && (
            <p className="pb-2 text-[10px] text-slate-500">{pixelHint} — فقط برای PNG و JPG</p>
          )}

          <div className="space-y-1 border-t border-white/10 pt-2">
            {EXPORT_FORMATS.map(({ key, label, hint, needsDocument }) => {
              const entitled = isAllowedValue(capabilities, "card_exports", key);
              const needsDoc = needsDocument && !hasDocument;
              const disabled = busy || !entitled || needsDoc;
              const Icon = FORMAT_ICONS[key];
              const reason = !entitled
                ? `خروجی ${label} در پلن فعلی فعال نیست`
                : needsDoc
                  ? `خروجی ${label} فقط در ویرایشگر پیشرفته در دسترس است`
                  : `خروجی ${label} — ${hint}`;
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  title={reason}
                  onClick={() => {
                    if (disabled) return;
                    setOpen(false);
                    onExport(key, scale);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-right transition ${
                    disabled ? "cursor-not-allowed opacity-55" : "hover:bg-white/5"
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                      {label}
                      {!entitled && <Lock className="h-3 w-3 text-amber-300" />}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">
                      {needsDoc ? "نیازمند ویرایشگر پیشرفته (طرح لایه‌ای)" : hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default CardExportMenu;
