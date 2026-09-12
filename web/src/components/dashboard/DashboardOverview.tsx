"use client";

import React from "react";
import {
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MapPin,
  QrCode,
  Globe,
  ExternalLink,
  ChevronLeft,
  Camera,
  Layers,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import { statusLabel, badgeLabel, type Phase2Business } from "@/lib/phase2";
import { getQrUrl } from "@/lib/businesses";
import type { DashboardTab } from "./DashboardSidebar";

interface DashboardOverviewProps {
  business: Phase2Business | null;
  completionRate: number;
  userPhone?: string;
  hasLocation: boolean;
  hasImages: boolean;
  imagesCount: number;
  publicUrl?: string;
  onNavigateTab: (tab: DashboardTab) => void;
  onOpenQrModal: () => void;
}

export function DashboardOverview({
  business,
  completionRate,
  userPhone,
  hasLocation,
  hasImages,
  imagesCount,
  publicUrl,
  onNavigateTab,
  onOpenQrModal,
}: DashboardOverviewProps) {
  // Current Persian Greeting based on time
  const now = new Date();
  const hours = now.getHours();
  let greeting = "روز بخیر";
  if (hours < 11) greeting = "صبح بخیر";
  else if (hours < 16) greeting = "ظهر بخیر";
  else if (hours < 20) greeting = "عصر بخیر";
  else greeting = "شب بخیر";

  const status = business?.status || "draft";

  // SVG Circular progress math
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionRate / 100) * circumference;

  return (
    <div className="space-y-6">
      {/* 1. Header Banner inspired by Finance Assistant & 21st.dev */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#0c1527] via-[#09101f] to-[#070b14] p-6 sm:p-8 shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
        {/* Subtle decorative glow */}
        <div className="pointer-events-none absolute -top-24 left-1/4 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-24 right-1/4 h-64 w-64 rounded-full bg-emerald-500/10 blur-[90px]" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
              <span>پیش‌خوان هوشمند کسب‌وکار</span>
            </div>

            <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight">
              {greeting}، {business ? business.name : "کاربر گرامی"} 👋
            </h1>

            <p className="text-xs sm:text-sm text-slate-400 max-w-xl leading-relaxed">
              {business
                ? "به مرکز مدیریت نمایه خود خوش آمدید. از این بخش می‌توانید وضعیت انتشار، لوکیشن نقشه و بارکد اختصاصی مغازه خود را مدیریت کنید."
                : "برای نمایش در سامانه کشف مشاغل و نقشه گلستان، لطفاً اطلاعات اولیه کسب‌وکار خود را تکمیل فرمایید."}
            </p>
          </div>

          {/* Business Badges */}
          {business?.badges && business.badges.length > 0 && (
            <div className="flex flex-wrap gap-2 self-start md:self-center">
              {business.badges.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 rounded-xl bg-cyan-500/15 border border-cyan-500/30 px-3 py-1.5 text-xs font-semibold text-cyan-300 shadow-sm"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{badgeLabel[b] || b}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. 3 Bento Cards (The exact pattern user showed in screenshot 1 + inspired metrics) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Verification & Status */}
        <div className="relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c1424]/90 p-5 sm:p-6 backdrop-blur-xl shadow-lg transition-all hover:border-white/[0.15] hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-purple-500/20">
              {status === "approved" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : status === "pending" ? (
                <Clock className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>

            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                status === "approved"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : status === "pending"
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-rose-500/15 text-rose-300 border-rose-500/30"
              }`}
            >
              {statusLabel[status as keyof typeof statusLabel] || status}
            </span>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-1">وضعیت انتشار کسب‌وکار</h3>
            <p className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
              {status === "approved"
                ? "کسب‌وکار شما تایید شده و در نقشه عمومی برای همگان قابل جستجو است."
                : status === "pending"
                ? "اطلاعات ثبت شده و در صف بررسی ناظران سامانه قرار دارد."
                : "نیازمند ویرایش یا بررسی مجدد است."}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
            <span className="text-slate-500">مرحله قرارداد:</span>
            <span className="font-semibold text-cyan-400">تعهد فاز ۱ و ۲</span>
          </div>
        </div>

        {/* Card 2: Circular Completion & Checklist (from Finance template) */}
        <div className="relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c1424]/90 p-5 sm:p-6 backdrop-blur-xl shadow-lg transition-all hover:border-white/[0.15] hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <span className="text-[11px] font-semibold text-cyan-400">پیشرفت نمایه</span>
              <h3 className="text-sm font-bold text-white mt-0.5">درصد تکمیل پروفایل</h3>
            </div>

            {/* Circular Progress Widget */}
            <div className="relative flex h-14 w-14 items-center justify-center shrink-0">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 90 90">
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  className="stroke-slate-800 fill-none"
                  strokeWidth="8"
                />
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  className="stroke-cyan-400 fill-none transition-all duration-1000 ease-out"
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute font-mono text-xs font-black text-white">
                {completionRate}%
              </span>
            </div>
          </div>

          {/* Checklist mini bars */}
          <div className="space-y-1.5 text-[11px] my-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${hasLocation ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span>موقعیت نقشه</span>
              </span>
              <span className={hasLocation ? "text-emerald-400 font-semibold" : "text-slate-500"}>
                {hasLocation ? "ثبت‌شده" : "ثبت‌نشده"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${hasImages ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span>تصاویر و گالری</span>
              </span>
              <span className="font-mono text-slate-300">{imagesCount}/۵ تصویر</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab("info")}
            className="mt-3 flex items-center justify-between w-full pt-2.5 border-t border-white/5 text-xs font-semibold text-cyan-300 hover:text-cyan-200 cursor-pointer"
          >
            <span>تکمیل اطلاعات کسب‌وکار</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Card 3: Public Link & QR Code (Contract Phase 2 mandate) */}
        <div className="relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c1424]/90 p-5 sm:p-6 backdrop-blur-xl shadow-lg transition-all hover:border-white/[0.15] hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20">
              <QrCode className="h-5 w-5" />
            </div>

            {business?.slug && (
              <button
                type="button"
                onClick={onOpenQrModal}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-2 py-1 rounded-lg border border-cyan-500/30 cursor-pointer transition-colors"
              >
                <span>دانلود QR</span>
                <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-1">صفحه مستقل و کد QR</h3>
            <p className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
              {publicUrl ? (
                <span className="truncate block font-mono text-cyan-300" dir="ltr">
                  {publicUrl}
                </span>
              ) : (
                "پس از تایید مدیر، آدرس صفحه مستقل و بارکد ویژه فعال خواهد شد."
              )}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
            {publicUrl ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-300 hover:text-white font-medium"
              >
                <span>مشاهده صفحه عمومی</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-slate-500">غیرفعال در حالت پیش‌نویس</span>
            )}

            <button
              type="button"
              onClick={() => onNavigateTab("qr")}
              className="text-slate-400 hover:text-white font-medium cursor-pointer"
            >
              تنظیمات پیوند
            </button>
          </div>
        </div>
      </div>

      {/* 3. Quick Action Navigation Row */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#09101d]/60 p-5 backdrop-blur-md">
        <h3 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-400" />
          <span>دسترسی‌های سریع به بخش‌های مدیریت:</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("info")}
            className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-cyan-500/30 transition-all cursor-pointer group text-center"
          >
            <span className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
              مشخصات و تلفن
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">نام، صنف و بیوگرافی</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("location")}
            className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-cyan-500/30 transition-all cursor-pointer group text-center"
          >
            <span className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
              موقعیت روی نقشه
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">ثبت دقیق پین فروشگاه</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("media")}
            className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-cyan-500/30 transition-all cursor-pointer group text-center"
          >
            <span className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
              لوگو و تصاویر
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">آپلود گالری و بنر</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("qr")}
            className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-cyan-500/30 transition-all cursor-pointer group text-center"
          >
            <span className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
              لینک و QR کد
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">دریافت بارکد چاپی</span>
          </button>
        </div>
      </section>
    </div>
  );
}
