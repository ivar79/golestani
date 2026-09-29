"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cms, useHomepageContent } from "@/lib/homepage";
import { getPublicAds, type Advertisement } from "@/lib/ads";
import { panelPath } from "@/lib/panelPath";
import CmsBrandLogo from "@/components/brand/CmsBrandLogo";
import { avatarUrl } from "@/lib/auth";
import { Camera, CreditCard, LayoutDashboard, LogOut, Trash2 } from "lucide-react";

// SearchModal is only rendered while the search UI is open; lazy-loading it
// keeps its JS out of every page's initial bundle (P1 size fix). The loading
// fallback stays visually aligned with the modal's dark glass look.
const SearchModal = dynamic(
  () => import("@/components/search/SearchModal"),
  { ssr: false, loading: () => null },
);

// Site-wide smart taskbar (LeadFresh pattern tuned to the emerald/navy RTL
// theme). A floating pill header crossfades with a slim emerald scroll-progress
// line. Desktop keeps inline nav + a centred chevron toggle; mobile/tablet use
// a floating hamburger that slides in from the LEFT when scrolled. Search lives
// in the taskbar (chic icon next to ورود / ثبت‌نام opening a dropdown), and a
// CMS-driven ad strip sits just below the pill. All text is CMS-driven.
const FADE_RANGE = 150;
const BAR_ACTIVE_AT = 0.3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const NAV_ITEMS = [
  { key: "nav.features", href: "#features" },
  { key: "nav.showcase", href: "#showcase" },
  { key: "nav.pricing", href: "/pricing" },
  { key: "nav.about", href: "/about" },
  { key: "nav.contact", href: "/contact" },
] as const;

function SearchIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  );
}
function Burger() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  );
}

export default function AppTaskbar() {
  const router = useRouter();
  const { user, logout, uploadAvatar, removeAvatar } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const content = useHomepageContent();
  // Custom CMS logo (homepage.logo) is handled inside CmsBrandLogo — no local var needed.
  const loginLabel = cms(content, "header.login") || "ورود / ثبت‌نام";

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const panel = panelPath(user?.roles);

  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);

  const resolvedAvatar = avatarUrl(user?.avatar);

  const handleAvatarPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        await uploadAvatar(file);
      } catch {
        /* The API surfaces validation errors via axios defaults; keep UI silent-fail safe. */
      }
    },
    [uploadAvatar],
  );

  const handleAvatarRemoved = useCallback(async () => {
    try {
      await removeAvatar();
    } catch {
      /* Nothing to clean up locally if the server delete fails. */
    }
  }, [removeAvatar]);

  const handleLogout = useCallback(async () => {
    await logout();
    setUserMenuOpen(false);
    router.push("/");
  }, [logout, router]);

  const nav = NAV_ITEMS.map((n) => ({ label: cms(content, n.key), href: n.href }));

  const [scrollY, setScrollY] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [ads, setAds] = useState<Advertisement[]>([]);

  // CMS ad strip (empty -> renders nothing).
  useEffect(() => {
    let cancelled = false;
    getPublicAds()
      .then((list) => !cancelled && setAds(list))
      .catch(() => !cancelled && setAds([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setIsDesktop(mq.matches);
      if (!mq.matches) setMenuOpen(false);
      if (mq.matches) setDrawerOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // rAF-throttled scroll tracking.
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

  const p = clamp01(scrollY / FADE_RANGE);
  const sp = maxScroll > 0 ? clamp01(scrollY / maxScroll) : 0;
  const showBar = menuOpen || drawerOpen || searchOpen;
  const pillStyle = {
    opacity: (1 - p).toFixed(3),
    pointerEvents: (p > 0.85 ? "none" : "auto") as "none" | "auto",
  };
  const barOpacity = showBar ? 1 : p;
  const toggleVisible = menuOpen || p >= BAR_ACTIVE_AT;
  const burgerVisible = drawerOpen || p >= BAR_ACTIVE_AT;

  const closeAll = useCallback(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
    setSearchOpen(false);
    setUserMenuOpen(false);
    document.body.style.overflow = "";
  }, [setMenuOpen, setDrawerOpen, setSearchOpen, setUserMenuOpen]);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    setSearchOpen(false);
    document.body.style.overflow = "hidden";
  }, [setDrawerOpen, setSearchOpen]);

  useEffect(() => {
    if (!menuOpen && !drawerOpen && !searchOpen && !userMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAll();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest?.("[data-nav-menu]") && !t.closest?.("[data-drawer]") && !t.closest?.("[data-search-menu]") && !t.closest?.("[data-user-menu]") && !t.closest?.('[aria-label="جست‌وجو"]') && !t.closest?.('[aria-label="منوی کاربر"]')) closeAll();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen, drawerOpen, searchOpen, userMenuOpen, closeAll]);

  // Brand block — هویت نهایی InKart + لوگوی سفارشی CMS (اگر ادمین آپلود
  // کرده باشد). دسکتاپ/تبلت: primary؛ موبایل: نماد iK. بدون باکس/سایه.
  const logoBlock = (
    <Link
      href="/"
      aria-label="رفتن به صفحه اصلی اینکارت"
      onClick={closeAll}
      className="flex shrink-0 items-center gap-3 transition-opacity duration-200 hover:opacity-80"
    >
      {/* priority: همین لوگو LCP موبایل است — هشدار Next/Image رفع می‌شود. */}
      <CmsBrandLogo variant="symbol" tone="light" height={38} className="md:hidden" priority />
      <CmsBrandLogo variant="primary" tone="light" width={135} className="hidden md:block xl:hidden" />
      <CmsBrandLogo variant="primary" tone="light" width={155} className="hidden xl:block" />
    </Link>
  );

  const navList = (className: string, onNavigate?: () => void) =>
    nav.map((item) => (
      <Link key={item.href} href={item.href} onClick={onNavigate} className={className}>
        {item.label}
      </Link>
    ));

  // Search components have been moved to SearchModal

  // Auth-aware header action: guest sees ورود / ثبت‌نام, logged-in user
  // gets an elegant glassmorphism chip with digital card icon, active online indicator,
  // phone number, and chevron opening the user dropdown.
  const authAction = user ? (
    <div className="relative" data-user-menu>
      <button
        type="button"
        aria-label="منوی کاربر"
        aria-expanded={userMenuOpen}
        onClick={() => {
          setUserMenuOpen((v) => !v);
          setDrawerOpen(false);
        }}
        className={`group flex h-10 items-center gap-2.5 rounded-xl border px-3 py-1.5 backdrop-blur-md transition-all cursor-pointer select-none ${
          userMenuOpen
            ? "border-emerald-400/50 bg-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.25)] text-white"
            : "border-white/10 bg-white/[0.04] hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] text-slate-200 hover:text-white"
        }`}
      >
        {/* Identity avatar: profile photo when present, else the card glyph — with active neon status dot */}
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-emerald-400/25 to-teal-500/35 border border-emerald-400/30 text-emerald-300 shadow-inner">
          {resolvedAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolvedAvatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <CreditCard className="h-3.5 w-3.5" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 border border-slate-900" />
          </span>
        </div>

        {/* Handle first: @username badge once claimed, otherwise the phone number */}
        {user.username ? (
          <span
            dir="ltr"
            className="max-w-[140px] truncate rounded-lg bg-gradient-to-l from-emerald-500/20 to-teal-500/15 border border-emerald-400/25 px-2 py-0.5 text-xs font-black tracking-wide text-emerald-200"
          >
            @{user.username}
          </span>
        ) : (
          <span dir="ltr" className="font-mono text-xs font-semibold tracking-wide">
            {user.phone}
          </span>
        )}

        {/* Smooth Animated Chevron */}
        <svg
          className={`h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-300 transition-transform duration-200 ${
            userMenuOpen ? "rotate-180 text-emerald-300" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {userMenuOpen && (
        <div className="animate-[drawer-slide_0.25s_ease-out] absolute left-0 top-[calc(100%+10px)] z-[70] w-60 rounded-2xl border border-white/10 bg-[#070e1c]/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.65),0_0_30px_rgba(16,185,129,0.1)] backdrop-blur-2xl">
          {/* Header Info inside Dropdown */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/5 mb-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
              {resolvedAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolvedAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-400">حساب کاربری اینکارت</div>
              <div
                dir="ltr"
                className={`truncate text-xs font-bold text-white ${user.username ? "" : "font-mono"}`}
              >
                {user.username ? `@${user.username}` : user.phone}
              </div>
            </div>
          </div>

          {/* Profile photo actions */}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleAvatarPicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-xs font-semibold text-slate-200 transition hover:bg-emerald-500/15 hover:text-white group cursor-pointer"
          >
            <Camera className="h-4 w-4 text-slate-400 group-hover:text-emerald-300 transition-colors" />
            <span>{resolvedAvatar ? "تغییر تصویر پروفایل" : "افزودن تصویر پروفایل"}</span>
          </button>
          {resolvedAvatar && (
            <button
              type="button"
              onClick={() => void handleAvatarRemoved()}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-xs font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 group cursor-pointer"
            >
              <Trash2 className="h-4 w-4 text-slate-500 group-hover:text-rose-300 transition-colors" />
              <span>حذف تصویر پروفایل</span>
            </button>
          )}

          {panel && (
            <Link
              href={panel}
              onClick={closeUserMenu}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-emerald-500/15 hover:text-white group"
            >
              <LayoutDashboard className="h-4 w-4 text-slate-400 group-hover:text-emerald-300 transition-colors" />
              <span>پنل کاربری</span>
            </Link>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-xs font-medium text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300 group cursor-pointer"
          >
            <LogOut className="h-4 w-4 text-rose-400/80 group-hover:text-rose-300 transition-colors" />
            <span>خروج از حساب</span>
          </button>
        </div>
      )}
    </div>
  ) : (
    <Link href="/login" className="group inline-flex hidden cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-4 py-2 text-sm font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none] sm:inline-flex">
      {loginLabel}
    </Link>
  );

  return (
    <>
      {/* Slim scroll-progress line */}
      <div aria-hidden className="fixed left-0 top-0 z-[60] h-[3px] w-full" style={{ opacity: barOpacity }}>
        <div className="h-full bg-gradient-to-l from-secondary to-secondary-container shadow-[0_0_12px_rgba(16,185,129,0.6)]" style={{ width: `${(sp * 100).toFixed(2)}%` }} />
      </div>

      {/* Pill header — glassmorphism با قاب گرادیانی نورانی (هماهنگ با مودال جستجو) */}
      <header
        className="fixed left-1/2 top-4 z-50 w-[92%] max-w-[1280px] -translate-x-1/2 rounded-2xl p-px bg-gradient-to-l from-cyan-400/30 via-purple-500/20 to-cyan-400/30 shadow-[0_10px_30px_rgba(0,0,0,0.35),0_0_40px_-10px_rgba(34,211,238,0.25)] sm:top-6 sm:w-[calc(100%-48px)] lg:top-8 lg:w-[calc(100%-80px)] xl:max-w-[1280px]"
        style={pillStyle}
      >
        <div className="flex h-[62px] items-center justify-between rounded-[15px] bg-night/70 px-4 backdrop-blur-2xl sm:h-[70px] sm:px-6">
        {logoBlock}

        <nav className="hidden items-center gap-8 xl:flex">{navList("text-sm text-surface-variant transition-colors hover:text-white")}</nav>

        <div className="flex items-center gap-2">
          {authAction}

          {/* Chic search icon next to ورود / ثبت‌نام — relative wrapper anchors the dropdown to the icon */}
          <div className="relative">
            <button
              type="button"
              aria-label="جست‌وجو"
              onClick={() => {
                setSearchOpen(true);
                setDrawerOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white transition hover:bg-white/5"
            >
              <SearchIcon />
            </button>
          </div>

          {/* Mobile/tablet hamburger — floats in from the LEFT when scrolled */}
          <button
            type="button"
            aria-label={drawerOpen ? "بستن منو" : "باز کردن منو"}
            aria-expanded={drawerOpen}
            onClick={() => (drawerOpen ? closeAll() : openDrawer())}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-primary text-white transition hover:bg-white/5 xl:hidden"
            style={{ opacity: burgerVisible ? 1 : 0, pointerEvents: burgerVisible ? "auto" : "none" }}
          >
            {drawerOpen ? <XIcon /> : <Burger />}
          </button>
        </div>
        </div>
      </header>

      {/* Desktop centred chevron toggle — appears after scrolling */}
      {isDesktop && (
        <div className="fixed left-1/2 top-3 z-[60] hidden -translate-x-1/2 xl:block" data-nav-menu>
          <button
            type="button"
            aria-label="منو"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((v) => !v);
              setSearchOpen(false);
            }}
            className="animate-[topbar-bob_2.4s_ease-in-out_infinite] flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-night/80 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:bg-white/5"
            style={{ opacity: toggleVisible ? 1 : 0, pointerEvents: toggleVisible ? "auto" : "none" }}
          >
            <ChevronDown />
          </button>
          {menuOpen && (
            <div className="animate-[drawer-slide_0.25s_ease-out] absolute left-1/2 mt-3 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-night/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              {navList("block rounded-xl px-4 py-3 text-sm text-surface-variant transition hover:bg-white/5 hover:text-white", closeAll)}
              {user ? (
                <>
                  {panel && (
                    <Link href={panel} onClick={closeAll} className="inline-flex mt-2 block w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/12 bg-white/[0.06] px-[0.875rem] py-3 text-[0.9375rem] font-semibold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[8px] transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-white/20 hover:bg-white/[0.12] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] active:translate-y-0 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]">
                      پنل کاربری
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-2 block w-full rounded-xl px-4 py-3 text-sm font-medium text-red-400 transition hover:bg-white/5"
                  >
                    خروج
                  </button>
                </>
              ) : (
                <Link href="/login" onClick={closeAll} className="group inline-flex mt-2 block w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-[0.875rem] py-3 text-[0.9375rem] font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]">
                  {loginLabel}
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* CMS ad strip below the pill */}
      {ads.length > 0 && (
        <div className="fixed inset-x-0 top-[88px] z-40 sm:top-[96px] lg:top-[104px]">
          <div className="mx-auto flex w-[92%] max-w-[1280px] gap-3 overflow-x-auto no-scrollbar">
            {ads.map((ad) => (
              <a
                key={ad.id}
                href={ad.target_url || "#"}
                target={ad.target_url ? "_blank" : undefined}
                rel={ad.target_url ? "noopener noreferrer nofollow" : undefined}
                className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-night/70 px-4 py-2 text-white backdrop-blur-xl transition hover:border-secondary/40"
              >
                {ad.image_path && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={ad.image_path} alt="" className="h-8 w-8 rounded-lg object-cover" />
                )}
                <span className="text-xs font-medium leading-5">{ad.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Mobile/tablet drawer (slides from LEFT) */}
      {drawerOpen && (
        <div className="animate-[drawer-fade_0.2s_ease-out] fixed inset-0 z-[70] bg-night/70 backdrop-blur-sm xl:hidden" onClick={closeAll}>
          <div
            data-drawer
            className="animate-[drawer-slide_0.25s_ease-out] fixed inset-y-0 left-0 flex w-[80%] max-w-sm flex-col overflow-y-auto border-r border-white/10 bg-night/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between px-2 pt-1">
              {logoBlock}
              <button type="button" aria-label="بستن منو" onClick={closeAll} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:bg-white/5">
                <XIcon />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {navList("rounded-xl px-4 py-3 text-sm text-surface-variant transition hover:bg-white/5 hover:text-white", closeAll)}
            </nav>
            <div className="my-3 border-t border-white/10" />
            
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                setSearchOpen(true);
              }}
              className="mb-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-surface-variant transition hover:bg-white/10 hover:text-white"
            >
              <span className="flex items-center gap-2">
                <SearchIcon />
                جست‌وجو در اینکارت...
              </span>
            </button>
            {user ? (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2.5">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-emerald-400/20 to-teal-500/30 border border-emerald-400/30 text-emerald-300">
                    {resolvedAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolvedAvatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 border border-slate-900" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-400">حساب کاربری اینکارت</div>
                    <div
                      dir="ltr"
                      className={`truncate text-xs font-bold text-white ${user.username ? "" : "font-mono"}`}
                    >
                      {user.username ? `@${user.username}` : user.phone}
                    </div>
                  </div>
                </div>
                {panel && (
                  <Link
                    href={panel}
                    onClick={closeAll}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25 hover:text-white"
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span>ورود به پنل کاربری</span>
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-medium text-rose-400 transition hover:bg-rose-500/10 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>خروج از حساب</span>
                </button>
              </div>
            ) : (
              <Link href="/login" onClick={closeAll} className="group inline-flex mt-4 block w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-[0.875rem] py-3 text-[0.9375rem] font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none disabled:[box-shadow:none]">
                {loginLabel}
              </Link>
            )}
          </div>
        </div>
      )}
      {/* مدال فول‌اسکرین جستجو */}
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
