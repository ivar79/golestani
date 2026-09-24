"use client";

/**
 * Card Maker (Phase 4 UX rewrite).
 *
 * Flow: Select Business → Choose Template → Customize → Live Preview →
 * Save → Export / Print File. Every customization updates the live preview
 * instantly (no refresh). Adds: fit-to-screen preview, unsaved-changes
 * guard, client-side upload validation, delete confirmation, skeletons,
 * and the authorized private print-file download (blob + Authorization).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng, toJpeg } from "html-to-image";
import {
  Download,
  FileText,
  Upload,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building2,
  ZoomIn,
  Scan,
  Smartphone,
  Tablet,
  Monitor,
  Save,
  X,
  Lock,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { listBusinesses, type Business } from "@/lib/businesses";
import api, { extractApiError } from "@/lib/api";
import { downloadPrintFile } from "@/lib/phase4";
import CardCanvas, {
  type CardTemplate,
  type CardTheme,
  type CardFontSize,
  type CardFontFamily,
} from "@/components/cards/CardCanvas";
import AppTaskbar from "@/components/layout/AppTaskbar";
import {
  EntitlementProvider,
  PremiumBadge,
  LockedOverlay,
  UsageMeter,
  useCardEntitlements,
} from "@/components/cards/FeatureGate";
import {
  FREE_TIER_FALLBACK,
  extractEntitlementErrors,
  isAllowedValue,
  type EntitlementPayload,
  type CardLockState,
  type CapabilityMap,
} from "@/lib/entitlements";

type BusinessCardResponse = {
  id?: number;
  template?: CardTemplate;
  theme?: CardTheme;
  font_size?: CardFontSize;
  font_family?: CardFontFamily;
  print_file_path?: string | null;
  print_file_name?: string | null;
  print_file_mime?: string | null;
  print_file_url?: string | null;
  has_print_file?: boolean;
  /** Server-resolved capability contract (UX mirror — backend is authoritative). */
  entitlements?: EntitlementPayload;
  locked?: CardLockState;
};

const MAX_PRINT_FILE_BYTES = 10 * 1024 * 1024; // matches backend max:10240 (KB)
const ALLOWED_PRINT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Which templates are premium-only per the CURRENT server contract (undefined until loaded). */
function premiumTemplates(caps: CapabilityMap | null, allowed: string[] | null): Set<CardTemplate> {
  if (!caps || !allowed) return new Set();
  const universe: CardTemplate[] = ["classic", "midnight", "emerald", "local", "creative"];
  return new Set(universe.filter((t) => !allowed.includes(t)));
}

const TEMPLATE_OPTIONS: { key: CardTemplate; label: string; desc: string; swatch: string }[] = [
  { key: "classic", label: "مینیمال حرفه‌ای", desc: "روشن، تایپوگرافی قوی، رسمی", swatch: "bg-[#f6f8fb] border-[#dbe4f0]" },
  { key: "midnight", label: "گرادیان مدرن", desc: "تیره با درخشش رنگ برند", swatch: "bg-gradient-to-br from-[#081528] to-[#153a6b]" },
  { key: "emerald", label: "اجراایی پرمیوم", desc: "قاب رسمی، کنتراست بالا", swatch: "bg-gradient-to-br from-[#0a1a2e] to-[#0d2342]" },
  { key: "local", label: "کسب‌وکار محلی", desc: "آدرس و تماس در مرکز توجه", swatch: "bg-white border-[#dbe4f0]" },
  { key: "creative", label: "خلاقانه", desc: "بلوک‌های مورب رنگی، جسورانه", swatch: "bg-gradient-to-bl from-[#0ea5e9] to-[#081528]" },
];

const THEME_LABELS: Record<CardTheme, string> = { navy: "سرمه‌ای", emerald: "زمردی", warm: "گرم" };
const FONT_LABELS: Record<CardFontFamily, string> = { sans: "مدرن Sans", vazir: "وزیرمتن", serif: "رسمی Serif" };

const THEME_OPTIONS: { key: CardTheme; label: string; colorClass: string }[] = [
  { key: "navy", label: "سرمه‌ای", colorClass: "bg-[#0d2342]" },
  { key: "emerald", label: "زمردی", colorClass: "bg-[#064635]" },
  { key: "warm", label: "گرم", colorClass: "bg-[#48230b]" },
];

type DeviceKey = "mobile" | "tablet" | "desktop";
const DEVICE_WIDTHS: Record<DeviceKey, number> = { mobile: 375, tablet: 768, desktop: 1040 };

export default function CardMakerPage() {
  const { user, loading: authLoading } = useAuth();
  const canvas = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [template, setTemplate] = useState<CardTemplate>("classic");
  const [theme, setTheme] = useState<CardTheme>("navy");
  const [fontSize, setFontSize] = useState<CardFontSize>("medium");
  const [fontFamily, setFontFamily] = useState<CardFontFamily>("sans");

  const [cardData, setCardData] = useState<BusinessCardResponse | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  // Entitlement mirror from the backend (UX only — every save/export is
  // re-authorized server-side; a 403 here falls back to the upgrade UI).
  const [entitlements, setEntitlements] = useState<EntitlementPayload>(FREE_TIER_FALLBACK);
  const [locked, setLocked] = useState<CardLockState | null>(null);
  const [cardCount, setCardCount] = useState(0);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [printFile, setPrintFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Preview viewport
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [fullZoom, setFullZoom] = useState(false);
  const [fitScale, setFitScale] = useState(1);

  // Unsaved-changes tracking: last saved snapshot vs current selection.
  // State (not a ref) so that saving re-renders and clears the dirty bar.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("classic|navy|medium|sans");
  const isDirty = useMemo(
    () => `${template}|${theme}|${fontSize}|${fontFamily}` !== savedSnapshot,
    [template, theme, fontSize, fontFamily, savedSnapshot]
  );

  // Load owned businesses
  useEffect(() => {
    if (!authLoading && user) {
      listBusinesses()
        .then((items) => {
          setBusinesses(items);
          if (items.length > 0) setSelectedBusiness(items[0]);
        })
        .catch((err) => {
          setBusinesses([]);
          setMessage({ text: extractApiError(err), error: true });
        });
    }
  }, [authLoading, user]);

  // Load card settings for selected business
  useEffect(() => {
    if (!selectedBusiness) return;
    setCardLoading(true);
    api
      .get<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`)
      .then(({ data }) => {
        setCardData(data);
        if (data.entitlements) setEntitlements(data.entitlements);
        if (data.locked) setLocked(data.locked);
        setStaleError(null);
        const tpl = data.template ?? "classic";
        const thm = data.theme ?? "navy";
        const fs = data.font_size ?? "medium";
        const ff = data.font_family ?? "sans";
        setTemplate(tpl);
        setTheme(thm);
        setFontSize(fs);
        setFontFamily(ff);
        setSavedSnapshot(`${tpl}|${thm}|${fs}|${ff}`);
      })
      .catch(() => {
        setSavedSnapshot("classic|navy|medium|sans");
      })
      .finally(() => setCardLoading(false));
  }, [selectedBusiness]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Fit-to-screen scale: measure the available preview width.
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const compute = () => {
      const available = el.clientWidth;
      // Card max width is 672px (max-w-2xl); in full zoom we render natural size.
      const natural = Math.min(672, DEVICE_WIDTHS[device] * 0.92);
      const scale = Math.min(1, (available - 8) / natural);
      setFitScale(Number(scale.toFixed(3)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device, fullZoom]);

  const validateFile = useCallback((file: File): string | null => {
    if (!ALLOWED_PRINT_TYPES.includes(file.type)) {
      return "فرمت فایل مجاز نیست — فقط JPEG، PNG، WebP یا PDF.";
    }
    if (file.size > MAX_PRINT_FILE_BYTES) {
      return "حجم فایل بیشتر از سقف ۱۰ مگابایت است.";
    }
    return null;
  }, []);

  const handleFileChange = (file: File | null) => {
    setFileError(null);
    if (!file) {
      setPrintFile(null);
      return;
    }
    const error = validateFile(file);
    if (error) {
      setFileError(error);
      setPrintFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPrintFile(file);
  };

  async function handleSaveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!selectedBusiness) return;
    setSaving(true);
    setMessage(null);

    try {
      const formData = new FormData();
      // PHP parses multipart bodies only for POST, so a file-bearing PUT uses
      // the standard Laravel method-spoofing field (verified against the real
      // browser upload; JSON PUTs without files keep using api.put).
      formData.append("_method", "PUT");
      formData.append("template", template);
      formData.append("theme", theme);
      formData.append("font_size", fontSize);
      formData.append("font_family", fontFamily);
      if (printFile) formData.append("print_file", printFile);

      const res = await api.post<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`, formData);
      setCardData(res.data);
      if (res.data.entitlements) setEntitlements(res.data.entitlements);
      if (res.data.locked) setLocked(res.data.locked);
      setPrintFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSavedSnapshot(`${template}|${theme}|${fontSize}|${fontFamily}`);
      setStaleError(null);
      setMessage({ text: "کارت با موفقیت ذخیره شد." });
    } catch (err) {
      // Backend is authoritative: a stale capability payload is corrected here.
      const entitlementErrors = extractEntitlementErrors(err);
      if (entitlementErrors) {
        setStaleError("امکانات انتخابی در پلن فعلی شما فعال نیست — طرح ذخیره نشد.");
        // Re-sync the contract so the UI locks update immediately.
        try {
          const refreshed = await api.get<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`);
          setCardData(refreshed.data);
          if (refreshed.data.entitlements) setEntitlements(refreshed.data.entitlements);
          if (refreshed.data.locked) setLocked(refreshed.data.locked);
        } catch {
          /* keep current payload; the error banner already explains state */
        }
      }
      setMessage({ text: extractApiError(err), error: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePrintFile() {
    if (!selectedBusiness || !cardData) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.put<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`, {
        template,
        theme,
        font_size: fontSize,
        font_family: fontFamily,
        delete_print_file: true,
      });
      setCardData(res.data);
      setConfirmDelete(false);
      setMessage({ text: "فایل طرح چاپی حذف شد." });
    } catch (err) {
      setMessage({ text: extractApiError(err), error: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPrintFile() {
    if (!selectedBusiness) return;
    setDownloadingFile(true);
    setMessage(null);
    try {
      await downloadPrintFile(selectedBusiness.id);
      setMessage({ text: "دانلود فایل طرح چاپی آغاز شد." });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setMessage({
        text: status === 404 ? "فایل چاپی روی سرور یافت نشد." : extractApiError(err),
        error: true,
      });
    } finally {
      setDownloadingFile(false);
    }
  }

  async function exportCard(format: "png" | "jpg") {
    if (!canvas.current || !selectedBusiness) return;
    setExporting(true);
    setMessage(null);

    try {
      const exportOptions = { quality: 0.98, pixelRatio: 2.5 };
      const dataUrl =
        format === "png"
          ? await toPng(canvas.current, exportOptions)
          : await toJpeg(canvas.current, exportOptions);

      const link = document.createElement("a");
      link.download = `inkart-${selectedBusiness.slug || "card"}.${format}`;
      link.href = dataUrl;
      link.click();

      await api.put(`/businesses/${selectedBusiness.id}/card`, {
        template,
        theme,
        font_size: fontSize,
        font_family: fontFamily,
        export_format: format,
      });

      setMessage({ text: `خروجی ${format.toUpperCase()} با کیفیت بالا دریافت شد.` });
    } catch (err) {
      const entitlementErrors = extractEntitlementErrors(err);
      if (entitlementErrors) {
        setStaleError("خروجی گرفتن با این تنظیمات در پلن فعلی شما فعال نیست.");
        setMessage({ text: "برای خروجی گرفتن با این تنظیمات، اشتراک فعال لازم است.", error: true });
      } else {
        setMessage({ text: "تولید خروجی کارت با خطا مواجه شد. لطفاً دوباره تلاش کنید.", error: true });
      }
    } finally {
      setExporting(false);
    }
  }

  /* ---------------- Gate screens ---------------- */

  if (authLoading) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-7xl px-4">
          <div className="h-10 w-64 animate-pulse rounded-xl bg-white/5" />
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.35fr]">
            <div className="h-96 animate-pulse rounded-3xl bg-white/5" />
            <div className="h-96 animate-pulse rounded-3xl bg-white/5" />
          </div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 px-4 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8 text-center backdrop-blur-xl">
          <FileText className="mx-auto h-12 w-12 text-cyan-400 opacity-80" />
          <h2 className="mt-4 text-xl font-bold">ورود به کارت ویزیت‌ساز</h2>
          <p className="mt-2 text-sm text-slate-400">برای ساخت و مدیریت کارت ویزیت دیجیتال ابتدا وارد حساب کاربری خود شوید.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-cyan-500 px-6 py-3 font-bold text-slate-950 transition hover:bg-cyan-400">
            ورود به حساب
          </Link>
        </div>
      </main>
    );
  }

  if (businesses && businesses.length === 0) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 px-4 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8 text-center backdrop-blur-xl">
          <Building2 className="mx-auto h-12 w-12 text-secondary opacity-80" />
          <h2 className="mt-4 text-xl font-bold">کسب‌وکاری یافت نشد</h2>
          <p className="mt-2 text-sm text-slate-400">برای ساخت کارت ابتدا باید حداقل یک کسب‌وکار در سیستم ثبت کرده باشید.</p>
          <Link href="/dashboard" className="mt-6 inline-block rounded-xl bg-secondary px-6 py-3 font-bold text-slate-950 transition hover:bg-secondary-hover">
            ورود به داشبورد و ثبت کسب‌وکار
          </Link>
        </div>
      </main>
    );
  }

  /* ---------------- Preview sizing ---------------- */

  const previewScale = fullZoom ? 1 : Math.min(fitScale, 1);
  const hasPrintFile = Boolean(cardData?.has_print_file || cardData?.print_file_path);

  const editor = (
    <EntitlementProvider value={entitlements}>
    <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 sm:pt-32 text-white">
      <AppTaskbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
          <div>
            <span className="rounded-md bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-400 border border-cyan-500/20">
              فاز ۴ — کارت ویزیت‌ساز هوشمند
            </span>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black text-white">کارت ویزیت‌ساز دیجیتال و چاپی</h1>
            <p className="mt-1 text-sm text-slate-400">
              پنج قالب حرفه‌ای، پیش‌نمایش زنده و خروجی باکیفیت — به‌همراه نگهداری امن فایل طرح چاپی.
            </p>
          </div>

          {businesses && businesses.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">کسب‌وکار:</label>
              <select
                value={selectedBusiness?.id ?? ""}
                onChange={(e) => {
                  const b = businesses.find((item) => item.id === Number(e.target.value));
                  if (b) setSelectedBusiness(b);
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              >
                {businesses.map((b) => (
                  <option key={b.id} value={b.id} className="bg-[#0c1626]">
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Server-corrected entitlement error (stale-cap safety) */}
        {staleError && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              {staleError}
            </span>
            <Link href="/pricing" className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300">
              مشاهده پلن‌ها
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {/* Unsaved changes bar */}
        {isDirty && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              تغییرات ذخیره‌نشده دارید — برای اعمال، ذخیره کنید.
            </span>
            <button
              type="button"
              onClick={() => void handleSaveSettings()}
              disabled={saving || !selectedBusiness}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "…" : "ذخیره"}
            </button>
          </div>
        )}

        {/* Feedback Alert */}
        {message && (
          <div
            className={`mt-4 flex items-center gap-3 rounded-2xl p-4 text-sm ${
              message.error
                ? "border border-red-500/30 bg-red-500/10 text-red-300"
                : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {message.error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.35fr]">
          {/* ============ Controls ============ */}
          <div className="order-2 min-w-0 space-y-6 lg:order-1">
            <form onSubmit={handleSaveSettings} className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl space-y-5">
              <h2 className="text-lg font-bold text-white border-b border-white/10 pb-3">۱. انتخاب قالب</h2>

              {/* Template Picker — entitlement-aware. Locked templates stay
                  visible (discoverable) with lock overlay + upgrade CTA; the
                  backend independently rejects any unauthorized save. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TEMPLATE_OPTIONS.map((tpl) => {
                  const allowed = isAllowedValue(entitlements.capabilities, "card_templates", tpl.key);
                  const grandfathered = locked?.grandfathered.template === tpl.key && !allowed;
                  const tileLocked = !allowed && !grandfathered;
                  return (
                    <button
                      key={tpl.key}
                      type="button"
                      onClick={() => { if (!tileLocked) setTemplate(tpl.key); }}
                      aria-pressed={template === tpl.key}
                      aria-disabled={tileLocked}
                      className={`relative rounded-xl border p-3 text-right transition-all ${
                        tileLocked
                          ? "border-white/5 bg-white/[0.01] text-slate-500"
                          : template === tpl.key
                            ? "border-cyan-400 bg-cyan-500/15 text-white shadow-lg shadow-cyan-950/40"
                            : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <span className={`mb-2 block h-8 w-full rounded-lg border ${tpl.swatch} ${tileLocked ? "opacity-40" : ""}`} />
                      <span className="block text-xs font-bold">{tpl.label}</span>
                      <span className="block text-[10px] opacity-70 mt-0.5 leading-4">{tpl.desc}</span>
                      {tileLocked && (
                        <LockedOverlay
                          title={`قالب ${tpl.label} در پلن رایگان نیست`}
                          description="با ارتقای اشتراک، همه قالب‌ها و امکانات پیشرفته باز می‌شوند."
                        />
                      )}
                      {grandfathered && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                          ذخیره‌شده — قابل نگهداری
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <h2 className="pt-2 text-lg font-bold text-white border-b border-white/10 pb-3">۲. شخصی‌سازی</h2>

              {/* Theme — premium palettes are visible but marked + disabled. */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">پالت رنگ</label>
                <div className="grid grid-cols-3 gap-2">
                  {THEME_OPTIONS.map((thm) => {
                    const allowed = isAllowedValue(entitlements.capabilities, "card_themes", thm.key);
                    const grandfathered = locked?.grandfathered.theme === thm.key && !allowed;
                    const tileLocked = !allowed && !grandfathered;
                    return (
                      <button
                        key={thm.key}
                        type="button"
                        onClick={() => { if (!tileLocked) setTheme(thm.key); }}
                        aria-pressed={theme === thm.key}
                        aria-disabled={tileLocked}
                        className={`relative flex items-center gap-2 rounded-xl border p-2.5 transition-all ${
                          tileLocked
                            ? "border-white/5 bg-white/[0.01] text-slate-500"
                            : theme === thm.key
                              ? "border-cyan-400 bg-white/10 text-white"
                              : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20"
                        }`}
                      >
                        <span className={`h-4 w-4 rounded-full ${thm.colorClass} border border-white/20 shrink-0 ${tileLocked ? "opacity-40" : ""}`} />
                        <span className="text-xs font-medium">{thm.label}</span>
                        {tileLocked && (
                          <span className="absolute -top-2 left-2"><PremiumBadge /></span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!isAllowedValue(entitlements.capabilities, "card_themes", "warm") && (
                  <p className="mt-2 text-[10px] leading-4 text-slate-500">
                    پالت «گرم» تنها در پلن‌های اشتراکی فعال است. <Link href="/pricing" className="text-amber-300 underline">مشاهده پلن‌ها</Link>
                  </p>
                )}
              </div>

              {/* Typography */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">اندازه قلم</label>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(e.target.value as CardFontSize)}
                    className="w-full rounded-xl border border-white/15 bg-white/5 p-2.5 text-sm text-white outline-none focus:border-cyan-400"
                  >
                    <option value="small" className="bg-[#0c1626]">کوچک</option>
                    <option value="medium" className="bg-[#0c1626]">متوسط (پیش‌فرض)</option>
                    <option value="large" className="bg-[#0c1626]">بزرگ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">قلم</label>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value as CardFontFamily)}
                    className="w-full rounded-xl border border-white/15 bg-white/5 p-2.5 text-sm text-white outline-none focus:border-cyan-400"
                  >
                    {(["sans", "vazir", "serif"] as CardFontFamily[]).map((f) => {
                      const allowed = isAllowedValue(entitlements.capabilities, "card_fonts", f);
                      const grandfathered = locked?.grandfathered.font_family === f && !allowed;
                      return (
                        <option key={f} value={f} disabled={!allowed && !grandfathered} className="bg-[#0c1626]">
                          {FONT_LABELS[f]}{!allowed && !grandfathered ? " (ویژه)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Usage meter — server limit, client-known usage. */}
              <UsageMeter capability="max_cards" used={Math.max(cardCount, 1)} labels={{ max_cards: "کارت‌های شما" }} />

              {/* Save */}
              <button
                type="submit"
                disabled={saving || !selectedBusiness}
                className="w-full rounded-xl bg-cyan-500 py-3 font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
              >
                {saving ? "در حال ذخیره‌سازی…" : isDirty ? "ذخیره تغییرات" : "تنظیمات ذخیره شده ✓"}
              </button>
            </form>

            {/* Print file management — a paid capability; locked with explanation. */}
            <div className="relative rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl space-y-4">
              <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                <FileText className="h-5 w-5 text-secondary" />
                <h3 className="text-base font-bold text-white">طرح چاپی موجود (عکس یا PDF)</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                فایل طرح چاپی کسب‌وکار شما به‌صورت <strong className="text-slate-300">خصوصی</strong> نگهداری می‌شود و فقط شما (و مدیران) با احراز هویت به آن دسترسی دارید.
              </p>

              {hasPrintFile && (
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">
                      {cardData?.print_file_name || "فایل طرح چاپی بارگذاری‌شده"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {cardData?.print_file_mime || "سند ذخیره‌شده"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleDownloadPrintFile}
                      disabled={downloadingFile}
                      className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition disabled:opacity-50"
                    >
                      {downloadingFile ? "…" : "دانلود"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      disabled={saving}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20 transition"
                      title="حذف فایل چاپی"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  {hasPrintFile ? "جایگزینی با فایل جدید:" : "انتخاب فایل چاپی (عکس یا PDF):"}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-0 file:ml-3 file:rounded-xl file:border file:border-white/15 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15 file:cursor-pointer"
                />
                {fileError && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {fileError}
                  </p>
                )}
              </div>

              {printFile && !fileError && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                  فایل انتخابی: <strong>{printFile.name}</strong> — با «ذخیره تغییرات» یا دکمه زیر آپلود می‌شود.
                </div>
              )}

              {printFile && !fileError && (
                <button
                  type="button"
                  onClick={() => handleSaveSettings()}
                  disabled={saving}
                  className="w-full rounded-xl border border-secondary/40 bg-secondary/15 py-2.5 text-xs font-bold text-secondary hover:bg-secondary/25 transition disabled:opacity-50"
                >
                  {saving ? "در حال آپلود…" : "آپلود و نگهداری فایل انتخابی"}
                </button>
              )}

              {!entitlements.capabilities.print_file && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] leading-5 text-amber-200">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    نگهداری فایل طرح چاپی و دانلود آن از این صفحه، امکان پلن‌های اشتراکی است.
                  </p>
                  <Link href="/pricing" className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-400/20">
                    ارتقا
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* ============ Live Preview ============ */}
          <div className="order-1 min-w-0 lg:order-2">
            <div className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-4 sm:p-6 backdrop-blur-xl flex flex-col items-center">
              <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white">پیش‌نمایش زنده</h3>
                  <p className="text-xs text-slate-400">QR اختصاصی متصل به صفحه کسب‌وکار شما</p>
                </div>

                {/* Device sizes + zoom */}
                <div className="flex items-center gap-2">
                  <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
                    {(
                      [
                        { key: "mobile", icon: Smartphone, title: "موبایل ۳۷۵px" },
                        { key: "tablet", icon: Tablet, title: "تبلت ۷۶۸px" },
                        { key: "desktop", icon: Monitor, title: "دسکتاپ" },
                      ] as const
                    ).map(({ key, icon: Icon, title }) => (
                      <button
                        key={key}
                        type="button"
                        title={title}
                        onClick={() => setDevice(key)}
                        aria-pressed={device === key}
                        className={`rounded-lg p-1.5 transition ${
                          device === key ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFullZoom((v) => !v)}
                    title={fullZoom ? "جای‌گیری کامل در صفحه" : "اندازه واقعی ۱۰۰٪"}
                    className={`rounded-xl border p-2 transition ${
                      fullZoom
                        ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-300"
                        : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
                    }`}
                  >
                    {fullZoom ? <Scan className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
                  </button>
                  {([
                    { format: "png" as const, primary: true },
                    { format: "jpg" as const, primary: false },
                  ]).map(({ format, primary }) => {
                    const allowed = isAllowedValue(entitlements.capabilities, "card_exports", format);
                    return (
                      <button
                        key={format}
                        type="button"
                        onClick={() => { if (allowed) void exportCard(format); }}
                        disabled={exporting || !selectedBusiness || !allowed}
                        title={allowed ? `خروجی ${format.toUpperCase()}` : `خروجی ${format.toUpperCase()} در پلن فعلی فعال نیست`}
                        className={`relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          primary
                            ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-slate-950 hover:opacity-90"
                            : "hidden border border-white/15 bg-white/5 text-white hover:bg-white/10 sm:flex"
                        }`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{format.toUpperCase()}</span>
                        {!allowed && (
                          <span className="absolute -top-2 -left-2"><PremiumBadge /></span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scaled preview stage */}
              <div ref={previewWrapRef} className="mt-5 w-full">
                {cardLoading || !selectedBusiness ? (
                  <div className="flex aspect-[1.586/1] w-full items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03]">
                    <div className="h-full w-full max-w-2xl animate-pulse rounded-2xl bg-white/5" />
                  </div>
                ) : (
                  <div className="flex justify-center overflow-hidden py-2">
                    <div
                      style={{
                        width: fullZoom ? "auto" : Math.min(672, DEVICE_WIDTHS[device] * 0.92),
                        transform: `scale(${previewScale})`,
                        transformOrigin: "top center",
                        height: fullZoom ? undefined : Math.min(672, DEVICE_WIDTHS[device] * 0.92) * 0.63 * previewScale + 8,
                      }}
                    >
                      <CardCanvas
                        ref={canvas}
                        business={selectedBusiness}
                        template={template}
                        theme={theme}
                        fontSize={fontSize}
                        fontFamily={fontFamily}
                      />
                    </div>
                  </div>
                )}
              </div>

              <p className="mt-3 text-center text-xs text-slate-500">
                کارت دیجیتال قابل اشتراک در شبکه‌های اجتماعی و چاپ در سایز استاندارد (۸.۵×۵.۵ سانتی‌متر) است.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c1626] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-bold text-white">حذف فایل طرح چاپی؟</h3>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-slate-400 hover:text-white" aria-label="بستن">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              فایل فعلی برای همیشه از سرور حذف می‌شود. این عملیات بازگشت‌پذیر نیست.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void handleDeletePrintFile()}
                disabled={saving}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50"
              >
                {saving ? "در حال حذف…" : "بله، حذف کن"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </EntitlementProvider>
  );

  return editor;
}
