"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  X,
  MapPin,
  Car,
  Heart,
  BookOpen,
  Utensils,
  Wrench,
  ChevronDown,
} from "lucide-react";
import { getAllProvinces, type ProvinceData } from "@/lib/iranGeo";

/**
 * تب‌های ۳گانه با حفظ کامل هویت بصری دارک آورورا
 */
type TabKey = "all" | "profession" | "city";

const POPULAR_SEARCHES = [
  "رستوران در تهران",
  "کافی شاپ",
  "طراحی سایت",
  "تعمیر خودرو",
  "دندانپزشک نزدیک من",
];

const CATEGORIES = [
  { name: "خودرو", icon: Car },
  { name: "زیبایی و سلامت", icon: Heart },
  { name: "آموزش", icon: BookOpen },
  { name: "غذا و نوشیدنی", icon: Utensils },
  { name: "خدمات منزل", icon: Wrench },
];

const FEATURED_CITIES = ["تهران", "کرج", "مشهد", "اصفهان", "شیراز", "تبریز", "گرگان", "رشت", "اهواز"];

const TOP_5_PROVINCES = ["تهران", "خوزستان", "فارس", "اصفهان", "خراسان رضوی"];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "همه" },
  { key: "profession", label: "بر اساس شغل و تخصص" },
  { key: "city", label: "بر اساس شهر و منطقه" },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);
  const [showAllProvinces, setShowAllProvinces] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNavigatingRef = useRef(false);

  // Reset navigation lock whenever modal open state changes
  useEffect(() => {
    if (isOpen) {
      isNavigatingRef.current = false;
    }
  }, [isOpen]);

  // Centralized, safe navigation: prevents race conditions and ensures clean modal closure
  const navigateTo = useCallback(
    (url: string) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      onClose();
      router.push(url);
    },
    [onClose, router]
  );

  // Lock scroll on open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Support ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    navigateTo(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const quickSearch = (term: string) => {
    navigateTo(`/search?q=${encodeURIComponent(term)}`);
  };

  const selectCity = (cityName: string) => {
    navigateTo(`/${encodeURIComponent(cityName)}`);
  };

  const showProfession = activeTab === "all" || activeTab === "profession";
  const showCity = activeTab === "all" || activeTab === "city";

  return (
    <div
      dir="rtl"
      data-search-menu
      className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:p-6 sm:pt-20 overflow-y-auto font-sans"
    >
      {/* Dark Ambient Backdrop */}
      <div
        className="fixed inset-0 bg-[#050B14]/85 backdrop-blur-xl transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Main Modal Container */}
      <div
        data-search-menu
        className="relative w-full max-w-4xl overflow-hidden rounded-none sm:rounded-3xl border-0 sm:border border-white/10 bg-[#0c1626]/95 backdrop-blur-2xl shadow-2xl shadow-cyan-950/40 my-auto z-10 flex flex-col max-h-[90vh]"
      >
        {/* Search input header */}
        <form
          onSubmit={handleSubmit}
          className="relative flex items-center px-4 sm:px-8 py-5 sm:py-6 border-b border-white/[0.08]"
        >
          <Search className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجوی کسب‌وکارها، خدمات یا مکان‌ها..."
            className="flex-1 bg-transparent border-none text-[16px] sm:text-[20px] font-normal text-white px-4 sm:px-6 outline-none placeholder:text-slate-400 focus:ring-0"
          />
          <div className="flex items-center gap-4 shrink-0">
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-xs sm:text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                پاک کردن
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </form>

        {/* 3 Tabs with real state */}
        <div className="flex items-center gap-6 sm:gap-10 px-4 sm:px-8 pt-3 sm:pt-4 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-[14px] sm:text-[15px] font-medium whitespace-nowrap transition-colors relative ${
                  active ? "text-cyan-400" : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 inset-x-0 h-[3px] bg-cyan-400 shadow-[0_-2px_15px_rgba(34,211,238,0.5)] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content Section */}
        <div className="flex flex-col gap-6 p-4 sm:p-8 overflow-y-auto">
          {/* Popular searches */}
          {showProfession && (
            <section className="flex flex-col gap-3">
              <h3 className="text-slate-400 font-medium text-[13px] tracking-wide">
                جستجوهای پرطرفدار
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {POPULAR_SEARCHES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => quickSearch(item)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-slate-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Categories */}
          {showProfession && (
            <section className="flex flex-col gap-3">
              <h3 className="text-slate-400 font-medium text-[13px] tracking-wide">
                دسته‌بندی‌ها
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {CATEGORIES.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => navigateTo(`/category/${encodeURIComponent(item.name)}`)}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-slate-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300 cursor-pointer"
                  >
                    <item.icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Cities & Provinces Nationwide Coverage */}
          {showCity && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-slate-400 font-medium text-[13px] tracking-wide">
                  شهرهای منتخب
                </h3>
                {selectedProvince && (
                  <button
                    onClick={() => setSelectedProvince(null)}
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    نمایش همه استان‌ها
                  </button>
                )}
              </div>

              {/* Quick prominent cities */}
              <div className="flex flex-wrap gap-2.5">
                {FEATURED_CITIES.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => selectCity(city)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-slate-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    {city}
                  </button>
                ))}
              </div>

              {/* Province Selector with Top 5 Primary Hubs + Expandable 26 Provinces */}
              <div className="mt-2 pt-4 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-slate-400 font-medium text-[13px] tracking-wide">
                    {selectedProvince
                      ? `شهرها و روستاهای استان ${selectedProvince.name}`
                      : "پوشش سراسری: استان‌های اصلی"}
                  </h3>
                  {selectedProvince && (
                    <button
                      type="button"
                      onClick={() => setSelectedProvince(null)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>بازگشت به استان‌ها</span>
                    </button>
                  )}
                </div>

                {selectedProvince ? (
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                    {selectedProvince.cities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => selectCity(c)}
                        className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1.5 text-[13px] text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    {/* Top 5 Primary Hubs + Expand Button */}
                    <div className="flex flex-wrap items-center gap-2">
                      {TOP_5_PROVINCES.map((name) => {
                        const prov = getAllProvinces().find((p) => p.name === name);
                        if (!prov) return null;
                        return (
                          <button
                            key={prov.slug}
                            type="button"
                            onClick={() => setSelectedProvince(prov)}
                            className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-medium text-slate-200 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-300 transition-all flex items-center gap-1.5 group cursor-pointer"
                          >
                            <span>{prov.name}</span>
                            <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                          </button>
                        );
                      })}

                      {/* Chic Expand Toggle Button */}
                      <button
                        type="button"
                        onClick={() => setShowAllProvinces((prev) => !prev)}
                        className={`rounded-xl border px-3.5 py-1.5 text-[13px] font-medium transition-all flex items-center gap-2 cursor-pointer ${
                          showAllProvinces
                            ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
                            : "border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-400/50"
                        }`}
                        aria-label={showAllProvinces ? "بستن سایر استان‌ها" : "مشاهده سایر استان‌ها"}
                      >
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-cyan-400/20 text-cyan-300 text-xs font-bold leading-none">
                          {showAllProvinces ? "−" : "+"}
                        </span>
                        <span>{showAllProvinces ? "بستن سایر استان‌ها" : "سایر استان‌ها (۲۶)"}</span>
                      </button>
                    </div>

                    {/* Smooth Expandable Container for other 26 provinces */}
                    {showAllProvinces && (
                      <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 animate-in fade-in slide-in-from-top-2 duration-200">
                        {getAllProvinces()
                          .filter((p) => !TOP_5_PROVINCES.includes(p.name))
                          .map((p) => (
                            <button
                              key={p.slug}
                              type="button"
                              onClick={() => setSelectedProvince(p)}
                              className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[13px] text-slate-300 hover:border-cyan-400/30 hover:bg-white/[0.07] hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <span>{p.name}</span>
                              <ChevronDown className="w-3 h-3 text-slate-500" />
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Discover Card with Aurora Discovery Banner */}
          <div
            className="relative overflow-hidden rounded-2xl min-h-[145px] sm:min-h-[175px] border border-cyan-500/20 group cursor-pointer shadow-2xl bg-[#060b14] mt-3 transition-all duration-300 hover:border-cyan-400/50 hover:shadow-[0_0_30px_rgba(6,182,212,0.25)]"
            onClick={() => navigateTo("/search")}
          >
            {/* Aurora Background Image */}
            <Image
              src="/assets/discovery-banner.jpg"
              alt="کشف کسب‌وکارهای شگفت‌انگیز در اطراف شما"
              fill
              className="object-cover object-center opacity-70 group-hover:scale-105 group-hover:opacity-85 transition-all duration-700 ease-out"
              priority={false}
            />

            {/* Gradient Overlays for High Contrast Readability */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/60 to-transparent z-[1]" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent z-[1]" />

            {/* Foreground Content */}
            <div className="absolute inset-0 p-5 sm:p-6 flex flex-col justify-between z-10">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/30 px-2.5 py-0.5 rounded-full mb-2.5 backdrop-blur-md shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  کاوش هوشمند و زنده
                </span>
                <h4 className="text-white font-bold text-[16px] sm:text-[19px] leading-snug drop-shadow-md mb-1.5 group-hover:text-cyan-200 transition-colors">
                  کشف کسب‌وکارهای شگفت‌انگیز در اطراف شما
                </h4>
                <p className="text-slate-300/90 text-[13px] drop-shadow leading-relaxed max-w-md">
                  مشاهده نقشه تعاملی و نزدیک‌ترین خدمات و کسب‌وکارها در منطقه شما
                </p>
              </div>
              <div className="self-end flex h-11 w-11 items-center justify-center rounded-full bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 backdrop-blur-md group-hover:scale-110 group-hover:bg-cyan-500/30 group-hover:text-white transition-all shadow-[0_0_20px_rgba(6,182,212,0.35)]">
                <MapPin className="h-5 w-5" strokeWidth={2} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
