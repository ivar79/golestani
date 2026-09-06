"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
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
import { IRAN_PROVINCES, getAllProvinces, type ProvinceData } from "@/lib/iranGeo";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
    onClose();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const quickSearch = (term: string) => {
    onClose();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const selectCity = (cityName: string) => {
    onClose();
    router.push(`/search?city=${encodeURIComponent(cityName)}`);
  };

  const showProfession = activeTab === "all" || activeTab === "profession";
  const showCity = activeTab === "all" || activeTab === "city";

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:p-6 sm:pt-20 overflow-y-auto font-sans"
    >
      {/* Dark Ambient Backdrop */}
      <div
        className="fixed inset-0 bg-[#050B14]/85 backdrop-blur-xl transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Main Modal Container */}
      <div className="relative w-full max-w-4xl overflow-hidden rounded-none sm:rounded-3xl border-0 sm:border border-white/10 bg-[#0c1626]/95 backdrop-blur-2xl shadow-2xl shadow-cyan-950/40 my-auto z-10 flex flex-col max-h-[90vh]">
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
                  <Link
                    key={item.name}
                    href={`/category/${item.name}`}
                    onClick={onClose}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-slate-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    <item.icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    {item.name}
                  </Link>
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

              {/* Province Selector for 100% Nationwide Village/City Coverage */}
              <div className="mt-2 pt-4 border-t border-white/[0.06]">
                <h3 className="text-slate-400 font-medium text-[13px] tracking-wide mb-3">
                  {selectedProvince
                    ? `شهرها و روستاهای استان ${selectedProvince.name}`
                    : "پوشش سراسری: انتخاب استان"}
                </h3>

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
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1 no-scrollbar">
                    {getAllProvinces().map((p) => (
                      <button
                        key={p.slug}
                        type="button"
                        onClick={() => setSelectedProvince(p)}
                        className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[13px] text-slate-300 hover:border-cyan-400/30 hover:bg-white/[0.07] hover:text-white transition-colors flex items-center gap-1.5"
                      >
                        <span>{p.name}</span>
                        <ChevronDown className="w-3 h-3 text-slate-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Discover Card */}
          <div
            className="relative overflow-hidden rounded-2xl min-h-[140px] sm:min-h-[170px] border border-white/[0.05] group cursor-pointer shadow-xl bg-[#070d18] mt-2"
            onClick={() => {
              onClose();
              router.push("/search");
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-950/40 to-emerald-950/30" />
            <div className="absolute inset-0 p-5 sm:p-7 flex flex-col justify-between z-10">
              <div>
                <h4 className="text-white font-bold text-[16px] sm:text-[18px] leading-snug mb-1">
                  کشف کسب‌وکارهای شگفت‌انگیز در اطراف شما
                </h4>
                <p className="text-slate-400 text-[13px]">
                  مشاهده نقشه تعاملی و نزدیک‌ترین خدمات در منطقه خود
                </p>
              </div>
              <div className="self-end flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-400 group-hover:scale-110 transition-transform">
                <MapPin className="h-5 w-5" strokeWidth={1.5} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
