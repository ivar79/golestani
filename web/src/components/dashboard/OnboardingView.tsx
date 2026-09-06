"use client";

import React from "react";
import { CreditCard, Palette, Sparkles, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";

interface OnboardingViewProps {
  onSelect: (path: number) => void;
  onSkip: () => void;
}

export function OnboardingView({ onSelect, onSkip }: OnboardingViewProps) {
  return (
    <div dir="rtl" className="relative min-h-screen bg-[#070d18] text-slate-100 flex flex-col items-center justify-center p-6 font-sans overflow-hidden">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute -top-40 right-1/4 w-96 h-96 bg-[#00c98d]/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 left-1/4 w-96 h-96 bg-[#3b82f6]/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#00c98d]/5 rounded-full blur-[160px] pointer-events-none" />

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none" 
        style={{
          backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)",
          backgroundSize: "24px 24px"
        }} 
      />

      <div className="relative z-10 max-w-5xl w-full my-auto py-12">
        {/* Header section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#00c98d]/10 border border-[#00c98d]/30 text-[#00c98d] text-xs font-bold mb-5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>راه‌اندازی هوشمند کسب‌وکار</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4 leading-tight">
            به <span className="bg-gradient-to-r from-white via-slate-100 to-[#00c98d] bg-clip-text text-transparent">اینکارت</span> خوش آمدید
          </h1>
          <p className="text-slate-400 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            برای ایجاد حضور دیجیتال و کارت ویزیت آنلاین خود، مناسب‌ترین مسیر را انتخاب کنید.
          </p>
        </div>

        {/* 3 Interactive Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Path 1: Already have a card */}
          <div
            onClick={() => onSelect(1)}
            className="group relative cursor-pointer bg-[#0b1626]/80 hover:bg-[#0f1d32] border border-[#1b2a42] hover:border-[#00c98d]/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-[#00c98d]/10 hover:-translate-y-1.5 flex flex-col backdrop-blur-xl"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-gradient-to-r from-transparent via-[#00c98d] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />
            
            <div className="w-14 h-14 rounded-2xl bg-[#00c98d]/10 border border-[#00c98d]/20 text-[#00c98d] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#00c98d] group-hover:text-[#070d18] transition-all duration-300 shadow-lg shadow-[#00c98d]/5">
              <CreditCard className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-white group-hover:text-[#00c98d] transition-colors">
                کارت فیزیکی دارم
              </h2>
            </div>
            
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              تصویر کارت ویزیت چاپی فعلی‌تان را آپلود کنید تا صفحه اختصاصی و QR هوشمند شما ساخته شود.
            </p>

            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-sm font-bold text-[#00c98d]">
              <span>شروع با آپلود کارت</span>
              <div className="w-8 h-8 rounded-full bg-[#00c98d]/10 flex items-center justify-center group-hover:bg-[#00c98d] group-hover:text-[#070d18] transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>

          {/* Path 2: Card Maker */}
          <div
            onClick={() => onSelect(2)}
            className="group relative cursor-pointer bg-[#0b1626]/80 hover:bg-[#0f1d32] border border-[#1b2a42] hover:border-[#38bdf8]/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-[#38bdf8]/10 hover:-translate-y-1.5 flex flex-col backdrop-blur-xl"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-gradient-to-r from-transparent via-[#38bdf8] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />
            
            <div className="w-14 h-14 rounded-2xl bg-[#38bdf8]/10 border border-[#38bdf8]/20 text-[#38bdf8] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#38bdf8] group-hover:text-[#070d18] transition-all duration-300 shadow-lg shadow-[#38bdf8]/5">
              <Palette className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-white group-hover:text-[#38bdf8] transition-colors">
                طراحی آنلاین کارت
              </h2>
            </div>
            
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              از بین ده‌ها قالب مدرن و آماده انتخاب کنید و در چند دقیقه کارت ویزیت دیجیتال شخصی بسازید.
            </p>

            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-sm font-bold text-[#38bdf8]">
              <span>ورود به کارت‌ساز</span>
              <div className="w-8 h-8 rounded-full bg-[#38bdf8]/10 flex items-center justify-center group-hover:bg-[#38bdf8] group-hover:text-[#070d18] transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>

          {/* Path 3: Designer Request */}
          <div
            onClick={() => onSelect(3)}
            className="group relative cursor-pointer bg-[#0b1626]/80 hover:bg-[#0f1d32] border border-[#1b2a42] hover:border-[#a855f7]/60 rounded-3xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-[#a855f7]/10 hover:-translate-y-1.5 flex flex-col backdrop-blur-xl"
          >
            <div className="absolute top-0 right-10 w-24 h-1 bg-gradient-to-r from-transparent via-[#a855f7] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />
            
            <div className="w-14 h-14 rounded-2xl bg-[#a855f7]/10 border border-[#a855f7]/20 text-[#a855f7] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#a855f7] group-hover:text-[#070d18] transition-all duration-300 shadow-lg shadow-[#a855f7]/5">
              <Sparkles className="w-7 h-7" />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-white group-hover:text-[#a855f7] transition-colors">
                سفارش به طراحان
              </h2>
            </div>
            
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              طراحی هویت بصری و کارت ویزیت خود را به طراحان برگزیده و تأییدشده ما بسپارید.
            </p>

            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-sm font-bold text-[#a855f7]">
              <span>مشاهده طراحان</span>
              <div className="w-8 h-8 rounded-full bg-[#a855f7]/10 flex items-center justify-center group-hover:bg-[#a855f7] group-hover:text-[#070d18] transition-all">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Skip button for complete freedom */}
        <div className="mt-12 text-center">
          <button
            onClick={onSkip}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white px-5 py-2.5 rounded-full hover:bg-white/5 transition-all"
          >
            <span>ورود مستقیم به پنل مدیریت کسب‌وکار (تنظیم دستی)</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
