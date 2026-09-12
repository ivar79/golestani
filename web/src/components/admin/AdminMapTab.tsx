"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Globe2, KeyRound, Save } from "lucide-react";
import { getAdminSettings, saveAdminSetting } from "@/lib/admin";
import { neshanKeyPresent, neshanStyle, resolveMapEngine } from "@/lib/mapEngine";

/**
 * AdminMapTab — تنظیمات زیرساخت نقشه در پنل مدیریت.
 *
 *  - دو موتور سوییچ‌پذیر (ذخیره در تنظیمات ادمین با کلید `map.tile_source`):
 *      neshan → SDK رسمی نشان (موتور اصلی)
 *      online → Leaflet + رستر عمومی OSM (fallback)
 *  - نمایش وضعیت کلید نشان (NEXT_PUBLIC_NESHAN_MAP_KEY) و استایل فعال.
 *
 * توجه: مقدار ذخیره‌شده به مرورگر کاربر تحمیل نمی‌شود — منبع حقیقت انتخابی
 * در سمت کلاینت، پارامتر URL/env است (mapEngine.ts). این کلید صرفاً ترجیح
 * ثبت‌شدهٔ ادمین است و در توضیحات/ابزار دیباگ استفاده می‌شود.
 */

/** مقدار ذخیره‌شده در تنظیمات — هم‌ارز موتور نقشه */
type EngineSetting = "neshan" | "online";

const SOURCE_OPTIONS: Array<{ key: EngineSetting; label: string; hint: string }> = [
  {
    key: "neshan",
    label: "نشان — SDK رسمی (پیش‌فرض)",
    hint: "تایل‌های میزبانی‌شدهٔ نشان با لیبل فارسی و استایل‌های حرفه‌ای؛ نیازمند کلید NEXT_PUBLIC_NESHAN_MAP_KEY",
  },
  {
    key: "online",
    label: "رستر آنلاین OSM (fallback)",
    hint: "کاشی‌های شطرنجی عمومی OpenStreetMap بدون کلید؛ ساده و همیشه در دسترس",
  },
];

function normalizeEngine(value: string | null | undefined): EngineSetting {
  if (value === "online") return "online";
  if (value === "neshan") return "neshan";
  // مقادیر قدیمی مارتین/PMTiles به معادل جدید نگاشت می‌شوند
  return "neshan";
}

export default function AdminMapTab() {
  const [sourceMode, setSourceMode] = useState<EngineSetting>("neshan");
  const [savedMode, setSavedMode] = useState<EngineSetting>("neshan");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const rows = await getAdminSettings();
      const row = rows.find((r) => r.key === "map.tile_source");
      const value = normalizeEngine(row?.value);
      setSourceMode(value);
      setSavedMode(value);
    } catch {
      // Settings API hiccup — keep default.
    } finally {
      setLoading(false);
    }
  }, []);

  // Defer the initial load out of the effect body (react-hooks
  // set-state-in-effect rule): the fetch is an async callback,
  // its setState calls land in microtasks after mount.
  useEffect(() => {
    const t = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(t);
  }, [loadSettings]);

  async function save() {
    setSaving(true);
    try {
      await saveAdminSetting("map.tile_source", sourceMode);
      setSavedMode(sourceMode);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const dirty = sourceMode !== savedMode;
  const runtimeEngine = resolveMapEngine();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
          زیرساخت نقشه
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          انتخاب موتور نقشه و وضعیت کلید پلتفرم نشان
        </p>
      </div>

      {/* Engine switcher */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-400">
            <Globe2 className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-white">موتور نقشه</h3>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {SOURCE_OPTIONS.map((opt) => {
            const active = sourceMode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={loading}
                onClick={() => setSourceMode(opt.key)}
                className={`rounded-xl border p-3.5 text-right transition-all disabled:opacity-50 ${
                  active
                    ? "border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.2)]"
                    : "border-white/10 bg-white/[0.03] hover:border-cyan-400/30 hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${active ? "text-cyan-200" : "text-slate-200"}`}>
                    {opt.label}
                  </span>
                  {active && <Check className="h-4 w-4 text-cyan-300" />}
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-400">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-4">
          <p className="text-[11px] text-slate-500">
            {savedMode === "neshan"
              ? "حالت فعلی: نشان — تایل‌های وکتوری نشان با کش مرورگر/CDN سرو می‌شوند."
              : "حالت فعلی: رستر آنلاین — کاشی‌های عمومی OSM مستقیم سرو می‌شوند."}
          </p>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </button>
        </div>
        {savedFlash && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-300" role="status">
            ✓ منبع نقشه ذخیره شد.
          </p>
        )}
      </div>

      {/* Neshan key status */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/10 text-indigo-300">
            <KeyRound className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-white">وضعیت کلید پلتفرم نشان</h3>
        </div>

        {neshanKeyPresent ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs leading-relaxed text-emerald-200">
            <p className="font-bold">کلید نشان تنظیم شده است ✓</p>
            <p className="mt-1 text-emerald-200/80">
              موتور پیش‌فرض نقشه، SDK نشان است. استایل فعال:{" "}
              <code className="rounded bg-black/30 px-1 font-mono" dir="ltr">{neshanStyle}</code>
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-200">
            <p className="font-bold">کلید نشان تنظیم نشده است.</p>
            <p className="mt-1 text-amber-200/80">
              در این حالت نقشه خودکار روی fallback رستر آنلاین اجرا می‌شود. برای فعال‌سازی
              موتور اصلی، در
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">platform.neshan.org</code>
              ثبت‌نام کنید و کلید را در
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">web/.env.local</code>
              مقدار
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">NEXT_PUBLIC_NESHAN_MAP_KEY</code>
              بگذارید و سرور را ری‌استارت کنید.
            </p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-500">
          موتور فعال در همین مرورگر:{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-[10px] text-slate-300" dir="ltr">
            {runtimeEngine}
          </code>
          {" — "}برای تست دستی می‌توانید به انتهای آدرس صفحه اضافه کنید:
          <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[10px] text-cyan-300" dir="ltr">
            ?mapsource=neshan
          </code>
          یا
          <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[10px] text-cyan-300" dir="ltr">
            ?mapsource=online
          </code>
        </p>
      </div>
    </div>
  );
}
