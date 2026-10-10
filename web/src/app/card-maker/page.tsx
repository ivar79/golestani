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
import dynamic from "next/dynamic";
import {
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building2,
  ZoomIn,
  Scan,
  Smartphone,
  Tablet,
  Monitor,
  Layers,
  Save,
  X,
  Lock,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import axios from "axios";
import { useAuth } from "@/contexts/AuthContext";
import { listBusinesses, type Business } from "@/lib/businesses";
import { pickActiveBusiness, writeActiveBusinessId } from "@/lib/activeBusiness";
import api, { extractApiError, retryTransient } from "@/lib/api";
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
} from "@/components/cards/FeatureGate";
import {
  FREE_TIER_FALLBACK,
  canOpenStudio,
  describeEntitlementErrors,
  describeStudioStatus,
  extractEntitlementErrors,
  isAllowedValue,
  type EntitlementPayload,
  type CardLockState,
  type StudioStatus,
} from "@/lib/entitlements";
import CardExportMenu from "@/components/cards/CardExportMenu";
import { parseDocument } from "@/features/card-editor/domain/factory";
import type { CardDocument } from "@/features/card-editor/domain/document";
import type { ExportFormat, RasterScale } from "@/features/card-editor/export/exportCard";

const CardStudio = dynamic(() => import("@/features/card-editor/react/CardStudio"), {
  loading: () => <div className="min-h-[420px] animate-pulse rounded-3xl bg-white/5" />,
});

/**
 * Structured API diagnostic — the loader/saver catch blocks used to swallow
 * everything into a generic message, which made a backend 422 (validation)
 * indistinguishable from a network blip. This logs the request + response
 * shape (never secrets) in DEVELOPMENT so the root cause is visible, while
 * production keeps showing only the friendly message.
 *
 * The logged payload is the HTTP envelope only — the response body is
 * included in dev (it is what names the failing validation rule) but never
 * surfaced to the user, so backend internals cannot leak into the UI.
 */
function logCardApiError(scope: string, error: unknown): void {
  if (process.env.NODE_ENV !== "development") return;
  if (axios.isAxiosError(error)) {
    console.error(`[CardMaker][${scope}]`, {
      isAxiosError: true,
      status: error.response?.status ?? null,
      code: error.code ?? null,
      method: error.config?.method ?? null,
      url: error.config?.url ?? null,
      baseURL: error.config?.baseURL ?? null,
      responseData: error.response?.data ?? null,
      message: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[CardMaker][${scope}]`, {
    isAxiosError: false,
    name: error instanceof Error ? error.name : typeof error,
    message,
  });
}

export type BusinessCardResponse = {
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
  /** Layered editor document (null = template renderer governs this card). */
  design_json?: CardDocument | null;
  /** Card front image — system /storage/… path after a multipart upload. */
  front_image?: string | null;
  /** Server-resolved capability contract (UX mirror — backend is authoritative). */
  entitlements?: EntitlementPayload;
  /** Studio gate decision (UX mirror — every Level B write is re-checked). */
  studio?: StudioStatus;
  locked?: CardLockState;
};

const MAX_PRINT_FILE_BYTES = 10 * 1024 * 1024; // matches backend max:10240 (KB)
const ALLOWED_PRINT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const TEMPLATE_OPTIONS: { key: CardTemplate; label: string; desc: string; swatch: string }[] = [
  { key: "classic", label: "مینیمال حرفه‌ای", desc: "روشن و رسمی، با تمرکز بر خوانایی", swatch: "bg-[#f6f8fb] border-[#dbe4f0]" },
  { key: "midnight", label: "گرادیان مدرن", desc: "تیره با درخشش رنگ برند", swatch: "bg-gradient-to-br from-[#081528] to-[#153a6b]" },
  { key: "emerald", label: "زمردی رسمی", desc: "رنگ‌بندی عمیق با کنتراست بالا", swatch: "bg-gradient-to-br from-[#0a1a2e] to-[#0d2342]" },
  { key: "local", label: "کسب‌وکار محلی", desc: "آدرس و تماس در مرکز توجه", swatch: "bg-white border-[#dbe4f0]" },
  { key: "creative", label: "خلاقانه", desc: "ترکیب رنگی برجسته و امروزی", swatch: "bg-gradient-to-bl from-[#0ea5e9] to-[#081528]" },
];

const FONT_LABELS: Record<CardFontFamily, string> = { sans: "سن‌سریف", vazir: "وزیرمتن", serif: "سریف" };

const THEME_OPTIONS: { key: CardTheme; label: string; colorClass: string }[] = [
  { key: "navy", label: "سرمه‌ای", colorClass: "bg-[#0d2342]" },
  { key: "emerald", label: "زمردی", colorClass: "bg-[#064635]" },
  { key: "warm", label: "گرم", colorClass: "bg-[#48230b]" },
];

type DeviceKey = "mobile" | "tablet" | "desktop";
const DEVICE_WIDTHS: Record<DeviceKey, number> = { mobile: 375, tablet: 768, desktop: 1040 };

export default function CardMakerPage() {
  const { user, loading: authLoading, token } = useAuth();
  const canvas = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * The editor's live document. Held in a REF, not state, on purpose: it
   * changes on every editor keystroke, and re-rendering this whole page that
   * often would be wasteful. Only the artboard SIZE is mirrored into state
   * (changing it is rare), so the export menu can show real output pixels
   * without subscribing to the document.
   */
  const liveDocRef = useRef<CardDocument | null>(null);
  const [artboard, setArtboard] = useState<{ width: number; height: number } | null>(null);

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [businessesError, setBusinessesError] = useState<string | null>(null);
  const [businessesLoadAttempt, setBusinessesLoadAttempt] = useState(0);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [template, setTemplate] = useState<CardTemplate>("classic");
  const [theme, setTheme] = useState<CardTheme>("navy");
  const [fontSize, setFontSize] = useState<CardFontSize>("medium");
  const [fontFamily, setFontFamily] = useState<CardFontFamily>("sans");

  const [cardData, setCardData] = useState<BusinessCardResponse | null>(null);
  // Explicit card target (unified selection contract): the id load returned.
  // Sent with every write so show/save/apply land on the SAME card row.
  const [cardId, setCardId] = useState<number | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  // Entitlement mirror from the backend (UX only — every save/export is
  // re-authorized server-side; a 403 here falls back to the upgrade UI).
  const [entitlements, setEntitlements] = useState<EntitlementPayload>(FREE_TIER_FALLBACK);
  const [locked, setLocked] = useState<CardLockState | null>(null);
  // Studio gate mirror: null = the server did not send a decision (older
  // payloads) → never lock the UI on missing data; the backend still
  // re-checks every Level B write itself.
  const [studioAccess, setStudioAccess] = useState<StudioStatus | null>(null);
  const [cardCount] = useState(0);
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

  // PHASE 4: layered editor mode. design_json drives the layered renderer;
  // null keeps the existing template renderer (legacy cards unaffected).
  const [designJson, setDesignJson] = useState<CardDocument | null>(null);
  const [editorMode, setEditorMode] = useState(false);
  const editorAllowed = entitlements.capabilities.card_editor === true;

  // Unsaved-changes tracking: last saved snapshot vs current selection.
  // State (not a ref) so that saving re-renders and clears the dirty bar.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("classic|navy|medium|sans");
  const isDirty = useMemo(
    () => `${template}|${theme}|${fontSize}|${fontFamily}` !== savedSnapshot,
    [template, theme, fontSize, fontFamily, savedSnapshot]
  );

  // Load businesses alongside AuthContext's /auth/me validation. The API
  // interceptor already reads the persisted token, and the page remains gated
  // on authLoading/user before exposing any business data.
  useEffect(() => {
    if (!token) return;
    let active = true;
    let settled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!active || settled) return;
      setBusinessesLoading(true);
      setBusinessesError(null);
    }, 0);
    // Same cold-boot contract as the card GET below: retry ONLY when the API
    // did not answer (timeout / network drop / 5xx). A real 4xx — including the
    // 429 this endpoint's `throttle:30,1` group returns after ~30 calls/min —
    // surfaces immediately instead of being retried into a longer lockout.
    retryTransient(() => listBusinesses())
      .then((items) => {
        if (!active) return;
        setBusinesses(items);
        const requestedBusinessId = Number(new URLSearchParams(window.location.search).get("business_id"));
        const requestedBusiness = items.find((item) => item.id === requestedBusinessId);
        // URL param wins, then the remembered business, then the newest one.
        if (items.length > 0) setSelectedBusiness(pickActiveBusiness(items, requestedBusiness?.id));
      })
      .catch((err) => {
        if (!active) return;
        setBusinesses(null);
        setBusinessesError(extractApiError(err));
      })
      .finally(() => {
        settled = true;
        window.clearTimeout(loadingTimer);
        if (active) setBusinessesLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(loadingTimer);
    };
  }, [token, businessesLoadAttempt]);

  // Load card settings for selected business
  useEffect(() => {
    if (!selectedBusiness) return;
    writeActiveBusinessId(selectedBusiness.id);
    // Deferred flag-set (project pattern): setState leaves the effect body
    // (react-hooks/set-state-in-effect) while the loading UI shows one extra
    // frame at most — behavior is unchanged.
    const t = window.setTimeout(() => setCardLoading(true), 0);
    // The API runs in a Docker container whose first request after an idle
    // period pays the Laravel boot cost (~6s) — close to the 15s axios ceiling
    // on a slow Windows mount. retryTransient retries only when the API did
    // NOT answer (timeout / network drop / 5xx); a real 4xx answer is never
    // retried, so a 403/422 surfaces immediately.
    retryTransient(() => api.get<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`))
      .then(({ data }) => {
        setCardData(data);
        setCardId(typeof data.id === "number" ? data.id : null);
        setDesignJson(parseDocument(JSON.stringify(data.design_json ?? null)));
        // Auto-open the layered workspace ONLY when the server allows it: a
        // grandfathered design must never flip a refused business into studio
        // mode (the guards below would hide it, but editorMode must stay
        // honest for the toggle state and the unsaved-changes logic).
        setEditorMode(Boolean(data.design_json) && canOpenStudio(data.studio));
        if (data.entitlements) setEntitlements(data.entitlements);
        if (data.studio) setStudioAccess(data.studio);
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
      .catch((err) => {
        // 422 here means the STORED document fails today's validator (or the
        // request shape changed) — the diagnostic names the rule; the UI keeps
        // the last known-good state and stays usable.
        logCardApiError("load-card", err);
        setMessage({ text: `بارگذاری تنظیمات کارت انجام نشد: ${extractApiError(err)}`, error: true });
        setSavedSnapshot("classic|navy|medium|sans");
      })
      .finally(() => {
        window.clearTimeout(t);
        setCardLoading(false);
      });
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

  // The server's studio decision is authoritative: whenever it refuses the
  // selected business (not an approved designer, business lacks the
  // capability, revoked/expired/plan change), the advanced workspace closes
  // immediately — even when a grandfathered layered card exists. Level A
  // (scalar settings, legacy preview, export, print file) is untouched.
  useEffect(() => {
    if (!studioAccess || studioAccess.allowed) return;
    // Deferred set (project pattern): setState leaves the effect body so
    // react-hooks/set-state-in-effect stays satisfied; behavior unchanged.
    const t = window.setTimeout(() => setEditorMode(false), 0);
    return () => window.clearTimeout(t);
  }, [studioAccess]);

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
      if (cardId) formData.append("card_id", String(cardId));
      if (printFile) formData.append("print_file", printFile);

      const res = await api.post<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`, formData);
      setCardData(res.data);
      if (res.data.entitlements) setEntitlements(res.data.entitlements);
      if (res.data.studio) setStudioAccess(res.data.studio);
      if (res.data.locked) setLocked(res.data.locked);
      setPrintFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSavedSnapshot(`${template}|${theme}|${fontSize}|${fontFamily}`);
      setStaleError(null);
      setMessage({ text: "کارت با موفقیت ذخیره شد." });
    } catch (err) {
      // A save refusal is either an entitlement boundary (403, surfaced with
      // the exact capability) or a validation rejection (422). Both are logged
      // in dev; only the friendly message reaches the user in production.
      logCardApiError("save-design", err);
      // Backend is authoritative: a stale capability payload is corrected here.
      const entitlementErrors = extractEntitlementErrors(err);
      if (entitlementErrors) {
        setStaleError("امکانات انتخابی در پلن فعلی شما فعال نیست — طرح ذخیره نشد.");
        // Re-sync the contract so the UI locks update immediately.
        try {
          const refreshed = await api.get<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`);
          setCardData(refreshed.data);
          if (refreshed.data.entitlements) setEntitlements(refreshed.data.entitlements);
          if (refreshed.data.studio) setStudioAccess(refreshed.data.studio);
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
        ...(cardId ? { card_id: cardId } : {}),
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

  /** PHASE 4: persist the layered editor document (entitlement-gated server-side). */
  async function handleSaveDesign(doc: CardDocument) {
    if (!selectedBusiness) throw new Error("کسب‌وکاری انتخاب نشده است.");
    const res = await api.put<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`, {
      ...(cardId ? { card_id: cardId } : {}),
      template,
      theme,
      font_size: fontSize,
      font_family: fontFamily,
      design_json: doc,
    });
    setCardData(res.data);
    setDesignJson(doc);
    if (res.data.entitlements) setEntitlements(res.data.entitlements);
    if (res.data.studio) setStudioAccess(res.data.studio);
    if (res.data.locked) setLocked(res.data.locked);
    setSavedSnapshot(`${template}|${theme}|${fontSize}|${fontFamily}`);
  }

  /**
   * PHASE 4 media: persist a picked image through the card endpoint's
   * EXISTING multipart flow (`front_image` → public disk). Resolves to the
   * system `/storage/…` path the design whitelist accepts — the layer
   * round-trips on save/reload (blob URLs never persist).
   */
  async function handleUploadCardImage(file: File): Promise<string> {
    if (!selectedBusiness) throw new Error("کسب‌وکاری انتخاب نشده است.");
    const form = new FormData();
    // PHP parses multipart bodies only for POST (PUT bodies stay unparsed),
    // so file-bearing saves go through the standard Laravel method-spoofing
    // field — same proven flow as the print-file upload in this file.
    form.append("_method", "PUT");
    form.append("front_image", file);
    form.append("template", template);
    form.append("theme", theme);
    form.append("font_size", fontSize);
    form.append("font_family", fontFamily);
    if (cardId) form.append("card_id", String(cardId));
    // design_json is deliberately NOT sent here: multipart carries it as a
    // string (fails the `array` rule) and the controller only updates keys
    // present in the request, so the stored document stays untouched.
    const res = await api.post<BusinessCardResponse>(`/businesses/${selectedBusiness.id}/card`, form);
    setCardData(res.data);
    if (res.data.entitlements) setEntitlements(res.data.entitlements);
    if (res.data.studio) setStudioAccess(res.data.studio);
    if (res.data.locked) setLocked(res.data.locked);
    const path = res.data.front_image;
    if (!path) throw new Error("آپلود تصویر ثبت نشد.");
    return path.startsWith("/") ? path : `/storage/${path.replace(/^storage\//, "")}`;
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

  /**
   * Publish the editor's live document. Called from an effect inside CardStudio
   * on every COMMITTED change, so an export always matches what the user sees —
   * including edits that have not been autosaved yet.
   */
  const handleDocumentChange = useCallback((doc: CardDocument) => {
    liveDocRef.current = doc;
    setArtboard((prev) =>
      prev && prev.width === doc.artboard.width && prev.height === doc.artboard.height
        ? prev
        : { width: doc.artboard.width, height: doc.artboard.height },
    );
  }, []);

  async function exportCard(format: ExportFormat, scale: RasterScale) {
    if (!selectedBusiness) return;
    setExporting(true);
    setMessage(null);

    try {
      const { exportCardFile } = await import("@/features/card-editor/export/exportCard");
      await exportCardFile({
        format,
        // Vector formats are serialized from the document; raster from the DOM.
        doc: editorMode && editorAllowed ? liveDocRef.current : null,
        node: canvas.current,
        slug: selectedBusiness.slug || "card",
        scale,
      });

      // Existing contract: record the chosen format so the backend entitlement
      // audit keeps seeing every export (unchanged behaviour, four formats now).
      await api.put(`/businesses/${selectedBusiness.id}/card`, {
        ...(cardId ? { card_id: cardId } : {}),
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
        // Name the locked capability the server refused, don't just say "failed".
        setStaleError(
          describeEntitlementErrors(entitlementErrors) ??
            "خروجی گرفتن با این تنظیمات در پلن فعلی شما فعال نیست.",
        );
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

  if (businessesLoading) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 px-4 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8 text-center text-sm text-slate-300">
          در حال دریافت کسب‌وکارهای حساب…
        </div>
      </main>
    );
  }

  if (businessesError) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 px-4 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-red-500/20 bg-[#0c1626]/80 p-8 text-center backdrop-blur-xl">
          <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
          <h2 className="mt-4 text-xl font-bold">دریافت کسب‌وکارها ناموفق بود</h2>
          <p className="mt-2 text-sm text-slate-400">{businessesError}</p>
          <button
            type="button"
            onClick={() => {
              setBusinessesError(null);
              setBusinessesLoading(true);
              setBusinessesLoadAttempt((attempt) => attempt + 1);
            }}
            className="mt-6 rounded-xl bg-secondary px-6 py-3 font-bold text-slate-950 transition hover:bg-secondary-hover"
          >
            تلاش دوباره
          </button>
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

  /* ---------------- Studio-open layout ---------------- */

  /**
   * Studio gate mirror (UX only): the server refuses Level B writes for
   * non-approved designers / businesses without the capability — and lets
   * admins through with an audited bypass. `null` (older payload) never locks.
   */
  /** Reason-specific sentence, or null when the studio is usable. */
  const studioBlockReason = describeStudioStatus(studioAccess);
  // A refused business must NOT expose the advanced authoring workspace at
  // all — even when a grandfathered layered design exists: the server would
  // reject every mutation, and the product contract is that unauthorized
  // users never receive the full Studio UI. Level A (scalar settings, legacy
  // preview, export, first print file) stays untouched.
  const studioBlocked = !canOpenStudio(studioAccess);
  const editorToggleDisabled = !editorAllowed || !selectedBusiness || studioBlocked;
  const editorToggleTitle = !editorAllowed
    ? "قابلیت ویرایش لایه‌ای در اشتراک این کسب‌وکار فعال نیست"
    : studioBlockReason ?? "ورود به استودیوی طراحی";

  /**
   * True exactly when the layered studio is the page's whole job. The studio
   * is a workspace, not a section of the page: while it is open the banner
   * collapses to one compact row so the artboard AND the inspector column land
   * inside a single screen instead of being pushed below a 120px header.
   */
  const studioOpen = Boolean(
    editorMode && editorAllowed && selectedBusiness && !studioBlocked,
  );

  /** Business switcher — shared by the banner and the compact studio row. */
  const businessPicker =
    businesses && businesses.length > 1 ? (
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
    ) : null;

  const editor = (
    <EntitlementProvider value={entitlements}>
    <main
      dir="rtl"
      className={`min-h-screen text-white ${
        studioOpen ? "bg-[#0d0f13] pb-2 pt-24" : "bg-[#050B14] pb-20 pt-28 sm:pt-32"
      }`}
    >
      <AppTaskbar />

      <div className={studioOpen ? "mx-auto w-full max-w-none px-2 sm:px-3" : "mx-auto max-w-7xl px-4 sm:px-6"}>
        {/* Page Header — the full marketing banner outside the studio, one
            compact row inside it (see studioOpen). */}
        {studioOpen ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-sm font-semibold text-white">کارت‌ساز</h1>
              {selectedBusiness && (
                <span className="hidden max-w-56 truncate rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 sm:inline">
                  {selectedBusiness.name}
                </span>
              )}
            </div>
            {businessPicker}
          </div>
        ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
          <div>
            <span className="rounded-md bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-400 border border-cyan-500/20">
              طراحی و مدیریت کارت
            </span>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black text-white">کارت ویزیت‌ساز دیجیتال و چاپی</h1>
            <p className="mt-1 text-sm text-slate-400">
              کارت کسب‌وکارتان را ویرایش، پیش‌نمایش و ذخیره کنید. ابزار طراحی حرفه‌ای برای طراحان تأییدشده در دسترس است.
            </p>
          </div>

          {businessPicker}
        </div>
        )}

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

        {editorMode && editorAllowed && selectedBusiness && !studioBlocked ? (
          <div className={studioOpen ? "mt-2 w-full" : "mt-4 w-full"}>
            <div className={studioOpen ? "rounded-lg bg-transparent p-0" : "rounded-3xl border border-white/10 bg-[#0c1626]/80 p-3 sm:p-4 backdrop-blur-xl"}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditorMode(false)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                  >
                  بازگشت
                  </button>
                <span className="inline-flex min-w-0 items-center gap-2 text-xs text-slate-400">
                  
                  <span className="max-w-48 truncate font-medium text-white sm:max-w-72">
                    {selectedBusiness.name}
                  </span>
                </span>
              </div>

                <div className="flex items-center gap-2">
                  <CardExportMenu
                    capabilities={entitlements.capabilities}
                    artboardSize={artboard}
                    busy={exporting}
                    onExport={(format, scale) => void exportCard(format, scale)}
                  />
                </div>
              </div>

              {studioBlockReason && (
                <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] leading-5 text-amber-200">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    {studioBlockReason}
                  </p>
                  <Link
                    href="/pricing"
                    className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-400/20"
                  >
                    ارتقا
                  </Link>
                </div>
              )}

              <CardStudio
                key={selectedBusiness.id}
                business={selectedBusiness}
                template={template}
                theme={theme}
                fontFamily={fontFamily}
                designJson={designJson}
                onSaved={handleSaveDesign}
                onUploadImage={handleUploadCardImage}
                onDocumentChange={handleDocumentChange}
                exportRef={canvas}
              />
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.35fr]">
            {/* ============ Controls ============ */}
            <div className="order-2 min-w-0 space-y-6 lg:order-1">
            <form onSubmit={handleSaveSettings} className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl space-y-5">
              <h2 className="text-lg font-bold text-white border-b border-white/10 pb-3">انتخاب قالب کارت</h2>

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

              <h2 className="pt-2 text-lg font-bold text-white border-b border-white/10 pb-3">تنظیمات ظاهری</h2>

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
                  <CardExportMenu
                    capabilities={entitlements.capabilities}
                    artboardSize={editorMode && editorAllowed ? artboard : null}
                    busy={exporting}
                    onExport={(format, scale) => void exportCard(format, scale)}
                  />
                </div>
              </div>

              <section className="mt-4 w-full rounded-2xl border border-cyan-400/20 bg-gradient-to-l from-cyan-500/[0.08] to-transparent p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white">استودیوی طراحی حرفه‌ای</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        ویرایش لایه‌ای، ابزارهای دقیق طراحی و مدیریت عناصر کارت برای این کسب‌وکار.
                      </p>
                      {studioBlockReason && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-200">
                          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {studioBlockReason}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditorMode(true)}
                    disabled={editorToggleDisabled}
                    title={editorToggleTitle}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                  >
                    {editorToggleDisabled && <Lock className="h-3.5 w-3.5" />}
                    {studioBlocked
                      ? studioAccess?.reason === "not_approved"
                        ? "ویژهٔ طراحان تأییدشده"
                        : studioAccess?.reason === "no_capability"
                          ? "اشتراک لازم است"
                          : "دسترسی فعال نیست"
                      : !editorAllowed
                        ? "اشتراک لازم است"
                        : "ورود به استودیو"}
                  </button>
                  {(!editorAllowed || studioAccess?.reason === "no_capability") && (
                    <Link
                      href="/pricing"
                      className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
                    >
                      مشاهدهٔ پلن‌ها <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </section>

              {/* Scaled preview stage — two render paths (plan decision):
                  editorMode + design_json → layered studio; otherwise the
                  legacy template renderer (existing cards unchanged). */}
              <div ref={previewWrapRef} className="mt-5 w-full">
                {cardLoading || !selectedBusiness ? (
                  <div className="flex aspect-[1.586/1] w-full items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03]">
                    <div className="h-full w-full max-w-2xl animate-pulse rounded-2xl bg-white/5" />
                  </div>
                ) : editorMode && editorAllowed && !studioBlocked ? (
                  <CardStudio
                    key={selectedBusiness.id}
                    business={selectedBusiness}
                    template={template}
                    theme={theme}
                    fontFamily={fontFamily}
                    designJson={designJson}
                    onSaved={handleSaveDesign}
                    onUploadImage={handleUploadCardImage}
                    onDocumentChange={handleDocumentChange}
                    exportRef={canvas}
                  />
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
        )}
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
