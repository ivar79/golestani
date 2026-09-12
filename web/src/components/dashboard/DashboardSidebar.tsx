"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Store,
  MapPin,
  Image as ImageIcon,
  QrCode,
  CreditCard,
  Home,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from "lucide-react";

export type DashboardTab = "overview" | "info" | "location" | "media" | "qr";

interface DashboardSidebarProps {
  currentTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  userPhone?: string;
  businessName?: string;
  businessSlug?: string;
  status?: string;
  completionRate: number;
  onLogout: () => void;
}

export function DashboardSidebar({
  currentTab,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  userPhone,
  businessName,
  businessSlug,
  status,
  completionRate,
  onLogout,
}: DashboardSidebarProps) {
  const menuItems = [
    {
      id: "overview" as DashboardTab,
      label: "پیش‌خوان اصلی",
      icon: LayoutDashboard,
      badge: `${completionRate}%`,
      badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    },
    {
      id: "info" as DashboardTab,
      label: "مشخصات و تماس",
      icon: Store,
    },
    {
      id: "location" as DashboardTab,
      label: "موقعیت روی نقشه",
      icon: MapPin,
    },
    {
      id: "media" as DashboardTab,
      label: "لوگو و تصاویر گالری",
      icon: ImageIcon,
    },
    {
      id: "qr" as DashboardTab,
      label: "لینک عمومی و QR",
      icon: QrCode,
      badge: "فاز ۲",
      badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    },
  ];

  return (
    <aside
      className={`relative z-40 flex flex-col shrink-0 border-l border-white/[0.08] bg-[#070d18]/95 backdrop-blur-2xl transition-all duration-300 select-none ${
        collapsed ? "w-[72px]" : "w-64"
      }`}
    >
      {/* Top Header & Brand */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-white/[0.06]">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2.5 min-w-0 group" aria-label="اینکارت">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-400 text-slate-950 font-black text-base shadow-[0_0_15px_rgba(34,211,238,0.35)] group-hover:scale-105 transition-transform">
              اَ
            </span>
            <div className="flex flex-col min-w-0">
              <span className="font-black text-sm text-white tracking-tight group-hover:text-cyan-400 transition-colors">
                اینکارت
              </span>
              <span className="text-[10px] text-slate-400 truncate">
                پنل مدیریت کسب‌وکار
              </span>
            </div>
          </Link>
        )}

        {collapsed && (
          <Link href="/" className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-400 text-slate-950 font-black text-base shadow-[0_0_15px_rgba(34,211,238,0.35)]">
            اَ
          </Link>
        )}

        {/* Collapse toggle button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer ${
            collapsed ? "mx-auto mt-2 mb-1" : ""
          }`}
          title={collapsed ? "گسترش منو" : "بستن منو"}
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Business Mini Switcher Pill (when expanded) */}
      {!collapsed && businessName && (
        <div className="mx-3 my-3 p-2.5 rounded-xl border border-white/[0.06] bg-slate-900/50">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-400">کسب‌وکار فعال:</p>
              <p className="text-xs font-bold text-white truncate">{businessName}</p>
            </div>
            {status && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  status === "approved"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : status === "pending"
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                    : "bg-rose-500/15 text-rose-300 border-rose-500/30"
                }`}
              >
                {status === "approved" ? "تاییدشده" : status === "pending" ? "در انتظار" : "رد/تعلیق"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Navigation Menu */}
      <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto overflow-x-hidden">
        {menuItems.map((item) => {
          const active = currentTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                active
                  ? "bg-gradient-to-r from-cyan-500/20 to-teal-500/15 text-cyan-300 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              {/* Active Dot indicator on left/right */}
              {active && (
                <span className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              )}

              <Icon
                className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${
                  active ? "text-cyan-400" : "text-slate-400 group-hover:text-slate-200"
                }`}
              />

              {!collapsed && (
                <span className="flex-1 text-right truncate">{item.label}</span>
              )}

              {!collapsed && item.badge && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                    item.badgeColor || "bg-white/10 text-slate-300 border-white/10"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Separator */}
        <div className="pt-2 pb-1">
          <div className="h-px bg-white/[0.06]" />
        </div>

        {/* Quick External Links */}
        <Link
          href="/card-maker"
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-cyan-300 transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "کارت‌ساز دیجیتال" : undefined}
        >
          <CreditCard className="h-4 w-4 shrink-0 text-cyan-400/80" />
          {!collapsed && <span className="flex-1 text-right truncate">کارت‌ساز دیجیتال</span>}
        </Link>

        <Link
          href="/"
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "صفحه اصلی سامانه" : undefined}
        >
          <Home className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-right truncate">صفحه اصلی</span>}
        </Link>
      </nav>

      {/* User Info & Footer Logout Section */}
      <div className="p-3 border-t border-white/[0.06] bg-[#050914]/80">
        <div
          className={`flex items-center gap-2.5 ${
            collapsed ? "justify-center flex-col" : "justify-between"
          }`}
        >
          {/* Avatar / Phone */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 font-mono text-xs font-bold text-cyan-300 shadow-sm">
              {userPhone ? userPhone.slice(-2) : "کار"}
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-white truncate font-mono" dir="ltr">
                  {userPhone || "کاربر گرامی"}
                </p>
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>آنلاین</span>
                </p>
              </div>
            )}
          </div>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/40 transition-colors cursor-pointer shrink-0"
            title="خروج از حساب کاربری"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
