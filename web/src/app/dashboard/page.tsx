"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crosshair } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { downloadPrintFile } from "@/lib/phase4";
import { type EntitlementPayload } from "@/lib/entitlements";
import { useEntitlements } from "@/hooks/useEntitlements";
import { avatarUrl } from "@/lib/auth";
import { getQrUrl } from "@/lib/businesses";
import { pickActiveBusiness, writeActiveBusinessId } from "@/lib/activeBusiness";
import { getPublicTaxonomies } from "@/lib/taxonomies";
import { OnboardingView } from "@/components/dashboard/OnboardingView";
import UsernamePicker from "@/components/dashboard/UsernamePicker";
import { DashboardFab } from "@/components/dashboard/DashboardFab";
import { DashboardSidebar, type DashboardTab } from "@/components/dashboard/DashboardSidebar";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { SubscriptionPanel } from "@/components/dashboard/SubscriptionPanel";
import { ShowcasePanel } from "@/components/dashboard/ShowcasePanel";
import { AdsPanel } from "@/components/dashboard/AdsPanel";
import NotificationsPanel from "@/components/dashboard/NotificationsPanel";
import LocationSearch, { type LocationSearchResult } from "@/components/dashboard/LocationSearch";
import { ThemeProvider, useTheme } from "@/components/dashboard/ThemeProvider";
import MapView from "@/components/map/MapView";
import {
  addImage,
  getImages,
  getOwnedBusiness,
  getOwnedBusinesses,
  mediaUrl,
  normalizeSocial,
  removeImage,
  safeHttpUrl,
  saveProfile,
  statusLabel,
  uploadProfileMedia,
  type BusinessImage,
  type BusinessInput,
  type Phase2Business,
} from "@/lib/phase2";
import {
  Building2,
  Plus,
  Save,
  ExternalLink,
  MapPin,
  Phone,
  Mail,
  Camera,
  Globe,
  Trash2,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  LogOut,
  CreditCard,
  ChevronDown,
  X,
  Loader2,
  Image as ImageIcon,
  Share2,
  Store,
  Menu,
} from "lucide-react";

type Form = {
  name: string;
  category: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  neighborhood: string;
  latitude: string;
  longitude: string;
  services: string;
  designer_referral_code: string;
};

type Social = { key: string; url: string };

const EMPTY: Form = {
  name: "",
  category: "",
  description: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  neighborhood: "",
  latitude: "",
  longitude: "",
  services: "",
  designer_referral_code: "",
};

const FALLBACK_CATEGORIES = [
  "کافه و رستوران",
  "مبلمان و دکوراسیون داخلی",
  "پوشاک و مد",
  "زیبایی، پوست و سلامت",
  "خدمات دیجیتال و وب",
  "املاک و ساختمان",
  "فروشگاه لوازم خانگی",
  "خدمات خودرو و حمل‌ونقل",
  "آموزش و تدریس",
  "پزشکی و سلامت",
  "سایر خدمات و مشاغل",
];

const PRESET_SOCIALS = [
  { key: "instagram", label: "اینستاگرام", placeholder: "username یا لینک کامل", icon: Camera },
  { key: "telegram", label: "تلگرام", placeholder: "username یا t.me/username", icon: Share2 },
  { key: "whatsapp", label: "واتساپ", placeholder: "شماره با 98 یا لینک wa.me", icon: Phone },
  { key: "website", label: "وب‌سایت", placeholder: "https://example.com", icon: Globe },
];

function DashboardInner() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const { theme } = useTheme();
  // GPS assist for the business location tab: prefill coordinates from the
  // device position, then let the owner fine-tune the pin on the existing map.
  const [gpsBusy, setGpsBusy] = useState(false);
  const [items, setItems] = useState<Phase2Business[]>([]);
  const [editing, setEditing] = useState<Phase2Business | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [social, setSocial] = useState<Social[]>([]);
  const [images, setImages] = useState<BusinessImage[]>([]);
  const [loading, setLoading] = useState(true);
  // Load failure is NOT an empty account: keep it separate so a slow/failed API
  // never renders the "no business" onboarding path.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [deleteImage, setDeleteImage] = useState<number | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  // STANDARD entitlement contract (useEntitlements): fetches
  // /businesses/{id}/entitlements and RE-SYNCS on mount + focus/visibility —
  // after a successful payment the panels see the new plan immediately
  // (stale-state fix: previously fetched once and never refreshed).
  const {
    entitlements: liveEntitlements,
    subscription,
    ready: entitlementsReady,
    error: entitlementsError,
    refresh: refreshEntitlements,
  } = useEntitlements(editing?.id);
  const entitlements: EntitlementPayload = liveEntitlements;
  const entitlementsStatus = entitlementsError ? (
    <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">
      <span>دریافت وضعیت اشتراک ناموفق بود: {entitlementsError}</span>
      <button type="button" className="mr-2 font-bold underline" onClick={refreshEntitlements}>تلاش دوباره</button>
    </div>
  ) : (
    <div role="status" className="rounded-xl border border-ik-border bg-ik-panel/70 p-3 text-xs text-ik-muted">
      در حال بررسی امکانات اشتراک…
    </div>
  );

  // Responsive sidebar & tabs
  const [currentTab, setCurrentTab] = useState<DashboardTab>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);

  const mediaForm = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getPublicTaxonomies("category")
        .then((rows) => {
          if (rows.length) setCategories(rows.map((row) => row.name));
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function choose(b: Phase2Business | null) {
    if (b) writeActiveBusinessId(b.id);
    setEditing(b);
    setLogo(null);
    setCover(null);
    setImages([]);
    setMessage(null);
    setDeleteImage(null);
    if (mediaForm.current) {
      mediaForm.current
        .querySelectorAll<HTMLInputElement>('input[type="file"]')
        .forEach((x) => (x.value = ""));
    }
    setForm(
      b
        ? {
            name: b.name,
            category: b.category || "",
            description: b.description || "",
            phone: b.phone || "",
            email: b.email || "",
            address: b.address || "",
            city: b.city || "",
            neighborhood: b.neighborhood || "",
            latitude: b.latitude == null ? "" : String(b.latitude),
            longitude: b.longitude == null ? "" : String(b.longitude),
            services: (b.services || []).join("\n"),
            designer_referral_code: b.designer?.referral_code || "",
          }
        : EMPTY,
    );
    const links = b?.social_links;
    setSocial(
      links
        ? Array.isArray(links)
          ? links.map((url, i) => ({ key: `link${i + 1}`, url }))
          : Object.entries(links).map(([key, url]) => ({ key, url: url || "" }))
        : [],
    );
  }

  function remember(b: Phase2Business) {
    setEditing(b);
    setItems((xs) => (xs.some((x) => x.id === b.id) ? xs.map((x) => (x.id === b.id ? b : x)) : [b, ...xs]));
  }

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // Keyed on the user ID, not the user object: AuthContext replaces the object
  // on every refreshUser() (avatar/username), which used to re-run this load and
  // snap the dashboard back to the first business, wiping the open form.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getOwnedBusinesses()
      .then((data) => {
        if (active) {
          setItems(data);
          setLoadError(null);
          choose(pickActiveBusiness(data));
          setOnboarding(data.length === 0);
        }
      })
      .catch((e) => {
        if (active) {
          setLoadError(extractApiError(e));
          setMessage({ text: extractApiError(e), error: true });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, reloadTick]);

  useEffect(() => {
    if (!editing?.id) return;
    let active = true;
    void (async () => {
      setGalleryLoading(true);
      try {
        const data = await getImages(editing.id);
        if (active) setImages(data);
      } catch (e) {
        if (active) setMessage({ text: extractApiError(e), error: true });
      } finally {
        if (active) setGalleryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [editing?.id]);

  const change = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  function payload(): BusinessInput {
    const links: Record<string, string> = Object.create(null);
    for (const row of social) {
      if (!row.url.trim()) continue;
      const clean = normalizeSocial(row.key, row.url);
      if (clean) links[row.key.trim() || `link_${Date.now()}`] = clean;
    }
    const services = form.services
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);

    return {
      name: form.name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      neighborhood: form.neighborhood.trim() || null,
      latitude: form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude === "" ? null : Number(form.longitude),
      services,
      social_links: links,
      designer_referral_code: form.designer_referral_code.trim() || null,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setMessage({ text: "لطفاً نام کسب‌وکار را وارد کنید.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    let profileSaved = false;
    try {
      let saved = await saveProfile(editing?.id || null, payload());
      remember(saved);
      profileSaved = true;
      if (logo || cover) {
        const data = new FormData();
        if (logo) data.append("logo", logo);
        if (cover) data.append("cover_image", cover);
        saved = await uploadProfileMedia(saved.id, data);
        remember(saved);
        setLogo(null);
        setCover(null);
        if (mediaForm.current) {
          mediaForm.current
            .querySelectorAll<HTMLInputElement>('input[type="file"]')
            .forEach((x) => (x.value = ""));
        }
      }
      setMessage({
        text:
          saved.status === "suspended"
            ? "اطلاعات ذخیره شد؛ تعلیق فقط توسط مدیر برداشته می‌شود."
            : "اطلاعات با موفقیت ذخیره شد. تغییرات پروفایل برای بررسی و انتشار به مدیر ارسال شد.",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setMessage({
        text: (profileSaved ? "پروفایل ذخیره شد ولی آپلود تصویر کامل نشد: " : "") + extractApiError(e),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshSelected(id: number) {
    const b = await getOwnedBusiness(id);
    remember(b);
    setImages(await getImages(id));
  }

  async function gallery(files: FileList | null) {
    if (!files?.length || !editing) return;
    const selected = Array.from(files);
    if (images.length + selected.length > 5) {
      setMessage({ text: "گالری تصاویر حداکثر می‌تواند ۵ تصویر داشته باشد.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    let added = 0;
    try {
      for (const file of selected) {
        await addImage(editing.id, file);
        added++;
      }
      setMessage({ text: `${added} تصویر با موفقیت به ویترین افزوده شد.` });
    } catch (e) {
      setMessage({ text: `${added} تصویر ثبت شد؛ ` + extractApiError(e), error: true });
    } finally {
      try {
        await refreshSelected(editing.id);
      } catch (e) {
        setMessage({ text: extractApiError(e), error: true });
      }
      setBusy(false);
    }
  }

  async function eraseImage(id: number) {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeImage(editing.id, id);
      await refreshSelected(editing.id);
      setDeleteImage(null);
      setMessage({ text: "تصویر از گالری حذف شد." });
    } catch (e) {
      setMessage({ text: extractApiError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function clearMedia(field: "logo" | "cover_image") {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = new FormData();
      data.append(`remove_${field}`, "1");
      remember(await uploadProfileMedia(editing.id, data));
      setMessage({ text: "تصویر با موفقیت حذف شد." });
    } catch (e) {
      setMessage({ text: extractApiError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = safeHttpUrl(editing?.public_url);
  const validPoint =
    form.latitude !== "" &&
    form.longitude !== "" &&
    Number.isFinite(Number(form.latitude)) &&
    Number.isFinite(Number(form.longitude)) &&
    Math.abs(Number(form.latitude)) <= 90 &&
    Math.abs(Number(form.longitude)) <= 180;

  // Calculate completion percentage
  let score = 0;
  if (form.name.trim()) score += 20;
  if (form.category.trim()) score += 15;
  if (form.phone.trim()) score += 15;
  if (validPoint) score += 20;
  if (editing?.logo || logo) score += 15;
  if (images.length > 0 || (editing?.cover_image || cover)) score += 15;
  const completionRate = Math.min(100, score);

  if (authLoading || loading || !user) {
    return (
      <div
        dir="rtl"
        data-theme={theme}
        className="dashboard-shell flex min-h-screen items-center justify-center bg-ik-bg text-ik-text"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-ik-accent" />
          <p className="text-xs sm:text-sm text-ik-muted font-medium">در حال بارگذاری پنل کسب‌وکار…</p>
        </div>
      </div>
    );
  }

  if (loadError && items.length === 0) {
    return (
      <div dir="rtl" data-theme={theme} className="dashboard-shell flex min-h-screen items-center justify-center bg-ik-bg text-ik-text">
        <div className="max-w-sm rounded-2xl border border-ik-border p-6 text-center">
          <p className="text-sm font-bold">دریافت اطلاعات کسب‌وکار ناموفق بود</p>
          <p className="mt-2 text-xs text-ik-muted">{loadError}</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-ik-accent px-5 py-2 text-sm font-bold text-white"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setReloadTick((n) => n + 1);
            }}
          >
            تلاش دوباره
          </button>
        </div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <div dir="rtl" data-theme={theme} className="dashboard-shell min-h-screen">
        <OnboardingView
          onSkip={() => setOnboarding(false)}
          onSelect={(path) => {
            setOnboarding(false);
            if (path === 1) router.push("/card-maker");
            if (path === 2) router.push("/card-maker");
            if (path === 3) router.push("/designer");
          }}
        />
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      data-theme={theme}
      className="dashboard-shell relative flex min-h-screen bg-ik-bg text-ik-text selection:bg-ik-accent/20 font-sans overflow-x-hidden"
    >
      {/* Dynamic ambient lighting in background — theme-aware via ik tokens */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 right-1/4 h-[500px] w-[500px] rounded-full bg-ik-accent/[0.05] blur-[140px]" />
        <div className="absolute top-1/3 -left-28 h-[600px] w-[600px] rounded-full bg-ik-success/[0.04] blur-[150px]" />
        <div className="absolute bottom-1/4 right-5 h-[450px] w-[450px] rounded-full bg-ik-accent/[0.03] blur-[130px]" />
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <DashboardSidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          userPhone={user.phone}
          username={user.username}
          userAvatar={user.avatar ? avatarUrl(user.avatar) : null}
          status={editing?.status}
          completionRate={completionRate}
          onLogout={() => void logout()}
        />
      </div>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-10 w-72 h-full flex flex-col">
            <DashboardSidebar
              currentTab={currentTab}
              onSelectTab={(tab) => {
                setCurrentTab(tab);
                setMobileSidebarOpen(false);
              }}
              collapsed={false}
              onToggleCollapse={() => setMobileSidebarOpen(false)}
              userPhone={user.phone}
              username={user.username}
              userAvatar={user.avatar ? avatarUrl(user.avatar) : null}
              status={editing?.status}
              completionRate={completionRate}
              onLogout={() => void logout()}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-10 pb-28 md:pb-24">
        {/* Top Navbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ik-border bg-ik-bg/85 px-4 sm:px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-ik-border bg-ik-wash text-ik-muted hover:text-ik-text md:hidden cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Business Selector Dropdown */}
            <div className="relative min-w-[190px] sm:min-w-[240px]">
              <select
                disabled={busy}
                value={editing?.id || ""}
                onChange={(e) =>
                  choose(items.find((x) => x.id === Number(e.target.value)) || null)
                }
                className="w-full appearance-none rounded-xl border border-ik-border bg-ik-panel/80 py-2 pl-8 pr-9 text-xs sm:text-sm font-semibold text-ik-text outline-none transition focus:border-ik-accent cursor-pointer"
              >
                <option value="">+ ثبت کسب‌وکار جدید</option>
                {items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Building2 className="absolute right-3 top-2.5 h-4 w-4 text-ik-accent pointer-events-none" />
              <ChevronDown className="absolute left-2.5 top-2.5 h-4 w-4 text-ik-muted pointer-events-none" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                choose(null);
                setCurrentTab("info");
              }}
              className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-ik-accent/30 bg-ik-accent/10 px-3 py-2 text-xs font-semibold text-ik-accent hover:bg-ik-accent/20 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>کسب‌وکار جدید</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {publicUrl && editing?.status === "approved" && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-ik-border bg-ik-wash px-3 py-2 text-xs font-medium text-ik-muted hover:text-ik-text hover:border-ik-accent/30 transition-colors"
              >
                <Globe className="h-3.5 w-3.5 text-ik-accent" />
                <span>مشاهده عمومی</span>
              </a>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void logout()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-ik-border bg-ik-wash px-2.5 sm:px-3 text-xs font-semibold text-ik-muted hover:border-ik-danger/40 hover:bg-ik-danger/10 hover:text-ik-danger cursor-pointer transition-colors"
              title="خروج از حساب"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </header>

        {/* Dynamic Page Container */}
        <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-6 sm:py-8 space-y-6">
          {/* One-time unique username claim (hidden once claimed). */}
          <UsernamePicker />

          {/* Global Alert Notification */}
          {message && (
            <div
              role={message.error ? "alert" : "status"}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-xs sm:text-sm animate-in fade-in ${
                message.error
                  ? "border-ik-danger/30 bg-ik-danger/10 text-ik-danger"
                  : "border-ik-success/30 bg-ik-success/10 text-ik-success"
              }`}
            >
              {message.error ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-ik-danger" />
              ) : (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-ik-success" />
              )}
              <div className="flex-1 font-medium leading-relaxed">{message.text}</div>
              <button
                type="button"
                onClick={() => setMessage(null)}
                className="text-ik-muted hover:text-ik-text cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* TAB 1: OVERVIEW (پیش‌خوان اصلی) */}
          {currentTab === "overview" && (
            <DashboardOverview
              business={editing}
              completionRate={completionRate}
              username={user.username}
              hasLocation={validPoint}
              hasImages={images.length > 0 || !!editing?.logo}
              imagesCount={images.length}
              publicUrl={publicUrl ?? undefined}
              onNavigateTab={setCurrentTab}
              onOpenQrModal={() => setShowQrModal(true)}
            />
          )}

          {currentTab === "subscriptions" && <SubscriptionPanel businessId={editing?.id} />}
          {currentTab === "notifications" && <NotificationsPanel />}

          {/* PAYMENT RESULT RETURN: the tab bar shows the live plan chip so a
              user coming back from the result page SEES the applied plan
              without hunting for it. Values come from the server snapshot. */}
          {entitlementsReady && subscription && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ik-border bg-ik-panel/70 px-4 py-3 text-xs">
              <span className="font-semibold text-ik-text">
                پلن فعلی: {subscription.plan_name ?? "—"}
              </span>
              <span className={
                subscription.effective_status === "active"
                  ? "rounded-lg border border-ik-success/30 bg-ik-success/10 px-2 py-0.5 font-bold text-ik-success"
                  : "rounded-lg border border-ik-border px-2 py-0.5 font-bold text-ik-muted"
              }>
                {subscription.effective_status === "active" ? "فعال" : "غیرفعال"}
              </span>
            </div>
          )}

          {/* PHASE 5: showcase & ads owner panels (entitlement mirrors). */}
          {currentTab === "showcase" && (entitlementsReady
            ? <ShowcasePanel businessId={editing?.id} entitlements={entitlements} />
            : entitlementsStatus)}
          {currentTab === "ads" && (entitlementsReady
            ? <AdsPanel businessId={editing?.id} entitlements={entitlements} />
            : entitlementsStatus)}

          {/* TAB 2: BUSINESS INFO & CONTACT (مشخصات و تماس) */}
          {currentTab === "info" && (
            <form onSubmit={submit} className="space-y-6">
              <section className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="border-b border-ik-border pb-4">
                  <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                    <Store className="h-5 w-5 text-ik-accent" />
                    <span>مشخصات اصلی و اطلاعات تماس</span>
                  </h2>
                  <p className="text-xs text-ik-muted mt-1">
                    این اطلاعات در نتایج جستجوی نقشه و صفحه اختصاصی فروشگاه نمایش داده می‌شوند.
                  </p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">
                      نام کسب‌وکار یا برند <span className="text-ik-danger">*</span>
                    </span>
                    <input
                      required
                      maxLength={120}
                      value={form.name}
                      onChange={(e) => change("name", e.target.value)}
                      placeholder="مثال: کافه رستوران گرگان‌مهر"
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">دسته‌بندی و صنف</span>
                    <input
                      list="categories-list"
                      maxLength={120}
                      value={form.category}
                      onChange={(e) => change("category", e.target.value)}
                      placeholder="انتخاب یا تایپ صنف..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                    <datalist id="categories-list">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>

                  {/* Categories quick pills */}
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5 -mt-2">
                    <span className="text-[11px] text-ik-muted">پیشنهادات سریع:</span>
                    {categories.slice(0, 6).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => change("category", cat)}
                        className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                          form.category === cat
                            ? "bg-ik-accent/20 text-ik-accent border border-ik-accent/40"
                            : "bg-ik-wash text-ik-muted border border-ik-border hover:text-ik-text"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-ik-muted" />
                      <span>شماره تماس عمومی</span>
                    </span>
                    <input
                      type="tel"
                      dir="ltr"
                      maxLength={30}
                      value={form.phone}
                      onChange={(e) => change("phone", e.target.value)}
                      placeholder="017... یا 0911..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 font-mono text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-ik-muted" />
                      <span>ایمیل کاری (اختیاری)</span>
                    </span>
                    <input
                      type="email"
                      dir="ltr"
                      maxLength={255}
                      value={form.email}
                      onChange={(e) => change("email", e.target.value)}
                      placeholder="info@business.ir"
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 font-mono text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">شهر</span>
                    <input
                      maxLength={120}
                      value={form.city}
                      onChange={(e) => change("city", e.target.value)}
                      placeholder="گرگان، گنبد کاووس، علی‌آباد..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">محله / منطقه</span>
                    <input
                      maxLength={120}
                      value={form.neighborhood}
                      onChange={(e) => change("neighborhood", e.target.value)}
                      placeholder="مثال: ناهارخوران، ولیعصر..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-ik-muted" />
                      <span>آدرس دقیق پستی</span>
                    </span>
                    <input
                      maxLength={1000}
                      value={form.address}
                      onChange={(e) => change("address", e.target.value)}
                      placeholder="خیابان، کوچه، پلاک، طبقه یا نشانی دقیق..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">
                      توضیحات و بیوگرافی کسب‌وکار
                    </span>
                    <textarea
                      rows={4}
                      maxLength={5000}
                      value={form.description}
                      onChange={(e) => change("description", e.target.value)}
                      placeholder="توضیح تاریخچه، ساعات کاری و زمینه فعالیت..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted">
                      فهرست خدمات و محصولات ویژه (هر کدام در یک خط)
                    </span>
                    <textarea
                      rows={3}
                      value={form.services}
                      onChange={(e) => change("services", e.target.value)}
                      placeholder="مثال:&#10;اینترنت رایگان&#10;فضای باز&#10;سفارش تلفنی"
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-ik-muted flex items-center justify-between">
                      <span>کد معرف طراح (اختیاری — فاز ۴)</span>
                      {editing?.designer && (
                        <span className="text-[11px] text-ik-success font-medium">
                          منتسب به: {editing.designer.display_name} ({editing.designer.referral_code})
                        </span>
                      )}
                    </span>
                    <input
                      maxLength={32}
                      value={form.designer_referral_code}
                      onChange={(e) => change("designer_referral_code", e.target.value)}
                      placeholder="در صورت معرفی توسط طراح، کد معرف را وارد نمایید (مثال: DES-A84K1)"
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-4 py-2.5 text-sm text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent font-mono"
                    />
                  </label>
                </div>
              </section>

              {/* Social Channels Section */}
              <section className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ik-border pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                      <Share2 className="h-5 w-5 text-ik-accent" />
                      <span>شبکه‌های اجتماعی و پیام‌رسان‌ها</span>
                    </h2>
                    <p className="text-xs text-ik-muted mt-1">
                      پیوندهای ارتباطی برای دسترسی مستقیم کاربران به کانال‌ها و صفحات مجازی شما.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRESET_SOCIALS.map((p) => {
                      const alreadyHas = social.some((s) => s.key.toLowerCase() === p.key);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={alreadyHas || social.length >= 10}
                          onClick={() => setSocial((xs) => [...xs, { key: p.key, url: "" }])}
                          className="inline-flex items-center gap-1 rounded-lg border border-ik-border bg-ik-wash px-2.5 py-1 text-[11px] text-ik-muted hover:text-ik-text disabled:opacity-40 cursor-pointer transition-colors"
                        >
                          <p.icon className="h-3 w-3 text-ik-accent" />
                          <span>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  {social.map((row, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-ik-border bg-ik-panel-soft/40 p-3"
                    >
                      <input
                        dir="ltr"
                        maxLength={40}
                        value={row.key}
                        placeholder="instagram, telegram..."
                        onChange={(e) =>
                          setSocial((xs) =>
                            xs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                          )
                        }
                        className="ik-field sm:w-44 rounded-lg border border-ik-border bg-ik-wash px-3 py-1.5 font-mono text-xs text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                      />

                      <input
                        dir="ltr"
                        maxLength={500}
                        value={row.url}
                        placeholder="https://... یا username"
                        onChange={(e) =>
                          setSocial((xs) =>
                            xs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                          )
                        }
                        className="ik-field flex-1 rounded-lg border border-ik-border bg-ik-wash px-3 py-1.5 font-mono text-xs text-ik-text placeholder:text-ik-muted outline-none focus:border-ik-accent"
                      />

                      <button
                        type="button"
                        onClick={() => setSocial((xs) => xs.filter((_, j) => j !== i))}
                        className="self-end sm:self-center inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ik-danger/20 bg-ik-danger/10 text-ik-danger hover:bg-ik-danger/20 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    disabled={social.length >= 10}
                    onClick={() => setSocial((xs) => [...xs, { key: "", url: "" }])}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ik-border bg-ik-wash px-3.5 py-2 text-xs font-semibold text-ik-muted hover:text-ik-text cursor-pointer transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>افزودن پیوند ارتباطی جدید</span>
                  </button>
                </div>
              </section>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ik-accent px-8 text-xs sm:text-sm font-bold text-ik-accent-contrast shadow-md transition-all hover:bg-ik-accent-hover active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{busy ? "در حال ذخیره‌سازی..." : "ذخیره مشخصات کسب‌وکار"}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: LOCATION & MAP PICKER (موقعیت روی نقشه) */}
          {currentTab === "location" && (
            <form onSubmit={submit} className="space-y-6">
              <section className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ik-border pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-ik-accent" />
                      <span>موقعیت جغرافیایی روی نقشه</span>
                    </h2>
                    <p className="text-xs text-ik-muted mt-1">
                      با جست‌وجوی شهر/آدرس، GPS یا کلیک روی نقشه، مکان دقیق مغازه یا شرکت خود را مشخص کنید تا در مسیریابی و جستجوی کاربران دیده شود.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={gpsBusy || busy}
                      onClick={() => {
                        if (typeof window === "undefined" || !("geolocation" in navigator)) {
                          setMessage({ text: "مرورگر شما از موقعیت‌یاب پشتیبانی نمی‌کند.", error: true });
                          return;
                        }
                        setGpsBusy(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setForm((f) => ({
                              ...f,
                              latitude: pos.coords.latitude.toFixed(7),
                              longitude: pos.coords.longitude.toFixed(7),
                            }));
                            setGpsBusy(false);
                            setMessage({ text: "موقعیت از GPS ثبت شد — پین را روی نقشه با دقت بیشتری تنظیم کنید." });
                          },
                          () => {
                            setGpsBusy(false);
                            setMessage({ text: "دریافت موقعیت ناموفق بود — پین را دستی روی نقشه کلیک کنید.", error: true });
                          },
                          { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ik-accent/30 bg-ik-accent/10 px-3 py-2 text-xs font-semibold text-ik-accent hover:bg-ik-accent/20 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Crosshair className={`h-3.5 w-3.5 ${gpsBusy ? "animate-spin" : ""}`} />
                      <span>{gpsBusy ? "در حال یافتن موقعیت…" : "یافتن با GPS"}</span>
                    </button>
                    {validPoint && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, latitude: "", longitude: "" }))}
                        className="text-xs font-semibold text-ik-danger hover:underline cursor-pointer"
                      >
                        پاک‌کردن پین نقشه
                      </button>
                    )}
                  </div>
                </div>

                {/* Address/city search — jumps the map to the picked point,
                    then the user fine-tunes with a map click (GPS button above
                    and manual pin picking stay untouched). */}
                <div className="space-y-1">
                  <LocationSearch
                    disabled={busy}
                    onSelect={(r: LocationSearchResult) => {
                      setForm((f) => ({
                        ...f,
                        latitude: r.lat.toFixed(7),
                        longitude: r.lng.toFixed(7),
                        // Auto-fill the city field when the result identifies one
                        // (never overwrite a non-empty city the user typed).
                        city: f.city ? f.city : r.city || "",
                      }));
                      setMessage({
                        text: `موقعیت روی «${r.label}» تنظیم شد — پین را روی نقشه با دقت بیشتری تنظیم کنید.`,
                      });
                    }}
                  />
                  <p className="text-[11px] text-ik-muted">
                    نام شهر یا آدرس را بنویسید و از نتایج انتخاب کنید تا نقشه به همان نقطه پرش کند.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-ik-muted">عرض جغرافیایی (Latitude)</span>
                    <input
                      type="number"
                      min={-90}
                      max={90}
                      step="any"
                      dir="ltr"
                      value={form.latitude}
                      onChange={(e) => change("latitude", e.target.value)}
                      placeholder="36.8387..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-3.5 py-2 font-mono text-sm text-ik-text outline-none focus:border-ik-accent"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-ik-muted">طول جغرافیایی (Longitude)</span>
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step="any"
                      dir="ltr"
                      value={form.longitude}
                      onChange={(e) => change("longitude", e.target.value)}
                      placeholder="54.4348..."
                      className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash px-3.5 py-2 font-mono text-sm text-ik-text outline-none focus:border-ik-accent"
                    />
                  </label>
                </div>

                {/* Map Viewer */}
                <div className="relative isolate overflow-hidden rounded-2xl border border-ik-border shadow-inner">
                  <MapView
                    className="h-[400px] w-full"
                    markers={
                      validPoint
                        ? [
                            {
                              id: "picked",
                              title: form.name || "موقعیت کسب‌وکار",
                              latitude: Number(form.latitude),
                              longitude: Number(form.longitude),
                            },
                          ]
                        : []
                    }
                    onPick={
                      busy
                        ? undefined
                        : (lat, lng) =>
                            setForm((f) => ({
                              ...f,
                              latitude: lat.toFixed(7),
                              longitude: lng.toFixed(7),
                            }))
                    }
                  />
                </div>

                <p className="text-xs text-ik-muted text-center">
                  روی هر نقطه‌ای از نقشه کلیک کنید، پین مکان فروشگاه شما در همان نقطه تنظیم می‌شود.
                </p>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ik-accent px-8 text-xs sm:text-sm font-bold text-ik-accent-contrast shadow-md transition-all hover:bg-ik-accent-hover active:scale-98 disabled:opacity-50 cursor-pointer"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span>{busy ? "در حال ذخیره‌سازی..." : "ذخیره موقعیت نقشه"}</span>
                  </button>
                </div>
              </section>
            </form>
          )}

          {/* TAB 4: LOGO & MEDIA GALLERY (لوگو و تصاویر گالری) */}
          {currentTab === "media" && (
            <div className="space-y-6">
              {/* Branding Section (Logo & Cover) */}
              <form onSubmit={submit}>
                <section
                  className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6"
                  ref={mediaForm}
                >
                  <div className="border-b border-ik-border pb-4">
                    <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-ik-accent" />
                      <span>هویت بصری (لوگو و تصویر کاور)</span>
                    </h2>
                    <p className="text-xs text-ik-muted mt-1">
                      لوگو و تصویر بنر اصلی فروشگاه شما در صفحه اختصاصی نمایش داده خواهند شد.
                    </p>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    {/* Logo */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-ik-muted">لوگوی اختصاصی</span>
                      <div className="flex items-center gap-4 rounded-2xl border border-ik-border bg-ik-panel-soft/40 p-4">
                        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ik-border bg-ik-bg">
                          {mediaUrl(editing?.logo) ? (
                            <Image
                              src={mediaUrl(editing?.logo)!}
                              alt="لوگو"
                              fill
                              className="object-contain p-1"
                              sizes="80px"
                            />
                          ) : (
                            <Building2 className="h-8 w-8 text-ik-muted" />
                          )}
                        </div>

                        <div className="space-y-2 min-w-0 flex-1">
                          <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-ik-border bg-ik-wash px-3 py-1.5 text-xs font-semibold text-ik-text hover:bg-ik-wash-hover cursor-pointer transition-colors">
                            <UploadCloud className="h-3.5 w-3.5 text-ik-accent" />
                            <span>{logo ? logo.name : "انتخاب فایل لوگو"}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={busy}
                              onChange={(e) => setLogo(e.target.files?.[0] || null)}
                              className="hidden"
                            />
                          </label>
                          <p className="text-[10px] text-ik-muted">حداکثر ۲ مگابایت (PNG یا JPG)</p>
                          {editing?.logo && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void clearMedia("logo")}
                              className="text-[11px] text-ik-danger hover:underline cursor-pointer block"
                            >
                              حذف لوگوی فعلی
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Cover Banner */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-ik-muted">تصویر کاور (بنر بالای صفحه)</span>
                      <div className="flex flex-col gap-3 rounded-2xl border border-ik-border bg-ik-panel-soft/40 p-4">
                        <div className="relative h-20 w-full overflow-hidden rounded-xl border border-ik-border bg-ik-bg">
                          {mediaUrl(editing?.cover_image) ? (
                            <Image
                              src={mediaUrl(editing?.cover_image)!}
                              alt="کاور"
                              fill
                              className="object-cover"
                              sizes="400px"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[11px] text-ik-muted">
                              بدون بنر کاور
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-ik-border bg-ik-wash px-3 py-1.5 text-xs font-semibold text-ik-text hover:bg-ik-wash-hover cursor-pointer transition-colors">
                            <UploadCloud className="h-3.5 w-3.5 text-ik-accent" />
                            <span>{cover ? cover.name : "انتخاب فایل کاور"}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={busy}
                              onChange={(e) => setCover(e.target.files?.[0] || null)}
                              className="hidden"
                            />
                          </label>

                          {editing?.cover_image && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void clearMedia("cover_image")}
                              className="text-[11px] text-ik-danger hover:underline cursor-pointer"
                            >
                              حذف کاور
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ik-accent px-8 text-xs sm:text-sm font-bold text-ik-accent-contrast shadow-md transition-all hover:bg-ik-accent-hover active:scale-98 disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span>{busy ? "در حال ذخیره‌سازی..." : "ذخیره لوگو و کاور"}</span>
                    </button>
                  </div>
                </section>
              </form>

              {/* Showcase Gallery Section */}
              <section className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-ik-border pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                      <Camera className="h-5 w-5 text-ik-accent" />
                      <span>گالری تصاویر نمونه‌کارها و محیط کسب‌وکار</span>
                    </h2>
                    <p className="text-xs text-ik-muted mt-1">
                      می‌توانید تا سقف ۵ تصویر باکیفیت برای جذب بیشتر مشتریان بارگذاری کنید.
                    </p>
                  </div>

                  <span className="text-xs font-semibold text-ik-muted">
                    {images.length} از ۵ تصویر
                  </span>
                </div>

                {!editing ? (
                  <div className="rounded-xl border border-ik-border bg-ik-panel-soft/40 p-6 text-center text-xs text-ik-muted">
                    برای فعال‌سازی گالری، ابتدا در تب مشخصات، کسب‌وکار خود را یک بار ذخیره فرمایید.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {images.length < 5 && (
                      <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ik-border bg-ik-panel-soft/40 p-6 text-center cursor-pointer transition-all hover:border-ik-accent/50">
                        <UploadCloud className="h-6 w-6 text-ik-accent mb-2" />
                        <span className="text-xs sm:text-sm font-semibold text-ik-text">
                          انتخاب یا رهاسازی تصاویر در این قسمت
                        </span>
                        <span className="mt-1 text-[11px] text-ik-muted">
                          فرمت‌های JPG، PNG یا WebP تا سقف ۵ مگابایت
                        </span>
                        <input
                          disabled={busy || galleryLoading || images.length >= 5}
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            void gallery(e.target.files);
                            e.target.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                    )}

                    {galleryLoading ? (
                      <div className="flex h-32 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-ik-accent" />
                      </div>
                    ) : images.length === 0 ? (
                      <p className="py-6 text-center text-xs text-ik-muted">
                        هنوز تصویری در گالری ثبت نکرده‌اید.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                        {images.map((image) => {
                          const url = mediaUrl(image.path);
                          const isDeleting = deleteImage === image.id;

                          return (
                            <div
                              key={image.id}
                              className="group relative flex flex-col overflow-hidden rounded-xl border border-ik-border bg-ik-bg shadow-sm"
                            >
                              <div className="relative aspect-square w-full">
                                {url ? (
                                  <Image
                                    src={url}
                                    alt="تصویر گالری"
                                    fill
                                    className="object-cover"
                                    sizes="200px"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-ik-muted text-xs">
                                    بدون تصویر
                                  </div>
                                )}
                              </div>

                              <div className="p-2 border-t border-ik-border bg-ik-panel/90">
                                {isDeleting ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void eraseImage(image.id)}
                                      className="flex-1 rounded bg-ik-danger py-1 text-[10px] font-bold text-ik-accent-contrast cursor-pointer"
                                    >
                                      حذف
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => setDeleteImage(null)}
                                      className="flex-1 rounded bg-ik-panel-hover py-1 text-[10px] text-ik-muted cursor-pointer"
                                    >
                                      انصراف
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setDeleteImage(image.id)}
                                    className="flex w-full items-center justify-center gap-1 rounded-lg border border-ik-border bg-ik-wash py-1 text-[11px] text-ik-danger hover:bg-ik-danger/10 cursor-pointer transition-colors"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    <span>حذف</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 5: PUBLIC PROFILE & QR CODE (تعهد مستقیم فاز ۲ قرارداد) */}
          {currentTab === "qr" && (
            <section className="rounded-3xl border border-ik-border bg-ik-panel/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
              <div className="border-b border-ik-border pb-4">
                <h2 className="text-base sm:text-lg font-bold text-ik-text flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-ik-accent" />
                  <span>صفحه اختصاصی عمومی و کد QR (تعهد فاز ۲ قرارداد)</span>
                </h2>
                <p className="text-xs text-ik-muted mt-1">
                  کسب‌وکار شما یک لینک عمومی مستقل دارد که با اسکن این بارکد، مشتریان بدون واسطه وارد نمایه شما می‌شوند.
                </p>
              </div>

              {!editing ? (
                <div className="rounded-xl border border-ik-border bg-ik-panel-soft/40 p-6 text-center text-xs text-ik-muted">
                  برای تولید بارکد QR اختصاصی، ابتدا یک کسب‌وکار ثبت یا انتخاب فرمایید.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-8 items-center">
                  {/* Left: QR Display Box */}
                  <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-ik-border bg-ik-bg/70 text-center space-y-4">
                    <div className="rounded-2xl border-4 border-white bg-white p-3 shadow-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getQrUrl(editing.slug)}
                        alt="QR اختصاصی"
                        width={200}
                        height={200}
                        className="mx-auto"
                      />
                    </div>

                    <div>
                      <span className="text-xs font-bold text-ik-text">بارکد استند چاپی</span>
                      <p className="text-[11px] text-ik-muted mt-0.5">
                        مناسب برای چاپ روی استند رومیزی مغازه، فاکتور و کارت ویزیت
                      </p>
                    </div>

                    <a
                      href={getQrUrl(editing.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-ik-accent hover:bg-ik-accent-hover px-5 py-2 text-xs font-bold text-ik-accent-contrast transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>دانلود مستقیم تصویر QR</span>
                    </a>
                  </div>

                  {/* Right: Link & Details */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-ik-border bg-ik-panel-soft/40 p-5 space-y-2">
                      <span className="text-xs font-semibold text-ik-muted">آدرس صفحه عمومی مستقل:</span>
                      {publicUrl ? (
                        <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-ik-border bg-ik-panel font-mono text-xs text-ik-accent" dir="ltr">
                          <span className="truncate">{publicUrl}</span>
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ik-muted hover:text-ik-text shrink-0"
                            title="باز کردن صفحه"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs text-ik-warning">
                          پس از تایید اولیه مدیر، آدرس صفحه فعال می‌شود.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-ik-border bg-ik-panel-soft/40 p-5 space-y-2">
                      <h4 className="text-xs font-bold text-ik-text">وضعیت تاییدیه در فاز ۲:</h4>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                            editing.status === "approved"
                              ? "bg-ik-success/15 text-ik-success border-ik-success/30"
                              : editing.status === "pending"
                              ? "bg-ik-warning/15 text-ik-warning border-ik-warning/30"
                              : "bg-ik-danger/15 text-ik-danger border-ik-danger/30"
                          }`}
                        >
                          {statusLabel[editing.status] || editing.status}
                        </span>
                        {editing.moderation_note && (
                          <span className="text-xs text-ik-warning">
                            (یادداشت مدیر: {editing.moderation_note})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Phase 4: Card Maker & Print File summary */}
                    <div className="rounded-2xl border border-ik-border bg-ik-panel-soft/40 p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-ik-text flex items-center gap-1.5">
                          <CreditCard className="h-4 w-4 text-ik-accent" />
                          <span>طرح کارت ویزیت و فایل چاپی (فاز ۴)</span>
                        </h4>
                        <Link
                          href="/card-maker"
                          className="rounded-lg bg-ik-accent hover:bg-ik-accent-hover px-3 py-1 text-xs font-bold text-ik-accent-contrast transition-colors"
                        >
                          مدیریت در کارت‌ساز
                        </Link>
                      </div>
                      {editing?.cards && (editing.cards[0]?.has_print_file || editing.cards[0]?.print_file_path) ? (
                        <div className="rounded-xl border border-ik-border bg-ik-bg/50 p-3 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-ik-text truncate">
                              {editing.cards[0].print_file_name || "فایل طرح چاپی فیزیکی"}
                            </p>
                            <p className="text-[10px] text-ik-muted mt-0.5">
                              {editing.cards[0].print_file_mime || "نگهداری شده در سرور (دسترسی خصوصی)"}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!editing) return;
                              setMessage(null);
                              downloadPrintFile(editing.id)
                                .then(() => setMessage({ text: "دانلود فایل طرح چاپی آغاز شد." }))
                                .catch(() => setMessage({ text: "دانلود فایل چاپی ناموفق بود — دوباره تلاش کنید.", error: true }));
                            }}
                            className="text-xs text-ik-accent hover:underline font-bold shrink-0 mr-2"
                          >
                            دانلود
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-ik-muted">
                          هنوز فایل طرح چاپی آپلود نشده است. برای طراحی آنلاین کارت یا بارگذاری تصویر/PDF طرح چاپی موجود، به بخش کارت‌ساز مراجعه کنید.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Floating quick actions (accent-colored) */}
      <DashboardFab hasBusiness={!!editing} />

      {/* Standalone QR Modal */}
      {showQrModal && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-3xl border border-ik-border bg-ik-panel p-6 text-center shadow-2xl space-y-4">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-ik-border bg-ik-wash text-ik-muted hover:text-ik-text cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="text-base font-bold text-ik-text">بارکد QR اختصاصی فروشگاه</h3>
            <p className="text-xs text-ik-muted">
              این کد را پرینت کنید یا در شبکه‌های اجتماعی بگذارید تا مراجعین با دوربین گوشی مستقیماً وارد صفحه شما شوند.
            </p>

            <div className="flex justify-center py-2">
              <div className="rounded-2xl border-4 border-white bg-white p-3 shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getQrUrl(editing.slug)}
                  alt="QR اختصاصی"
                  width={180}
                  height={180}
                  className="mx-auto"
                />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <a
                href={getQrUrl(editing.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-ik-accent hover:bg-ik-accent-hover px-5 py-2.5 text-xs font-bold text-ik-accent-contrast transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>دانلود بارکد چاپی</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard — theme is scoped to this page via the ThemeProvider above the
 * shell div. Pages outside /dashboard never receive the provider, so their
 * visuals are untouched.
 */
export default function Dashboard() {
  return (
    <ThemeProvider>
      <DashboardInner />
    </ThemeProvider>
  );
}
