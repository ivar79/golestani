"use client";

import React from "react";
import { CreditCard, Palette, Sparkles, ArrowLeft } from "lucide-react";

interface OnboardingViewProps {
  onSelect: (path: number) => void;
  onSkip: () => void;
}

/**
 * Onboarding — rendered inside the dashboard shell, so ik-* tokens follow
 * the active theme automatically. The three paths keep semantic distinction
 * through success / accent / rose hues, remapped per theme.
 */
export function OnboardingView({ onSelect, onSkip }: OnboardingViewProps) {
  return (
    <div
      dir="rtl"
      className="relative min-h-screen bg-ik-bg text-ik-text flex flex-col items-center justify-center p-6 font-sans overflow-hidden"
    >
      {/* Dynamic Ambient Background Glows — theme-aware */}
      <div className="absolute -top-40 right-1/4 w-96 h-96 bg-ik-success/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 left-1/4 w-96 h-96 bg-ik-accent/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-ik-accent/5 rounded-full blur-[160px] pointer-events-none" />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 max-w-5xl w-full my-auto py-12">
        {/* Header section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-ik-success/10 border border-ik-success/30 text-ik-success text-xs font-bold mb-5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>راه‌اندازی هوشمند کسب‌وکار</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-ik-text tracking-tight mb-4 leading-tight">
            به <span className="text-ik-accent">اینکارت</span> خوش آمدید
          </h1>
          <p className="text-ik-muted text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            برای ایجاد حضور دیجیتال و کارت ویزیت آنلاین خود، مناسب‌ترین مسیر را انتخاب کنید.
          </p>
        </div>

        {/* 3 Interactive Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Path 1: Already have a card */}
          <div
            onClick={() => onSelect(1)}
            className="group relative cursor-pointer bg-ik-panel hover:bg-ik-panel-hover border border-ik-border hover:border-ik-success/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-ik-success/10 hover:-translate-y-1.5 flex flex-col"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-ik-success opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />

            <div className="w-14 h-14 rounded-2xl bg-ik-success/10 border border-ik-success/20 text-ik-success flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-ik-success group-hover:text-ik-accent-contrast transition-all duration-300 shadow-lg shadow-ik-success/5">
              <CreditCard className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-ik-text group-hover:text-ik-success transition-colors">
                کارت فیزیکی دارم
              </h2>
            </div>

            <p className="text-sm text-ik-muted leading-relaxed mb-8 flex-1">
              تصویر کارت ویزیت چاپی فعلی‌تان را آپلود کنید تا صفحه اختصاصی و QR هوشمند شما ساخته شود.
            </p>

            <div className="pt-4 border-t border-ik-border flex items-center justify-between text-sm font-bold text-ik-success">
              <span>شروع با آپلود کارت</span>
              <div className="w-8 h-8 rounded-full bg-ik-success/10 flex items-center justify-center group-hover:bg-ik-success group-hover:text-ik-accent-contrast transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>

          {/* Path 2: Card Maker */}
          <div
            onClick={() => onSelect(2)}
            className="group relative cursor-pointer bg-ik-panel hover:bg-ik-panel-hover border border-ik-border hover:border-ik-accent/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-ik-accent/10 hover:-translate-y-1.5 flex flex-col"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-ik-accent opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />

            <div className="w-14 h-14 rounded-2xl bg-ik-accent/10 border border-ik-accent/20 text-ik-accent flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-ik-accent group-hover:text-ik-accent-contrast transition-all duration-300 shadow-lg shadow-ik-accent/5">
              <Palette className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-ik-text group-hover:text-ik-accent transition-colors">
                طراحی آنلاین کارت
              </h2>
            </div>

            <p className="text-sm text-ik-muted leading-relaxed mb-8 flex-1">
              از بین ده‌ها قالب مدرن و آماده انتخاب کنید و در چند دقیقه کارت ویزیت دیجیتال شخصی بسازید.
            </p>

            <div className="pt-4 border-t border-ik-border flex items-center justify-between text-sm font-bold text-ik-accent">
              <span>ورود به کارت‌ساز</span>
              <div className="w-8 h-8 rounded-full bg-ik-accent/10 flex items-center justify-center group-hover:bg-ik-accent group-hover:text-ik-accent-contrast transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>

          {/* Path 3: Designer Request */}
          <div
            onClick={() => onSelect(3)}
            className="group relative cursor-pointer bg-ik-panel hover:bg-ik-panel-hover border border-ik-border hover:border-ik-danger/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-ik-danger/10 hover:-translate-y-1.5 flex flex-col"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-ik-danger opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />

            <div className="w-14 h-14 rounded-2xl bg-ik-danger/10 border border-ik-danger/20 text-ik-danger flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-ik-danger group-hover:text-ik-accent-contrast transition-all duration-300 shadow-lg shadow-ik-danger/5">
              <Sparkles className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-ik-text group-hover:text-ik-danger transition-colors">
                سفارش به طراحان
              </h2>
            </div>

            <p className="text-sm text-ik-muted leading-relaxed mb-8 flex-1">
              طراحی هویت بصری و کارت ویزیت خود را به طراحان برگزیده و تأییدشده ما بسپارید.
            </p>

            <div className="pt-4 border-t border-ik-border flex items-center justify-between text-sm font-bold text-ik-danger">
              <span>مشاهده طراحان</span>
              <div className="w-8 h-8 rounded-full bg-ik-danger/10 flex items-center justify-center group-hover:bg-ik-danger group-hover:text-ik-accent-contrast transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Skip button for complete freedom */}
        <div className="mt-12 text-center">
          <button
            onClick={onSkip}
            className="inline-flex items-center gap-2 text-sm text-ik-muted hover:text-ik-text px-5 py-2.5 rounded-full hover:bg-ik-wash transition-all cursor-pointer"
          >
            <span>ورود مستقیم به پنل مدیریت کسب‌وکار (تنظیم دستی)</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
