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
} from "lucide-react";

/**
 * تب‌های ساده و شفاف (بازخورد کارفرما): ۳ تب اصلی به‌جای ۵ تب هم‌پوشان.
 * «همه» هر دو گروه چیپ را نشان می‌دهد؛ دو تب دیگر فقط گروه خودشان را.
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

const CITIES = ["تهران", "کرج", "مشهد", "اصفهان", "شیراز", "تبریز"];

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
  const inputRef = useRef<HTMLInputElement>(null);

  // قفل کردن اسکرول صفحه و فوکوس روی اینپوت هنگام باز شدن مدال
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      if (window.matchMedia("(min-width: 640px)").matches) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // پشتیبانی از دکمه ESC برای بستن
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      onClose();
    }
  };


  const showProfession = activeTab === "all" || activeTab === "profession";
  const showCity = activeTab === "all" || activeTab === "city";

  // ورود مستقیم به نتایج با یک کلیک روی چیپ (افزایش نرخ کلیک)
  const quickSearch = (term: string) => {
    router.push(`/search?q=${encodeURIComponent(term)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-stretch sm:items-center justify-end sm:justify-start sm:pt-[10vh] px-0 sm:px-4 md:px-8">
      {/* لایه تاریک پس‌زمینه (Backdrop) */}
      <div
        className="absolute inset-0 bg-night/90 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* هاله‌های شفقی پشت پنل (Aurora Glow) */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[8%] -translate-x-1/2 w-[90vw] max-w-[900px] h-[320px] rounded-full bg-cyan-500/20 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute left-[15%] bottom-[5%] w-[40vw] max-w-[420px] h-[260px] rounded-full bg-purple-600/15 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute right-[10%] top-[25%] w-[35vw] max-w-[380px] h-[220px] rounded-full bg-blue-500/15 blur-[100px]" />

      {/* باکس اصلی مدال */}
      <div className="relative w-full max-w-[1050px] rounded-t-[28px] sm:rounded-[28px] max-h-[92dvh] sm:max-h-none p-px bg-gradient-to-b from-cyan-400/40 via-purple-500/25 to-blue-500/40 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8),0_0_60px_-10px_rgba(34,211,238,0.15)] animate-in fade-in zoom-in-[0.98] duration-300 ease-out">
        <div className="flex flex-col overflow-hidden rounded-t-[27px] sm:rounded-[27px] max-h-[calc(92dvh-2px)] sm:max-h-none bg-[#0f172a]/70 backdrop-blur-2xl">
        
        {/* هدر: فرم جستجو */}
        <form onSubmit={handleSearch} className="flex items-center mx-3 mt-3 sm:mx-6 sm:mt-5 px-4 sm:px-6 py-3 sm:py-4 rounded-full border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] focus-within:border-cyan-400/30 focus-within:bg-white/[0.06] transition-colors">
          <Search className="h-5 w-5 sm:h-7 sm:w-7 text-surface-variant/60 shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجوی کسب‌وکارها، خدمات یا مکان‌ها..."
            className="flex-1 bg-transparent border-none text-[17px] sm:text-[22px] font-light text-white px-4 sm:px-6 outline-none placeholder:text-surface-variant/40 focus:ring-0"
          />
          <div className="flex items-center gap-5 shrink-0">
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-sm font-medium text-surface-variant hover:text-white transition-colors"
              >
                پاک کردن
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-white/5 border border-white/10 text-surface-variant hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden text-surface-variant hover:text-white"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </form>

        {/* تب‌ها — ۳ تب با سوئیچ واقعی */}
        <div className="flex items-center gap-6 sm:gap-10 px-4 sm:px-10 mt-4 sm:mt-6 pt-3 sm:pt-5 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-pressed={active}
                className={`pb-3.5 sm:pb-5 text-[14px] sm:text-[15px] font-medium whitespace-nowrap transition-colors relative ${
                  active ? "text-cyan-400" : "text-surface-variant hover:text-white"
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

        {/* فیلترهای حبابی (Chip Filters) — کلیک سریع، ورود مستقیم به نتایج */}
        <div className="flex flex-col gap-7 sm:gap-9 p-4 sm:p-10 overflow-y-auto">

          {showProfession && (
            <section className="flex flex-col gap-3 sm:gap-4">
              <h3 className="text-surface-variant/60 font-medium text-[13px] tracking-wide">جستجوهای پرطرفدار</h3>
              <div className="flex flex-wrap gap-2.5">
                {POPULAR_SEARCHES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => quickSearch(item)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-surface-variant/90 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          )}

          {showProfession && (
            <section className="flex flex-col gap-3 sm:gap-4">
              <h3 className="text-surface-variant/60 font-medium text-[13px] tracking-wide">دسته‌بندی‌ها</h3>
              <div className="flex flex-wrap gap-2.5">
                {CATEGORIES.map((item) => (
                  <Link
                    key={item.name}
                    href={`/category/${item.name}`}
                    onClick={onClose}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-surface-variant/90 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    <item.icon className="h-4 w-4 text-surface-variant/50" strokeWidth={1.5} />
                    {item.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {showCity && (
            <section className="flex flex-col gap-3 sm:gap-4">
              <h3 className="text-surface-variant/60 font-medium text-[13px] tracking-wide">شهرها و مناطق</h3>
              <div className="flex flex-wrap gap-2.5">
                {CITIES.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => quickSearch(city)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] text-surface-variant/90 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    {city}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* کارت چهارم: Discover Card */}
          <div className="relative overflow-hidden rounded-[20px] min-h-[140px] sm:min-h-[200px] border border-white/[0.05] group cursor-pointer shadow-xl bg-night" onClick={onClose}>
            {/* تصویر پس‌زمینه آورورا */}
            <Image
              src="/assets/search-bg.jpg"
              alt="کشف کسب‌وکارهای اطراف شما"
              fill
              sizes="(min-width: 1050px) 950px, 90vw"
              className="object-cover opacity-60 transition-transform duration-1000 group-hover:scale-110 group-hover:opacity-80 mix-blend-lighten"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#050B14] via-[#050B14]/60 to-transparent" />
            
            <div className="absolute inset-0 p-5 sm:p-7 flex flex-col">
              <div className="mb-auto">
                <h4 className="text-white font-semibold text-[17px] leading-[1.5] tracking-tight mb-2">
                  کشف کسب‌وکارهای شگفت‌انگیز در اطراف شما
                </h4>
                <p className="text-surface-variant/70 text-[13px] leading-relaxed">
                  بهترین خدمات را در منطقه خود پیدا کنید
                </p>
              </div>

              {/* آیکون پین درخشان */}
              <div className="self-end flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 backdrop-blur-md border border-cyan-400/30 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all duration-500 group-hover:scale-110 group-hover:bg-cyan-500/20 group-hover:shadow-[0_0_35px_rgba(34,211,238,0.4)] group-hover:border-cyan-400/50">
                <MapPin className="h-5 w-5" strokeWidth={1.5} />
              </div>
            </div>
          </div>

        </div>
        </div>
      </div>

      {/* پنل راهنمای کلیدهای میانبر در پایین (فقط دسکتاپ) */}
      <div className="relative mt-8 hidden sm:flex items-center gap-10 rounded-2xl border border-white/[0.04] bg-[#0f172a]/60 backdrop-blur-2xl px-8 py-3.5 text-[13px] text-surface-variant/80 shadow-2xl">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <kbd className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] font-sans shadow-sm">↑</kbd>
            <kbd className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] font-sans shadow-sm">↓</kbd>
          </span>
          پیمایش
        </span>
        <span className="flex items-center gap-3">
          <kbd className="flex h-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 font-sans text-[11px] tracking-wider shadow-sm">ENTER</kbd>
          جستجو
        </span>
        <span className="flex items-center gap-3">
          <kbd className="flex h-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 font-sans text-[11px] tracking-wider shadow-sm">ESC</kbd>
          بستن
        </span>
      </div>
    </div>
  );
}
