"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, LayoutDashboard } from "lucide-react";
import CmsBrandLogo from "@/components/brand/CmsBrandLogo";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { useTheme } from "@/components/dashboard/ThemeProvider";
import { useAuth } from "@/contexts/AuthContext";
import { avatarUrl } from "@/lib/auth";
import { panelPath } from "@/lib/panelPath";

/**
 * SearchHeader — the search experience's own header.
 *
 * Why a dedicated header instead of the marketing AppTaskbar: the search page
 * is a `.dashboard-shell` surface (like the User Panel), and the shared
 * AppTaskbar is a fixed navy-glass marketing pill (cyan/purple gradient) that
 * belongs to the homepage. Keeping it here is exactly the navy-heavy look the
 * client rejected, and it does not follow the shell's `--ik-*` tokens.
 *
 * This header is:
 *  - token-based (bg-ik-panel / text-ik-text / border-ik-border …) so it
 *    follows the Warm Editorial theme (and the dark one) automatically,
 *  - mobile-first: one compressed row, 44px touch targets, no overflow,
 *  - in-flow + sticky (not fixed) so it never overlaps the search form,
 *  - theme-aware where a token cannot do the job (the brand logo tone).
 */
export default function SearchHeader() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const panel = panelPath(user?.roles);
  const resolvedAvatar = avatarUrl(user?.avatar);
  // The logo is a raster asset, not a CSS token: pick the variant that stays
  // legible on the active shell background (dark ink on the warm light bg).
  const logoTone = theme === "warm" ? "dark" : "light";

  // Close the user menu on outside click / Escape (same pattern as LocationChip).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    await logout();
    router.push("/");
  }, [logout, router]);

  return (
    <header className="sticky top-0 z-40 border-b border-ik-border bg-ik-panel/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[68px]">
        {/* Brand — symbol on the narrowest screens, full wordmark when there is room */}
        <Link
          href="/"
          aria-label="رفتن به صفحه اصلی اینکارت"
          className="flex shrink-0 items-center transition-opacity duration-200 hover:opacity-80"
        >
          <CmsBrandLogo variant="symbol" tone={logoTone} height={34} className="sm:hidden" priority />
          <CmsBrandLogo variant="primary" tone={logoTone} width={128} className="hidden sm:block" />
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle compact />

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-label="منوی کاربر"
                className="flex min-h-[44px] items-center gap-2 rounded-xl border border-ik-border bg-ik-wash px-2.5 text-sm font-medium text-ik-text transition-colors hover:bg-ik-wash-hover"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ik-accent/10 text-ik-accent">
                  {resolvedAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolvedAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span dir="ltr" className="text-[11px] font-bold">
                      {(user.username ?? user.phone ?? "").slice(0, 1)}
                    </span>
                  )}
                </span>
                <span dir="ltr" className="hidden max-w-[120px] truncate text-xs font-semibold sm:block">
                  {user.username ? `@${user.username}` : user.phone}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-ik-border bg-ik-panel shadow-lg">
                  {panel && (
                    <Link
                      href={panel}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-3 text-xs font-semibold text-ik-text transition-colors hover:bg-ik-wash"
                    >
                      <LayoutDashboard className="h-4 w-4 text-ik-muted" />
                      پنل کاربری
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-right text-xs font-medium text-ik-danger transition-colors hover:bg-ik-wash"
                  >
                    <LogOut className="h-4 w-4" />
                    خروج از حساب
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="flex min-h-[44px] items-center rounded-xl bg-ik-accent px-4 text-sm font-bold text-ik-accent-contrast shadow-sm transition-colors hover:bg-ik-accent-hover"
            >
              ورود / ثبت‌نام
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
