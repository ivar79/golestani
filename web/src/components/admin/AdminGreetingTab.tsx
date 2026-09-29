"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Plus, Save, Trash2 } from "lucide-react";
import { getAdminSettings, saveAdminSetting } from "@/lib/admin";
import {
  GREETING_SCHEDULE_KEY,
  DEFAULT_GREETING_SCHEDULE,
  greetingTextForSlot,
  isValidTimezone,
  minutesInTimezone,
  parseGreetingSchedule,
  resolveGreetingSlot,
  serializeGreetingSchedule,
  validateGreetingSchedule,
  type GreetingSchedule,
} from "@/lib/greeting";

/**
 * AdminGreetingTab — Smart Greeting schedule editor.
 *
 * Follows the existing admin settings architecture (AdminMapTab pattern):
 *  - load via GET  /admin/settings,
 *  - save via PUT  /admin/settings/dashboard.greeting.schedule,
 *  - local draft state + explicit "ذخیره" with dirty tracking.
 *
 * Validation (shared with the dashboard engine, web/src/lib/greeting.ts):
 *  - valid HH:MM times,
 *  - no overlap, no gap, complete 24h coverage (start-inclusive, end-exclusive),
 *  - midnight-wrapping night slot supported.
 *
 * Custom per-slot texts (`message`) are part of the storage format and will be
 * editable from here later; current product keeps the default labels, so the
 * message fields are intentionally not exposed yet.
 */

type DraftSlot = {
  id: string;
  start: string;
  end: string;
  label: string;
  message: string | null;
};

const FALLBACK_DRAFT: DraftSlot[] = DEFAULT_GREETING_SCHEDULE.slots.map((s) => ({
  ...s,
}));

export default function AdminGreetingTab() {
  const [slots, setSlots] = useState<DraftSlot[]>(FALLBACK_DRAFT);
  const [timezone, setTimezone] = useState<string>(DEFAULT_GREETING_SCHEDULE.timezone);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  /** Non-null when the STORED schedule value is invalid (vs. a draft problem).
   *  Shown persistently so broken config stays visible until actually fixed. */
  const [storedConfigError, setStoredConfigError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const rows = await getAdminSettings();
      const row = rows.find((r) => r.key === GREETING_SCHEDULE_KEY);
      const { schedule: parsed, error } = parseGreetingSchedule(row?.value);
      setSlots(parsed.slots.map((s) => ({ ...s })));
      setTimezone(parsed.timezone);
      // Broken stored configuration must stay visible (and be fixable with a
      // plain Save — the draft below is the repaired schedule), never silently
      // replaced by defaults.
      setStoredConfigError(error);
    } catch {
      // Settings API hiccup — keep defaults.
      console.warn("[greeting] admin settings fetch failed, keeping defaults");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(t);
  }, [loadSettings]);

  const draft: GreetingSchedule = useMemo(() => ({ timezone, slots }), [timezone, slots]);

  const validationError = useMemo(() => validateGreetingSchedule(draft), [draft]);

  function updateSlot(index: number, patch: Partial<DraftSlot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setError(null);
  }

  const timezoneTrimmed = timezone.trim();
  /** Field-level IANA validation — an invalid id like Asia/Tehram is rejected
   *  immediately, before it can ever be stored. */
  const timezoneError = useMemo(() => {
    if (!timezoneTrimmed) return "تایم‌زون نمی‌تواند خالی باشد.";
    if (!isValidTimezone(timezoneTrimmed)) return `«${timezoneTrimmed}» یک شناسه IANA معتبر نیست (مثال درست: Asia/Tehran).`;
    return null;
  }, [timezoneTrimmed]);

  async function save() {
    const schedule: GreetingSchedule = { timezone: timezoneTrimmed, slots };
    const problem = validateGreetingSchedule(schedule);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAdminSetting(GREETING_SCHEDULE_KEY, serializeGreetingSchedule(schedule));
      setSavedFlash(true);
      setStoredConfigError(null); // stored value is now valid again (self-heal)
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setError("ذخیره تنظیمات ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  }

  /** Live preview of the greeting the visitor would see right now. */
  const preview = useMemo(() => {
    if (validationError || timezoneError) return null;
    try {
      const slot = resolveGreetingSlot(minutesInTimezone(new Date(), timezoneTrimmed), {
        timezone: timezoneTrimmed,
        slots,
      });
      return greetingTextForSlot(slot);
    } catch {
      return null;
    }
  }, [timezoneTrimmed, slots, validationError, timezoneError]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
          خوش‌آمدگویی هوشمند (Smart Greeting)
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          بازه‌های زمانی پیام خوش‌آمد پیشخوان کسب‌وکار — بدون هم‌پوشانی، بدون فاصله، پوشش کامل ۲۴ ساعت
        </p>
      </div>

      {/* Slot editor */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-400">
            <Clock className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-white">بازه‌های پیام</h3>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">در حال بارگذاری تنظیمات…</p>
        ) : (
          <div className="space-y-3">
            {slots.map((slot, i) => (
              <div
                key={slot.id}
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center"
              >
                <span className="w-full shrink-0 text-xs font-bold text-slate-200 sm:w-28">
                  {greetingTextForSlot(slot)}
                </span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  از
                  <input
                    type="time"
                    dir="ltr"
                    value={slot.start}
                    onChange={(e) => updateSlot(i, { start: e.target.value })}
                    className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400/50"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  تا
                  <input
                    type="time"
                    dir="ltr"
                    value={slot.end}
                    onChange={(e) => updateSlot(i, { end: e.target.value })}
                    className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400/50"
                  />
                </label>
                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                    className="mr-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/20 text-red-300/70 transition-colors hover:border-red-400/40 hover:text-red-300"
                    title="حذف بازه"
                    aria-label={`حذف بازه ${slot.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}

            {slots.length < 8 && (
              <button
                type="button"
                onClick={() =>
                  setSlots((prev) => [
                    ...prev,
                    { id: `slot_${Date.now().toString(36)}`, start: "00:00", end: "00:00", label: "پیام جدید", message: null },
                  ])
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-slate-300 transition-colors hover:border-cyan-400/30 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                افزودن بازه
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timezone */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <h3 className="mb-3 text-sm font-bold text-white">تایم‌زون ارزیابی</h3>
        <input
          dir="ltr"
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            setError(null);
          }}
          className="w-full max-w-xs rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
        />
        {timezoneError && (
          <p className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
            {timezoneError}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          پیش‌فرض <code dir="ltr">Asia/Tehran</code> — شناسه IANA معتبر. زمان greeting بر اساس این تایم‌زون
          محاسبه می‌شود، نه ساعت مرورگر کاربر.
        </p>
      </div>

      {/* Validation + save */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        {storedConfigError && (
          <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              تنظیمات ذخیره‌شدهٔ greeting نامعتبر است: {storedConfigError} — مقادیر زیر اصلاح‌شده‌اند؛ پس از رفع،
              ذخیره کنید تا مشکل برطرف شود.
            </span>
          </p>
        )}
        {validationError && (
          <p className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {validationError}
          </p>
        )}
        {error && (
          <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </p>
        )}
        {!validationError && preview && (
          <p className="mb-3 text-[11px] text-slate-400">
            پیش‌نمایش زنده (اکنون): <span className="font-bold text-cyan-300">{preview}</span>
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !!validationError || !!timezoneError}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </button>
        </div>
        {savedFlash && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-300" role="status">
            ✓ برنامه greeting ذخیره شد.
          </p>
        )}
      </div>
    </div>
  );
}
