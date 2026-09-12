"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { getQrUrl } from "@/lib/businesses";
import { OnboardingView } from "@/components/dashboard/OnboardingView";
import { DashboardSidebar, type DashboardTab } from "@/components/dashboard/DashboardSidebar";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import MapViewLazy from "@/components/map/MapViewLazy";
import {
  addImage,
  badgeLabel,
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
  Clock,
  QrCode,
  Sparkles,
  LogOut,
  CreditCard,
  ChevronDown,
  X,
  Loader2,
  Image as ImageIcon,
  Share2,
  Home,
  Store,
  Layers,
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
};

const CATEGORIES = [
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

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Phase2Business[]>([]);
  const [editing, setEditing] = useState<Phase2Business | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [social, setSocial] = useState<Social[]>([]);
  const [images, setImages] = useState<BusinessImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [deleteImage, setDeleteImage] = useState<number | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  
  // Responsive sidebar & tabs
  const [currentTab, setCurrentTab] = useState<DashboardTab>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const mediaForm = useRef<HTMLDivElement>(null);

  function choose(b: Phase2Business | null) {
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

  useEffect(() => {
    if (!user) return;
    let active = true;
    getOwnedBusinesses()
      .then((data) => {
        if (active) {
          setItems(data);
          choose(data[0] || null);
          setOnboarding(data.length === 0);
        }
      })
      .catch((e) => {
        if (active) setMessage({ text: extractApiError(e), error: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

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
      <div className="flex min-h-screen items-center justify-center bg-[#070d18] text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <p className="text-xs sm:text-sm text-slate-400 font-medium">در حال بارگذاری پنل کسب‌وکار…</p>
        </div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <OnboardingView
        onSkip={() => setOnboarding(false)}
        onSelect={(path) => {
          setOnboarding(false);
          if (path === 2) router.push("/card-maker");
          if (path === 3) router.push("/designer");
        }}
      />
    );
  }

  return (
    <div dir="rtl" className="relative flex min-h-screen bg-[#070b14] text-slate-100 selection:bg-cyan-500/20 font-sans overflow-x-hidden">
      {/* Dynamic ambient lighting in background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 right-1/4 h-[500px] w-[500px] rounded-full bg-cyan-500/[0.05] blur-[140px]" />
        <div className="absolute top-1/3 -left-28 h-[600px] w-[600px] rounded-full bg-emerald-500/[0.04] blur-[150px]" />
        <div className="absolute bottom-1/4 right-5 h-[450px] w-[450px] rounded-full bg-blue-600/[0.03] blur-[130px]" />
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <DashboardSidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          userPhone={user.phone}
          businessName={editing?.name}
          businessSlug={editing?.slug}
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
              businessName={editing?.name}
              businessSlug={editing?.slug}
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#070b14]/85 px-4 sm:px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:text-white md:hidden cursor-pointer"
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
                className="w-full appearance-none rounded-xl border border-white/10 bg-slate-900/80 py-2 pl-8 pr-9 text-xs sm:text-sm font-semibold text-white outline-none transition focus:border-cyan-400 cursor-pointer"
              >
                <option value="">+ ثبت کسب‌وکار جدید</option>
                {items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Building2 className="absolute right-3 top-2.5 h-4 w-4 text-cyan-400 pointer-events-none" />
              <ChevronDown className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                choose(null);
                setCurrentTab("info");
              }}
              className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors cursor-pointer whitespace-nowrap"
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
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:border-white/20 transition-colors"
              >
                <Globe className="h-3.5 w-3.5 text-cyan-400" />
                <span>مشاهده عمومی</span>
              </a>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void logout()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 sm:px-3 text-xs font-medium text-rose-300 hover:bg-rose-500/20 cursor-pointer transition-colors"
              title="خروج از حساب"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </header>

        {/* Dynamic Page Container */}
        <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-6 sm:py-8 space-y-6">
          {/* Global Alert Notification */}
          {message && (
            <div
              role={message.error ? "alert" : "status"}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-xs sm:text-sm animate-in fade-in ${
                message.error
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {message.error ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              )}
              <div className="flex-1 font-medium leading-relaxed">{message.text}</div>
              <button
                type="button"
                onClick={() => setMessage(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
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
              userPhone={user.phone}
              hasLocation={validPoint}
              hasImages={images.length > 0 || !!editing?.logo}
              imagesCount={images.length}
              publicUrl={publicUrl}
              onNavigateTab={setCurrentTab}
              onOpenQrModal={() => setShowQrModal(true)}
            />
          )}

          {/* TAB 2: BUSINESS INFO & CONTACT (مشخصات و تماس) */}
          {currentTab === "info" && (
            <form onSubmit={submit} className="space-y-6">
              <section className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="border-b border-white/5 pb-4">
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <Store className="h-5 w-5 text-cyan-400" />
                    <span>مشخصات اصلی و اطلاعات تماس</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    این اطلاعات در نتایج جستجوی نقشه و صفحه اختصاصی فروشگاه نمایش داده می‌شوند.
                  </p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      نام کسب‌وکار یا برند <span className="text-rose-400">*</span>
                    </span>
                    <input
                      required
                      maxLength={120}
                      value={form.name}
                      onChange={(e) => change("name", e.target.value)}
                      placeholder="مثال: کافه رستوران گرگان‌مهر"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">دسته‌بندی و صنف</span>
                    <input
                      list="categories-list"
                      maxLength={120}
                      value={form.category}
                      onChange={(e) => change("category", e.target.value)}
                      placeholder="انتخاب یا تایپ صنف..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                    <datalist id="categories-list">
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>

                  {/* Categories quick pills */}
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5 -mt-2">
                    <span className="text-[11px] text-slate-400">پیشنهادات سریع:</span>
                    {CATEGORIES.slice(0, 6).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => change("category", cat)}
                        className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                          form.category === cat
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                            : "bg-white/5 text-slate-400 border border-white/10 hover:text-white"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <span>شماره تماس عمومی</span>
                    </span>
                    <input
                      type="tel"
                      dir="ltr"
                      maxLength={30}
                      value={form.phone}
                      onChange={(e) => change("phone", e.target.value)}
                      placeholder="017... یا 0911..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 font-mono text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span>ایمیل کاری (اختیاری)</span>
                    </span>
                    <input
                      type="email"
                      dir="ltr"
                      maxLength={255}
                      value={form.email}
                      onChange={(e) => change("email", e.target.value)}
                      placeholder="info@business.ir"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 font-mono text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">شهر</span>
                    <input
                      maxLength={120}
                      value={form.city}
                      onChange={(e) => change("city", e.target.value)}
                      placeholder="گرگان، گنبد کاووس، علی‌آباد..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">محله / منطقه</span>
                    <input
                      maxLength={120}
                      value={form.neighborhood}
                      onChange={(e) => change("neighborhood", e.target.value)}
                      placeholder="مثال: ناهارخوران، ولیعصر..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <span>آدرس دقیق پستی</span>
                    </span>
                    <input
                      maxLength={1000}
                      value={form.address}
                      onChange={(e) => change("address", e.target.value)}
                      placeholder="خیابان، کوچه، پلاک، طبقه یا نشانی دقیق..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      توضیحات و بیوگرافی کسب‌وکار
                    </span>
                    <textarea
                      rows={4}
                      maxLength={5000}
                      value={form.description}
                      onChange={(e) => change("description", e.target.value)}
                      placeholder="توضیح تاریخچه، ساعات کاری و زمینه فعالیت..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="sm:col-span-2 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      فهرست خدمات و محصولات ویژه (هر کدام در یک خط)
                    </span>
                    <textarea
                      rows={3}
                      value={form.services}
                      onChange={(e) => change("services", e.target.value)}
                      placeholder="مثال:&#10;اینترنت رایگان&#10;فضای باز&#10;سفارش تلفنی"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                    />
                  </label>
                </div>
              </section>

              {/* Social Channels Section */}
              <section className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <Share2 className="h-5 w-5 text-cyan-400" />
                      <span>شبکه‌های اجتماعی و پیام‌رسان‌ها</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
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
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer transition-colors"
                        >
                          <p.icon className="h-3 w-3 text-cyan-400" />
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
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-white/[0.06] bg-slate-950/40 p-3"
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
                        className="sm:w-44 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
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
                        className="flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                      />

                      <button
                        type="button"
                        onClick={() => setSocial((xs) => xs.filter((_, j) => j !== i))}
                        className="self-end sm:self-center inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    disabled={social.length >= 10}
                    onClick={() => setSocial((xs) => [...xs, { key: "", url: "" }])}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer transition-colors"
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
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-8 text-xs sm:text-sm font-bold text-slate-950 shadow-md transition-all hover:brightness-110 active:scale-98 disabled:opacity-50 cursor-pointer"
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
              <section className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-cyan-400" />
                      <span>موقعیت جغرافیایی روی نقشه</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      با کلیک روی نقشه، مکان دقیق مغازه یا شرکت خود را مشخص کنید تا در مسیریابی و جستجوی کاربران دیده شود.
                    </p>
                  </div>

                  {validPoint && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, latitude: "", longitude: "" }))}
                      className="text-xs font-semibold text-rose-400 hover:underline cursor-pointer"
                    >
                      پاک‌کردن پین نقشه
                    </button>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300">عرض جغرافیایی (Latitude)</span>
                    <input
                      type="number"
                      min={-90}
                      max={90}
                      step="any"
                      dir="ltr"
                      value={form.latitude}
                      onChange={(e) => change("latitude", e.target.value)}
                      placeholder="36.8387..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300">طول جغرافیایی (Longitude)</span>
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step="any"
                      dir="ltr"
                      value={form.longitude}
                      onChange={(e) => change("longitude", e.target.value)}
                      placeholder="54.4348..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400"
                    />
                  </label>
                </div>

                {/* Map Viewer */}
                <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 shadow-inner">
                  <MapViewLazy
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

                <p className="text-xs text-slate-400 text-center">
                  روی هر نقطه‌ای از نقشه کلیک کنید، پین مکان فروشگاه شما در همان نقطه تنظیم می‌شود.
                </p>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-8 text-xs sm:text-sm font-bold text-slate-950 shadow-md transition-all hover:brightness-110 active:scale-98 disabled:opacity-50 cursor-pointer"
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
                  className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6"
                  ref={mediaForm}
                >
                  <div className="border-b border-white/5 pb-4">
                    <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-cyan-400" />
                      <span>هویت بصری (لوگو و تصویر کاور)</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      لوگو و تصویر بنر اصلی فروشگاه شما در صفحه اختصاصی نمایش داده خواهند شد.
                    </p>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    {/* Logo */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300">لوگوی اختصاصی</span>
                      <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-slate-950/40 p-4">
                        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                          {mediaUrl(editing?.logo) ? (
                            <Image
                              src={mediaUrl(editing?.logo)!}
                              alt="لوگو"
                              fill
                              className="object-contain p-1"
                              sizes="80px"
                            />
                          ) : (
                            <Building2 className="h-8 w-8 text-slate-600" />
                          )}
                        </div>

                        <div className="space-y-2 min-w-0 flex-1">
                          <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white cursor-pointer transition-colors">
                            <UploadCloud className="h-3.5 w-3.5 text-cyan-400" />
                            <span>{logo ? logo.name : "انتخاب فایل لوگو"}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={busy}
                              onChange={(e) => setLogo(e.target.files?.[0] || null)}
                              className="hidden"
                            />
                          </label>
                          <p className="text-[10px] text-slate-400">حداکثر ۲ مگابایت (PNG یا JPG)</p>
                          {editing?.logo && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void clearMedia("logo")}
                              className="text-[11px] text-rose-400 hover:underline cursor-pointer block"
                            >
                              حذف لوگوی فعلی
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Cover Banner */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300">تصویر کاور (بنر بالای صفحه)</span>
                      <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-slate-950/40 p-4">
                        <div className="relative h-20 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                          {mediaUrl(editing?.cover_image) ? (
                            <Image
                              src={mediaUrl(editing?.cover_image)!}
                              alt="کاور"
                              fill
                              className="object-cover"
                              sizes="400px"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
                              بدون بنر کاور
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white cursor-pointer transition-colors">
                            <UploadCloud className="h-3.5 w-3.5 text-cyan-400" />
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
                              className="text-[11px] text-rose-400 hover:underline cursor-pointer"
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
                      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-8 text-xs sm:text-sm font-bold text-slate-950 shadow-md transition-all hover:brightness-110 active:scale-98 disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span>{busy ? "در حال ذخیره‌سازی..." : "ذخیره لوگو و کاور"}</span>
                    </button>
                  </div>
                </section>
              </form>

              {/* Showcase Gallery Section */}
              <section className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <Camera className="h-5 w-5 text-cyan-400" />
                      <span>گالری تصاویر نمونه‌کارها و محیط کسب‌وکار</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      می‌توانید تا سقف ۵ تصویر باکیفیت برای جذب بیشتر مشتریان بارگذاری کنید.
                    </p>
                  </div>

                  <span className="text-xs font-semibold text-slate-400">
                    {images.length} از ۵ تصویر
                  </span>
                </div>

                {!editing ? (
                  <div className="rounded-xl border border-white/[0.06] bg-slate-950/40 p-6 text-center text-xs text-slate-400">
                    برای فعال‌سازی گالری، ابتدا در تب مشخصات، کسب‌وکار خود را یک بار ذخیره فرمایید.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {images.length < 5 && (
                      <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-slate-950/40 p-6 text-center cursor-pointer transition-all hover:border-cyan-400/50">
                        <UploadCloud className="h-6 w-6 text-cyan-400 mb-2" />
                        <span className="text-xs sm:text-sm font-semibold text-slate-200">
                          انتخاب یا رهاسازی تصاویر در این قسمت
                        </span>
                        <span className="mt-1 text-[11px] text-slate-400">
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
                        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                      </div>
                    ) : images.length === 0 ? (
                      <p className="py-6 text-center text-xs text-slate-500">
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
                              className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 shadow-sm"
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
                                  <div className="flex h-full items-center justify-center text-slate-600 text-xs">
                                    بدون تصویر
                                  </div>
                                )}
                              </div>

                              <div className="p-2 border-t border-white/5 bg-slate-950/90">
                                {isDeleting ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void eraseImage(image.id)}
                                      className="flex-1 rounded bg-rose-600 py-1 text-[10px] font-bold text-white cursor-pointer"
                                    >
                                      حذف
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => setDeleteImage(null)}
                                      className="flex-1 rounded bg-slate-800 py-1 text-[10px] text-slate-300 cursor-pointer"
                                    >
                                      انصراف
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setDeleteImage(image.id)}
                                    className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/5 bg-white/5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/10 cursor-pointer transition-colors"
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
            <section className="rounded-3xl border border-white/[0.08] bg-[#0c1424]/80 backdrop-blur-xl p-6 sm:p-8 shadow-xl space-y-6">
              <div className="border-b border-white/5 pb-4">
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-cyan-400" />
                  <span>صفحه اختصاصی عمومی و کد QR (تعهد فاز ۲ قرارداد)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  کسب‌وکار شما یک لینک عمومی مستقل دارد که با اسکن این بارکد، مشتریان بدون واسطه وارد نمایه شما می‌شوند.
                </p>
              </div>

              {!editing ? (
                <div className="rounded-xl border border-white/[0.06] bg-slate-950/40 p-6 text-center text-xs text-slate-400">
                  برای تولید بارکد QR اختصاصی، ابتدا یک کسب‌وکار ثبت یا انتخاب فرمایید.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-8 items-center">
                  {/* Left: QR Display Box */}
                  <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-white/10 bg-slate-950/70 text-center space-y-4">
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
                      <span className="text-xs font-bold text-white">بارکد استند چاپی</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        مناسب برای چاپ روی استند رومیزی مغازه، فاکتور و کارت ویزیت
                      </p>
                    </div>

                    <a
                      href={getQrUrl(editing.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2 text-xs font-bold text-white transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>دانلود مستقیم تصویر QR</span>
                    </a>
                  </div>

                  {/* Right: Link & Details */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/[0.06] bg-slate-950/40 p-5 space-y-2">
                      <span className="text-xs font-semibold text-slate-400">آدرس صفحه عمومی مستقل:</span>
                      {publicUrl ? (
                        <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-white/10 bg-slate-900 font-mono text-xs text-cyan-300" dir="ltr">
                          <span className="truncate">{publicUrl}</span>
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white shrink-0"
                            title="باز کردن صفحه"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs text-amber-300">
                          پس از تایید اولیه مدیر، آدرس صفحه فعال می‌شود.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/[0.06] bg-slate-950/40 p-5 space-y-2">
                      <h4 className="text-xs font-bold text-white">وضعیت تاییدیه در فاز ۲:</h4>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                            editing.status === "approved"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                              : editing.status === "pending"
                              ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                              : "bg-rose-500/15 text-rose-300 border-rose-500/30"
                          }`}
                        >
                          {statusLabel[editing.status] || editing.status}
                        </span>
                        {editing.moderation_note && (
                          <span className="text-xs text-amber-200">
                            (یادداشت مدیر: {editing.moderation_note})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Standalone QR Modal */}
      {showQrModal && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c1427] p-6 text-center shadow-2xl space-y-4">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="text-base font-bold text-white">بارکد QR اختصاصی فروشگاه</h3>
            <p className="text-xs text-slate-400">
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
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2.5 text-xs font-bold text-white transition-colors"
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
