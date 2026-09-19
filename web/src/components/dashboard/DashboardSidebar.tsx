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
  ExternalLink,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export type DashboardTab = "overview" | "info" | "location" | "media" | "qr";

interface DashboardSidebarProps {
  currentTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  userPhone?: string;
  username?: string | null;
  /** Profile photo URL (already resolved); undefined = not loaded, null = none. */
  userAvatar?: string | null;
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
  username,
  userAvatar,
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
      badgeColor: "bg-ik-accent/20 text-ik-accent border-ik-accent/30",
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
    },
  ];

  return (
    <aside
      className={`relative z-40 flex flex-col shrink-0 border-l border-ik-border bg-ik-bg/95 backdrop-blur-2xl transition-all duration-300 select-none ${
        collapsed ? "w-[72px]" : "w-64"
      }`}
    >
      {/* Top Header & Brand */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-ik-border">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2.5 min-w-0 group" aria-label="اینکارت">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-[0_0_15px_rgba(34,211,238,0.35)] group-hover:scale-105 transition-transform">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/incart-logo.webp" alt="لوگوی اینکارت" className="h-full w-full object-cover" />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="font-black text-sm text-ik-text tracking-tight group-hover:text-ik-accent transition-colors">
                اینکارت
              </span>
              <span className="text-[10px] text-ik-muted truncate">
                پنل مدیریت کسب‌وکار
              </span>
            </div>
          </Link>
        )}

        {collapsed && (
          <Link href="/" className="relative mx-auto flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl shadow-[0_0_15px_rgba(34,211,238,0.35)]" aria-label="اینکارت">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/incart-logo.webp" alt="لوگوی اینکارت" className="h-full w-full object-cover" />
          </Link>
        )}

        {/* Collapse toggle button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border border-ik-border bg-ik-wash text-ik-muted hover:text-ik-text hover:bg-ik-wash-hover transition-colors cursor-pointer ${
            collapsed ? "mx-auto mt-2 mb-1" : ""
          }`}
          title={collapsed ? "گسترش منو" : "بستن منو"}
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Business Mini Switcher Pill (when expanded) */}
      {!collapsed && businessName && (
        <div className="mx-3 my-3 p-2.5 rounded-xl border border-ik-border bg-ik-panel/50">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-ik-muted">کسب‌وکار فعال:</p>
              <p className="text-xs font-bold text-ik-text truncate">{businessName}</p>
            </div>
            {status && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  status === "approved"
                    ? "bg-ik-success/15 text-ik-success border-ik-success/30"
                    : status === "pending"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30"
                    : "bg-ik-danger/15 text-ik-danger border-ik-danger/30"
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
                  ? "bg-ik-accent/15 text-ik-accent border border-ik-accent/40"
                  : "text-ik-muted hover:bg-ik-wash-hover/50 hover:text-ik-text"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              {/* Active Dot indicator on left/right */}
              {active && (
                <span className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-ik-accent" />
              )}

              <Icon
                className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${
                  active ? "text-ik-accent" : "text-ik-muted group-hover:text-ik-text"
                }`}
              />

              {!collapsed && (
                <span className="flex-1 text-right truncate">{item.label}</span>
              )}

              {!collapsed && item.badge && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                    item.badgeColor || "bg-ik-wash text-ik-muted border-ik-border"
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
          <div className="h-px bg-ik-border" />
        </div>

        {/* Theme switch — segmented icon-only control (تم تیره / تم گرم) */}
        <div
          className={`flex w-full items-center rounded-xl py-1 text-xs font-medium text-ik-muted ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
        >
          {collapsed ? <ThemeToggle compact /> : <ThemeToggle />}
        </div>

        {/* Quick External Links */}
        <Link
          href="/card-maker"
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-ik-muted hover:bg-ik-wash-hover/50 hover:text-ik-accent transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "کارت‌ساز دیجیتال" : undefined}
        >
          <CreditCard className="h-4 w-4 shrink-0 text-ik-accent/80" />
          {!collapsed && <span className="flex-1 text-right truncate">کارت‌ساز دیجیتال</span>}
        </Link>

        <Link
          href="/"
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-ik-muted hover:bg-ik-wash-hover/50 hover:text-ik-text transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "صفحه اصلی سامانه" : undefined}
        >
          <Home className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-right truncate">صفحه اصلی</span>}
        </Link>
      </nav>

      {/* User Info & Footer Logout Section */}
      <div className="p-3 border-t border-ik-border bg-ik-panel-soft/40">
        <div
          className={`flex items-center gap-2.5 ${
            collapsed ? "justify-center flex-col" : "justify-between"
          }`}
        >
          {/* Avatar / Identity */}
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? "justify-center" : ""}`}>
            {/* Round avatar: profile photo when present, else the first letter of the username. */}
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ik-accent/25 bg-ik-accent/10 text-xs font-black text-ik-accent shadow-sm ring-2 ring-ik-accent/10">
              {userAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userAvatar}
                  alt="تصویر پروفایل"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span aria-hidden>{username ? username.charAt(0).toUpperCase() : "؟"}</span>
              )}
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-ik-bg bg-ik-success" />
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                {username ? (
                  <p className="text-xs font-black text-ik-text truncate" dir="ltr">
                    @{username}
                  </p>
                ) : (
                  <p className="text-xs font-bold text-ik-text truncate" dir="ltr" font-mono>
                    {userPhone || "کاربر گرامی"}
                  </p>
                )}
                <p className="text-[10px] text-ik-muted truncate" dir="ltr">
                  {username ? userPhone : "آنلاین"}
                </p>
              </div>
            )}
          </div>

          {/* Logout */}
          <button
            type="button"
            onClick={onLogout}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-ik-border bg-ik-wash text-ik-muted hover:text-ik-text hover:bg-ik-wash-hover transition-colors cursor-pointer shrink-0"
            title="خروج از حساب کاربری"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
