"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  SlidersHorizontal,
  FileText,
  BookOpen,
  Image as ImageIcon,
  RefreshCw,
  LogOut,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  Menu,
  X,
  CreditCard,
  Megaphone,
  Palette,
  Map as MapIcon,
  Check,
  AlertCircle,
  Save,
  Home,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import {
  getAdminOverview,
  moderateAdminSubscription,
  moderateAdminShowcase,
  moderateAdminAdvertisement,
  moderateAdminPortfolio,
  type AdminOverview,
} from "@/lib/admin";
import { getAdminSettings, saveAdminSetting } from "@/lib/admin";
import AdminPagesTab from "@/components/admin/AdminPagesTab";
import AdminMapTab from "@/components/admin/AdminMapTab";
import AdminBlogTab from "@/components/admin/AdminBlogTab";
import AdminMediaTab from "@/components/admin/AdminMediaTab";
import AdminUsersTab from "@/components/admin/AdminUsersTab";

const TABS = [
  { id: "Overview", label: "پیشخوان و صف‌ها", icon: LayoutDashboard },
  { id: "Users", label: "کاربران و نقش‌ها", icon: Users },
  { id: "Homepage", label: "محتوای صفحه اصلی (CMS)", icon: SlidersHorizontal },
  { id: "Pages", label: "صفحات مستقل", icon: FileText },
  { id: "Blog", label: "وبلاگ و مقالات", icon: BookOpen },
  { id: "Map", label: "زیرساخت نقشه", icon: MapIcon },
  { id: "Media", label: "کتابخانه رسانه", icon: ImageIcon },
] as const;

type Tab = (typeof TABS)[number]["id"];

const HOMEPAGE_GROUPS = [
  {
    id: "hero",
    title: "بخش هیرو (Hero & Intro)",
    description: "تیتر اصلی، زیرتیتر، تصویر و دکمه‌های بالای صفحه اصلی",
    keys: [
      "homepage.hero.title",
      "homepage.hero.subtitle",
      "homepage.hero.badges",
      "homepage.hero.button_primary",
      "homepage.hero.button_primary_link",
      "homepage.hero.button_secondary",
      "homepage.hero.button_secondary_link",
      "homepage.hero.image",
      "homepage.hero.background",
      "homepage.hero.card_title",
      "homepage.hero.card_subtitle",
      "homepage.hero.card_phone",
      "homepage.hero.card_location",
    ],
  },
  {
    id: "features",
    title: "ویژگی‌ها و امکانات (Features)",
    description: "کارت‌های سه‌گانه معرفی قابلیت‌های اینکارت",
    keys: [
      "homepage.feature.1.title",
      "homepage.feature.1.description",
      "homepage.feature.2.title",
      "homepage.feature.2.description",
      "homepage.feature.3.title",
      "homepage.feature.3.description",
    ],
  },
  {
    id: "showcase",
    title: "ویترین و نحوه کارکرد (Showcase & Steps)",
    description: "عنوان بخش ویترین کارت‌ها و مراحل استفاده",
    keys: [
      "homepage.showcase.title",
      "homepage.showcase.subtitle",
      "homepage.showcase.cards",
      "homepage.howitworks.title",
      "homepage.howitworks.steps",
    ],
  },
  {
    id: "cta_footer",
    title: "فراخوان پایانی، فوتر و سئو (CTA & SEO)",
    description: "دعوت به اقدام، متن درباره ما و پیوندهای فوتر",
    keys: [
      "homepage.cta.title",
      "homepage.cta.subtitle",
      "homepage.cta.button_primary",
      "homepage.cta.button_primary_link",
      "homepage.cta.button_secondary",
      "homepage.cta.button_secondary_link",
      "homepage.footer.about",
      "homepage.footer.links",
      "homepage.footer.copyright",
      "homepage.brand",
      "homepage.nav.features",
      "homepage.nav.showcase",
      "homepage.nav.about",
      "homepage.nav.contact",
      "homepage.header.login",
      "seo.homepage",
    ],
  },
];

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("hero");
  const [scrollY, setScrollY] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);

  // Throttled scroll tracking for the smart taskbar and progress line
  useEffect(() => {
    let raf = 0;
    let lastY = -1;
    let lastMax = -1;
    const measure = () => {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (max !== lastMax) {
        lastMax = max;
        setMaxScroll(max);
      }
    };
    const onScroll = () => {
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          const y = window.scrollY;
          if (y !== lastY) {
            lastY = y;
            setScrollY(y);
          }
          measure();
        });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    measure();
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const sp = maxScroll > 0 ? Math.min(1, Math.max(0, scrollY / maxScroll)) : 0;
  const isScrolled = scrollY > 20;

  async function refresh() {
    setRefreshing(true);
    try {
      const [overview, rows] = await Promise.all([
        getAdminOverview(),
        getAdminSettings(),
      ]);
      setData(overview);
      setSettings(Object.fromEntries(rows.map((x) => [x.key, x.value ?? ""])));
      setError(null);
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!authLoading && (!user || !user.roles.includes("admin"))) {
      router.replace("/admin/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.roles.includes("admin")) {
      const t = window.setTimeout(() => void refresh(), 0);
      return () => window.clearTimeout(t);
    }
  }, [user]);

  async function save() {
    try {
      await Promise.all(
        Object.entries(settings).map(([key, value]) =>
          saveAdminSetting(key, value),
        ),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    }
  }

  if (authLoading || !user || !user.roles.includes("admin")) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090d16] text-slate-300 font-medium">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-[#0f172a] px-6 py-4 shadow-xl">
          <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
          <span>در حال بررسی سطح دسترسی مدیریت…</span>
        </div>
      </main>
    );
  }

  const pendingBusinesses = data?.queues.businesses.length ?? 0;
  const pendingSubscriptions = data?.queues.subscriptions.length ?? 0;
  const pendingShowcases = data?.queues.showcases.length ?? 0;
  const pendingAds = data?.queues.advertisements.length ?? 0;
  const pendingPortfolios = data?.queues.portfolios.length ?? 0;
  const totalPending =
    pendingBusinesses +
    pendingSubscriptions +
    pendingShowcases +
    pendingAds +
    pendingPortfolios;

  return (
    <div dir="rtl" className="relative flex min-h-screen bg-[#070b14] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden">
      {/* Ambient background light glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 right-1/4 h-[520px] w-[520px] rounded-full bg-cyan-500/[0.05] blur-[140px]" />
        <div className="absolute top-1/3 -left-20 h-[450px] w-[450px] rounded-full bg-indigo-600/[0.04] blur-[150px]" />
        <div className="absolute bottom-10 right-1/3 h-[450px] w-[450px] rounded-full bg-teal-500/[0.03] blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(14,165,233,0.06),rgba(255,255,255,0))]" />
      </div>

      {/* Slim Neon Scroll Progress Indicator */}
      <div aria-hidden className="fixed left-0 top-0 z-[60] h-[3px] w-full pointer-events-none">
        <div
          className="h-full bg-gradient-to-l from-cyan-400 via-teal-400 to-emerald-400 shadow-[0_0_14px_rgba(34,211,238,0.7)] transition-[width] duration-150 ease-out"
          style={{ width: `${(sp * 100).toFixed(2)}%` }}
        />
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Modern Right Sidebar (Shopify Polaris & Geist Shell) */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-72 flex-col justify-between border-l border-white/[0.08] bg-[#070b14]/92 backdrop-blur-2xl transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-5">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-400 text-lg font-black text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.4)] group-hover:scale-105 transition-transform">
                اَ
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white group-hover:text-cyan-400 transition-colors">
                  مرکز مدیریت اینکارت
                </h1>
                <p className="text-[11px] text-slate-400">سامانه جامع معرفی کسب‌وکارها</p>
              </div>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 lg:hidden cursor-pointer"
              aria-label="بستن منو"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Business Moderation Priority Action */}
          <div className="p-4">
            <Link
              href="/admin/businesses"
              className="group flex items-center justify-between rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-3 text-sm font-semibold text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.12)] transition-all hover:border-cyan-400/60 hover:bg-cyan-500/20 active:scale-[0.99]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Building2 className="h-4 w-4 shrink-0 text-cyan-400" />
                <span className="truncate">میزکار کسب‌وکارها</span>
              </div>
              <span className="shrink-0 rounded-md bg-cyan-400/20 px-2 py-0.5 text-[11px] font-bold text-cyan-300 border border-cyan-400/30 whitespace-nowrap">
                بررسی
              </span>
            </Link>
          </div>

          {/* Navigation Menu */}
          <nav className="space-y-1.5 px-3">
            <div className="px-3 pb-2 pt-1 text-[11px] font-semibold text-slate-400">
              بخش‌ها و صف‌های مدیریت
            </div>
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-cyan-500/15 text-white border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive ? "text-cyan-400" : "text-slate-400"
                      }`}
                    />
                    <span className="whitespace-nowrap">{t.label}</span>
                  </div>
                  {t.id === "Overview" && totalPending > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-300 border border-amber-500/30 whitespace-nowrap">
                      {totalPending}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Admin Identity & System Controls */}
        <div className="border-t border-white/[0.08] p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-3">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">
                مدیر ارشد سامانه
              </p>
              <p className="truncate text-[11px] text-slate-400 font-mono" dir="ltr">
                {user?.phone ?? "Admin"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 cursor-pointer"
              title="تازه‌سازی داده‌ها"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-cyan-400" : "text-cyan-400"}`}
              />
              <span>تازه‌سازی</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.push("/login");
              }}
              className="flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer"
              title="خروج از حساب"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Stage */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Floating Top Taskbar */}
        <div className="sticky top-2 sm:top-4 z-40 px-3 sm:px-6 transition-all duration-300">
          <header
            className={`flex items-center justify-between rounded-2xl p-px bg-gradient-to-l from-cyan-400/35 via-purple-500/25 to-cyan-400/35 shadow-[0_10px_35px_rgba(0,0,0,0.4),0_0_35px_-8px_rgba(34,211,238,0.25)] transition-all duration-300 ${
              isScrolled ? "scale-[0.99] shadow-[0_15px_40px_rgba(0,0,0,0.65),0_0_40px_-5px_rgba(34,211,238,0.35)]" : ""
            }`}
          >
            <div
              className={`flex w-full items-center justify-between rounded-[15px] bg-[#080d1a]/85 px-3.5 sm:px-5 backdrop-blur-2xl transition-all duration-300 ${
                isScrolled ? "h-13 sm:h-14 bg-[#050914]/92" : "h-14 sm:h-16"
              }`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3.5">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:text-white lg:hidden active:scale-95 cursor-pointer transition-colors"
                  aria-label="باز کردن منو"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 text-xs">
                  <span className="hidden sm:inline text-slate-400">مرکز مدیریت</span>
                  <span className="hidden sm:inline text-slate-600">/</span>
                  <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    </span>
                    <span>{TABS.find((x) => x.id === tab)?.label}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 sm:px-3 text-xs font-medium text-slate-300 hover:border-white/20 hover:bg-white/10 hover:text-white transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  title="تازه‌سازی داده‌ها"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-cyan-400" : "text-cyan-400"}`} />
                  <span className="hidden sm:inline">تازه‌سازی</span>
                </button>
                <Link
                  href="/"
                  target="_blank"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-2.5 sm:px-3 text-xs font-semibold text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white transition-all active:scale-[0.98] shadow-[0_0_15px_rgba(6,182,212,0.12)]"
                >
                  <Home className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span>مشاهده سایت</span>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                </Link>
              </div>
            </div>
          </header>
        </div>

        {/* Quick mobile horizontal tab switcher (for instant touch navigation) */}
        <div className="lg:hidden flex items-center gap-2 overflow-x-auto border-b border-white/[0.08] bg-[#070b14]/90 backdrop-blur-xl px-4 py-2.5 no-scrollbar">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-slate-200"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-cyan-400" : "text-slate-400"}`} />
                <span>{t.label}</span>
                {t.id === "Overview" && totalPending > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500/30 px-1 text-[10px] font-bold text-amber-300">
                    {totalPending}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dynamic Alerts */}
        <div className="px-4 sm:px-8 pt-4 sm:pt-6">
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-rose-300 shadow-sm backdrop-blur-md"
            >
              <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
          {saved && (
            <div
              role="status"
              className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-emerald-300 shadow-sm backdrop-blur-md"
            >
              <Check className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>تنظیمات و محتوای سایت با موفقیت ذخیره شد.</span>
            </div>
          )}
        </div>

        {/* Tab Body */}
        <div className="flex-1 px-4 sm:px-8 pb-12">
          {tab === "Overview" && (
            <div className="space-y-6">
              {/* Header Info */}
              <div className="flex flex-col gap-1">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  پیشخوان مدیریت و صف‌های اعتبارسنجی
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  وضعیت صف‌های بازرسی، درخواست‌های اشتراک، تصاویر ویترین و آگهی‌های کاربران
                </p>
              </div>

              {/* KPI Summary Cards (Polaris Metric Cards) - 2x2 grid on mobile */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <div className="group flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.14] hover:shadow-[0_12px_35px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] sm:text-xs font-medium">کسب‌وکارهای معلق</span>
                    <Building2 className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="mt-2 sm:mt-3 flex items-baseline gap-1.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-black text-white">
                      {pendingBusinesses}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400">در نوبت</span>
                  </div>
                  <div className="mt-2 sm:mt-3">
                    <Link
                      href="/admin/businesses"
                      className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-medium text-cyan-400 hover:text-cyan-300 whitespace-nowrap transition-colors"
                    >
                      <span>ورود به بررسی</span>
                      <span>←</span>
                    </Link>
                  </div>
                </div>

                <div className="group flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.14] hover:shadow-[0_12px_35px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] sm:text-xs font-medium">اشتراک‌های جدید</span>
                    <CreditCard className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 sm:mt-3 flex items-baseline gap-1.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-black text-white">
                      {pendingSubscriptions}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400">درخواست فعال‌سازی</span>
                  </div>
                  <div className="mt-2 sm:mt-3 text-[10px] sm:text-xs text-slate-400 truncate">
                    {pendingSubscriptions > 0 ? "نیازمند تایید فاکتور" : "تمام اشتراک‌ها فعال"}
                  </div>
                </div>

                <div className="group flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.14] hover:shadow-[0_12px_35px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] sm:text-xs font-medium">تصاویر ویترین</span>
                    <ImageIcon className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="mt-2 sm:mt-3 flex items-baseline gap-1.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-black text-white">
                      {pendingShowcases}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400">منتظر انتشار</span>
                  </div>
                  <div className="mt-2 sm:mt-3 text-[10px] sm:text-xs text-slate-400 truncate">
                    {pendingShowcases > 0 ? "بررسی قوانین تصویر" : "صف ویترین خالی"}
                  </div>
                </div>

                <div className="group flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.14] hover:shadow-[0_12px_35px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[11px] sm:text-xs font-medium">تبلیغات و طراحان</span>
                    <Megaphone className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2 sm:mt-3 flex items-baseline gap-1.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-black text-white">
                      {pendingAds + pendingPortfolios}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400">مورد در صف</span>
                  </div>
                  <div className="mt-2 sm:mt-3 text-[10px] sm:text-xs text-slate-400 truncate">
                    تبلیغات و نمونه‌کار
                  </div>
                </div>
              </div>

              {/* Moderation Queues Grid */}
              <div className="grid gap-6 lg:grid-cols-2">
                <QueueCard
                  title="کسب‌وکارهای جدید (صف بررسی)"
                  icon={Building2}
                  items={data?.queues.businesses ?? []}
                  action={async () => {
                    router.push("/admin/businesses");
                  }}
                  actionLabel="بررسی در میزکار"
                  emptyText="هیچ کسب‌وکاری در صف انتظار نیست."
                  emptySubtext="همه درخواست‌های ثبت یا ویرایش بررسی شده‌اند."
                />

                <QueueCard
                  title="اشتراک‌ها (در انتظار فعال‌سازی)"
                  icon={CreditCard}
                  items={data?.queues.subscriptions ?? []}
                  action={async (id) => {
                    await moderateAdminSubscription(id, "active");
                    await refresh();
                  }}
                  actionLabel="فعال‌سازی آنی"
                  emptyText="درخواست اشتراک معلقی وجود ندارد."
                  emptySubtext="تمام فاکتورهای پرداخت‌شده فعال هستند."
                />

                <QueueCard
                  title="گالری تصاویر ویترین"
                  icon={ImageIcon}
                  items={data?.queues.showcases ?? []}
                  action={async (id) => {
                    await moderateAdminShowcase(id, true);
                    await refresh();
                  }}
                  actionLabel="تأیید و انتشار عمومی"
                  emptyText="تصویر جدیدی برای ویترین ارسال نشده است."
                  emptySubtext="همه تصاویر تایید و در گالری ثبت شده‌اند."
                />

                <QueueCard
                  title="تبلیغات و بنرهای ویژه"
                  icon={Megaphone}
                  items={data?.queues.advertisements ?? []}
                  action={async (id) => {
                    await moderateAdminAdvertisement(id, "approved");
                    await refresh();
                  }}
                  actionLabel="تأیید بنر تبلیغاتی"
                  emptyText="آگهی تبلیغاتی در صف تایید نیست."
                  emptySubtext="نمایش تبلیغات در وضعیت پایدار است."
                />

                <QueueCard
                  title="نمونه‌کار طراحان کارت"
                  icon={Palette}
                  items={data?.queues.portfolios ?? []}
                  action={async (id) => {
                    await moderateAdminPortfolio(id, "approved");
                    await refresh();
                  }}
                  actionLabel="تأیید نمونه‌کار"
                  emptyText="نمونه‌کار جدیدی ارسال نشده است."
                  emptySubtext="پروفایل طراحان به‌روز است."
                />
              </div>
            </div>
          )}

          {tab === "Homepage" && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">
                    تنظیمات و متون صفحه اصلی (CMS)
                  </h2>
                  <p className="text-sm text-slate-400">
                    شخصی‌سازی عناوین، توضیحات، آیکون‌ها و کلیدواژه‌های سئو در صفحه نخست
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-6 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.35)] transition-all hover:brightness-110 active:scale-[0.98] cursor-pointer whitespace-nowrap"
                >
                  <Save className="h-4 w-4" />
                  <span>ذخیره تمام تغییرات</span>
                </button>
              </div>

              {/* Category selector */}
              <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
                {HOMEPAGE_GROUPS.map((grp) => (
                  <button
                    key={grp.id}
                    onClick={() => setActiveGroup(grp.id)}
                    className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                      activeGroup === grp.id
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                        : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/10"
                    }`}
                  >
                    {grp.title}
                  </button>
                ))}
              </div>

              {/* Selected Group Fields */}
              {HOMEPAGE_GROUPS.filter((g) => g.id === activeGroup).map((grp) => (
                <div
                  key={grp.id}
                  className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] space-y-6 transition-all hover:border-white/[0.12]"
                >
                  <div>
                    <h3 className="text-base font-bold text-white">{grp.title}</h3>
                    <p className="text-xs text-slate-400 mt-1">{grp.description}</p>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    {grp.keys.map((key) => {
                      const isLong =
                        key.includes("description") ||
                        key.includes("subtitle") ||
                        key.includes("seo") ||
                        key.includes("about") ||
                        key.includes("cards") ||
                        key.includes("steps") ||
                        key.includes("links");

                      return (
                        <div key={key} className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor={key}
                              className="text-xs font-medium text-slate-300"
                            >
                              {formatCmsKey(key)}
                            </label>
                            <span className="font-mono text-[10px] text-slate-400" dir="ltr">
                              {key}
                            </span>
                          </div>
                          {isLong ? (
                            <textarea
                              id={key}
                              value={settings[key] ?? ""}
                              onChange={(e) =>
                                setSettings((x) => ({ ...x, [key]: e.target.value }))
                              }
                              className="min-h-[96px] w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:bg-slate-950/80"
                            />
                          ) : (
                            <input
                              id={key}
                              type="text"
                              value={settings[key] ?? ""}
                              onChange={(e) =>
                                setSettings((x) => ({ ...x, [key]: e.target.value }))
                              }
                              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:bg-slate-950/80"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-4 border-t border-white/[0.08] flex justify-end">
                    <button
                      type="button"
                      onClick={() => void save()}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-6 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.35)] transition-all hover:brightness-110 active:scale-[0.98] cursor-pointer"
                    >
                      <Check className="h-4 w-4" />
                      <span>ذخیره تغییرات این بخش</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Other Tabs with Clean Card Shell */}
          {tab === "Pages" && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
              <AdminPagesTab />
            </div>
          )}

          {tab === "Blog" && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
              <AdminBlogTab />
            </div>
          )}

          {tab === "Map" && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl transition-all hover:border-white/[0.12]">
              <AdminMapTab />
            </div>
          )}

          {tab === "Media" && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
              <AdminMediaTab />
            </div>
          )}

          {tab === "Users" && (
            <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
              <AdminUsersTab />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Shopify Polaris Empty State & Queue Card pattern */
function QueueCard({
  title,
  icon: Icon,
  items,
  action,
  actionLabel,
  emptyText,
  emptySubtext,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Record<string, unknown>[];
  action: (id: number) => Promise<unknown>;
  actionLabel: string;
  emptyText: string;
  emptySubtext: string;
}) {
  const [actingId, setActingId] = useState<number | null>(null);

  async function handleAction(id: number) {
    setActingId(id);
    try {
      await action(id);
    } finally {
      setActingId(null);
    }
  }

  return (
    <article className="flex flex-col rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.25)] overflow-hidden transition-all hover:border-white/[0.12]">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 sm:px-5 py-3.5 sm:py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.15)]">
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-white">{title}</h3>
        </div>
        <span
          className={`flex h-5 items-center justify-center rounded-md px-2 text-[11px] font-semibold whitespace-nowrap shrink-0 ${
            items.length > 0
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-white/5 text-slate-400 border border-white/10"
          }`}
        >
          {items.length} مورد
        </span>
      </div>

      {/* Card Content */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-center">
        {items.length > 0 ? (
          <ul className="divide-y divide-white/[0.06]">
            {items.map((x, i) => {
              const name = String(
                x.name ??
                  x.title ??
                  (x.business as { name?: string } | undefined)?.name ??
                  `مورد شماره ${x.id ?? i + 1}`,
              );
              const id = Number(x.id);
              const isBusy = actingId === id;

              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
                    <span className="truncate font-medium text-slate-200">{name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAction(id)}
                    disabled={isBusy}
                    className="shrink-0 min-h-[36px] rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300 transition-all hover:border-cyan-400/60 hover:bg-cyan-500/20 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap shadow-[0_0_12px_rgba(34,211,238,0.1)]"
                  >
                    {isBusy ? "در حال انجام..." : actionLabel}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          /* Polaris Empty State */
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-300">{emptyText}</p>
            <p className="mt-1 text-xs text-slate-400">{emptySubtext}</p>
          </div>
        )}
      </div>
    </article>
  );
}

/** Translate CMS keys to human-friendly Persian labels */
function formatCmsKey(key: string): string {
  const map: Record<string, string> = {
    "homepage.hero.title": "تیتر اصلی هیرو (Hero Title)",
    "homepage.hero.subtitle": "زیرتیتر هیرو (Subtitle)",
    "homepage.hero.badges": "نشان بالای تیتر (Badge)",
    "homepage.hero.button_primary": "متن دکمه اصلی (Primary Button)",
    "homepage.hero.button_primary_link": "لینک دکمه اصلی",
    "homepage.hero.button_secondary": "متن دکمه ثانویه",
    "homepage.hero.button_secondary_link": "لینک دکمه ثانویه",
    "homepage.hero.image": "مسیر تصویر کارت هیرو",
    "homepage.hero.background": "مسیر تصویر پس‌زمینه",
    "homepage.hero.card_title": "عنوان کارت نمونه",
    "homepage.hero.card_subtitle": "شغل کارت نمونه",
    "homepage.hero.card_phone": "تلفن کارت نمونه",
    "homepage.hero.card_location": "موقعیت کارت نمونه",
    "homepage.feature.1.title": "عنوان ویژگی اول",
    "homepage.feature.1.description": "توضیحات ویژگی اول",
    "homepage.feature.2.title": "عنوان ویژگی دوم",
    "homepage.feature.2.description": "توضیحات ویژگی دوم",
    "homepage.feature.3.title": "عنوان ویژگی سوم",
    "homepage.feature.3.description": "توضیحات ویژگی سوم",
    "homepage.showcase.title": "عنوان بخش ویترین",
    "homepage.showcase.subtitle": "زیرعنوان بخش ویترین",
    "homepage.showcase.cards": "کارت‌های برگزیده ویترین (JSON)",
    "homepage.howitworks.title": "عنوان مراحل کارکرد",
    "homepage.howitworks.steps": "گام‌های استفاده (JSON)",
    "homepage.cta.title": "تیتر فراخوان پایانی (CTA)",
    "homepage.cta.subtitle": "متن فراخوان پایانی",
    "homepage.cta.button_primary": "دکمه اصلی فراخوان",
    "homepage.cta.button_primary_link": "لینک دکمه فراخوان",
    "homepage.cta.button_secondary": "دکمه ثانویه فراخوان",
    "homepage.cta.button_secondary_link": "لینک ثانویه فراخوان",
    "homepage.footer.about": "متن درباره ما در فوتر",
    "homepage.footer.links": "پیوندهای فوتر (JSON)",
    "homepage.footer.copyright": "متن کپی‌رایت",
    "homepage.brand": "نام برند",
    "homepage.nav.features": "عنوان منو: امکانات",
    "homepage.nav.showcase": "عنوان منو: ویترین",
    "homepage.nav.about": "عنوان منو: درباره ما",
    "homepage.nav.contact": "عنوان منو: تماس",
    "homepage.header.login": "متن دکمه ورود",
    "seo.homepage": "تنظیمات سئو و متاتگ‌ها",
  };
  return map[key] ?? key;
}
