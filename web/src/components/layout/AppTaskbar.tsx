"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cms, useHomepageContent } from "@/lib/homepage";
import { getPublicAds, type Advertisement } from "@/lib/ads";
import { panelPath } from "@/lib/panelPath";
import SearchModal from "@/components/search/SearchModal";

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
function MapPinIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
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
  const { user, logout } = useAuth();
  const content = useHomepageContent();
  const brand = cms(content, "brand") || "اینکارت";
  const logo = cms(content, "logo");
  const loginLabel = cms(content, "header.login") || "ورود / ثبت‌نام";

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const panel = panelPath(user?.roles);

  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);

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
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [ads, setAds] = useState<Advertisement[]>([]);
  const qInputRef = useRef<HTMLInputElement>(null);

  // Focus the hero query input when the panel opens (after the open animation).
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => qInputRef.current?.focus(), 160);
    return () => clearTimeout(t);
  }, [searchOpen]);

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
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    setSearchOpen(false);
    document.body.style.overflow = "hidden";
  }, []);

  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (city.trim()) params.set("city", city.trim());
      router.push(`/search${params.toString() ? `?${params.toString()}` : ""}`);
      setSearchOpen(false);
    },
    [q, city, router]
  );

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

  const logoBlock = (
    <Link href="/" className="flex items-center gap-3" aria-label={brand} onClick={closeAll}>
      {logo ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={logo} alt="" className="h-10 w-auto object-contain" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-lg font-black text-white shadow-lg shadow-secondary/20">{"اَ"}</span>
      )}
      <span className="text-xl font-bold text-white lg:text-2xl">{brand}</span>
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
  // gets a compact phone chip opening a menu with panel + logout.
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
        className="btn btn-secondary btn-sm h-10 max-w-[10rem] gap-2 sm:max-w-[14rem]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-white">
          {user.phone.slice(-2)}
        </span>
        <span dir="ltr" className="truncate text-xs font-semibold">
          {user.phone}
        </span>
      </button>
      {userMenuOpen && (
        <div className="drawer-panel absolute left-0 top-[calc(100%+12px)] z-[70] w-56 rounded-2xl border border-white/10 bg-night/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {panel && (
            <Link
              href={panel}
              onClick={closeUserMenu}
              className="block rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
            >
              پنل کاربری
            </Link>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full rounded-xl px-4 py-3 text-right text-sm font-medium text-red-400 transition hover:bg-white/5"
          >
            خروج
          </button>
        </div>
      )}
    </div>
  ) : (
    <Link href="/login" className="btn btn-primary btn-sm hidden sm:inline-flex">
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
            className="topbar-bob flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-night/80 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:bg-white/5"
            style={{ opacity: toggleVisible ? 1 : 0, pointerEvents: toggleVisible ? "auto" : "none" }}
          >
            <ChevronDown />
          </button>
          {menuOpen && (
            <div className="drawer-panel absolute left-1/2 mt-3 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-night/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              {navList("block rounded-xl px-4 py-3 text-sm text-surface-variant transition hover:bg-white/5 hover:text-white", closeAll)}
              {user ? (
                <>
                  {panel && (
                    <Link href={panel} onClick={closeAll} className="btn btn-secondary btn-md mt-2 block w-full">
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
                <Link href="/login" onClick={closeAll} className="btn btn-primary btn-md mt-2 block w-full">
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
        <div className="drawer-backdrop fixed inset-0 z-[70] bg-night/70 backdrop-blur-sm xl:hidden" onClick={closeAll}>
          <div
            data-drawer
            className="drawer-panel fixed inset-y-0 left-0 flex w-[80%] max-w-sm flex-col overflow-y-auto border-r border-white/10 bg-night/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
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
              <>
                {panel && (
                  <Link href={panel} onClick={closeAll} className="btn btn-secondary btn-md mt-4 block w-full">
                    پنل کاربری
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-3 block w-full rounded-xl px-4 py-3 text-sm font-medium text-red-400 transition hover:bg-white/5"
                >
                  خروج
                </button>
              </>
            ) : (
              <Link href="/login" onClick={closeAll} className="btn btn-primary btn-md mt-4 block w-full">
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
