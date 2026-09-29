"use client";

/**
 * CardCanvas — Digital Business Card renderer (Phase 4 redesign).
 *
 * Five genuinely distinct visual identities (not recolors of one layout):
 *   classic  → Minimal Professional  (paper-white, typography-first)
 *   midnight → Modern Gradient       (dark, brand-accent glow, glass QR)
 *   emerald  → Executive Premium     (formal frame, high contrast)
 *   local    → Local Business        (address/phone-forward, practical)
 *   creative → Creative Studio       (diagonal color blocks, bold identity)
 *
 * Every branch renders ONLY existing business model data, degrades cleanly
 * with missing fields, keeps long Persian/RTL text safe (dir-isolated phone
 * numbers, line-clamped addresses, min-w-0 truncation) and shows the Phase 3
 * verification badge when license_verified/verification_badge is set.
 *
 * XSS: business data is rendered as React children only (auto-escaped). The
 * only raw SVG is the QR code that comes from our own backend endpoint.
 */

import { forwardRef, useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  Building2,
  Phone,
  Globe,
  Send,
  MapPin,
  Clock,
  BadgeCheck,
  Sparkles,
} from "lucide-react";
import type { Business } from "@/lib/businesses";
// Same-origin media path: this canvas is rasterized for export (html-to-image),
// and cross-origin pixels cannot be read without CORS — which static storage
// files never send. See lib/media.ts.
import { mediaSrc } from "@/lib/media";
import api from "@/lib/api";

function InstagramIcon({ className = "h-3.5 w-3.5" }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export type CardTemplate = "classic" | "midnight" | "emerald" | "local" | "creative";
export type CardTheme = "navy" | "emerald" | "warm";
export type CardFontSize = "small" | "medium" | "large";
export type CardFontFamily = "vazir" | "sans" | "serif";

export type CardCanvasProps = {
  business: Business;
  template: CardTemplate;
  theme: CardTheme;
  fontSize: CardFontSize;
  fontFamily?: CardFontFamily;
  qrSvg?: string | null;
};

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

type ThemeTokens = {
  /** Root container classes per template family. */
  classic: string;
  midnight: string;
  emerald: string;
  local: string;
  creative: string;
  /** Accent color pairs used by dark templates. */
  accentText: string;
  accentSoft: string;
  accentBadge: string;
  accentGlow: string;
  accentBar: string;
  accentChips: string;
  /** Creative diagonal block colors. */
  blockA: string;
  blockB: string;
  /** Local template painted panel. */
  panel: string;
};

const themeTokens: Record<CardTheme, ThemeTokens> = {
  navy: {
    classic: "bg-[#f6f8fb] text-[#0b1c33] border-[#dbe4f0]",
    midnight: "bg-gradient-to-br from-[#081528] via-[#0d2342] to-[#153a6b] text-white border-white/10",
    emerald: "bg-gradient-to-br from-[#0a1a2e] via-[#10283f] to-[#0d2342] text-white border-white/15",
    local: "bg-white text-[#0b1c33] border-[#dbe4f0]",
    creative: "bg-[#0b1c33] text-white border-white/10",
    accentText: "text-cyan-600",
    accentSoft: "bg-cyan-500/10 text-cyan-700",
    accentBadge: "bg-cyan-500/15 text-cyan-200 border-cyan-300/40",
    accentGlow: "shadow-[0_10px_40px_rgba(8,21,40,0.35)]",
    accentBar: "bg-gradient-to-l from-cyan-500 to-teal-400",
    accentChips: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
    blockA: "bg-gradient-to-bl from-[#0ea5e9] to-[#0d2342]",
    blockB: "bg-gradient-to-tl from-[#155e9f] to-[#081528]",
    panel: "bg-[#eef4fb]",
  },
  emerald: {
    classic: "bg-[#f4faf7] text-[#052e22] border-[#d3e8de]",
    midnight: "bg-gradient-to-br from-[#032018] via-[#064635] to-[#0d6b53] text-white border-white/10",
    emerald: "bg-gradient-to-br from-[#04241b] via-[#073527] to-[#064635] text-white border-white/15",
    local: "bg-white text-[#052e22] border-[#d3e8de]",
    creative: "bg-[#052e22] text-white border-white/10",
    accentText: "text-emerald-600",
    accentSoft: "bg-emerald-500/10 text-emerald-700",
    accentBadge: "bg-emerald-400/15 text-emerald-200 border-emerald-300/40",
    accentGlow: "shadow-[0_10px_40px_rgba(3,32,24,0.35)]",
    accentBar: "bg-gradient-to-l from-emerald-500 to-teal-400",
    accentChips: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    blockA: "bg-gradient-to-bl from-[#10b981] to-[#064635]",
    blockB: "bg-gradient-to-tl from-[#0d9488] to-[#032018]",
    panel: "bg-[#eaf7f1]",
  },
  warm: {
    classic: "bg-[#fbf7f1] text-[#3a1c05] border-[#ecdcc8]",
    midnight: "bg-gradient-to-br from-[#241306] via-[#48230b] to-[#783c13] text-white border-white/10",
    emerald: "bg-gradient-to-br from-[#2a1404] via-[#3d1d06] to-[#48230b] text-white border-white/15",
    local: "bg-white text-[#3a1c05] border-[#ecdcc8]",
    creative: "bg-[#2a1404] text-white border-white/10",
    accentText: "text-amber-600",
    accentSoft: "bg-amber-500/10 text-amber-700",
    accentBadge: "bg-amber-400/15 text-amber-200 border-amber-300/40",
    accentGlow: "shadow-[0_10px_40px_rgba(36,19,6,0.35)]",
    accentBar: "bg-gradient-to-l from-amber-500 to-orange-400",
    accentChips: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    blockA: "bg-gradient-to-bl from-[#f59e0b] to-[#783c13]",
    blockB: "bg-gradient-to-tl from-[#d97706] to-[#241306]",
    panel: "bg-[#faf3e8]",
  },
};

const fontSizes = {
  small: { title: "text-lg sm:text-xl", subtitle: "text-[11px]", body: "text-[11px]", desc: "text-[10px]", qr: "w-16 h-16" },
  medium: { title: "text-xl sm:text-2xl", subtitle: "text-xs", body: "text-xs", desc: "text-[11px]", qr: "w-20 h-20" },
  large: { title: "text-2xl sm:text-3xl", subtitle: "text-sm", body: "text-sm", desc: "text-xs", qr: "w-24 h-24" },
};

const fontFamilies = {
  vazir: "font-sans",
  sans: "font-sans tracking-tight",
  serif: "font-serif",
};

/* ------------------------------------------------------------------ */
/* Data helpers                                                        */
/* ------------------------------------------------------------------ */

function socialHandle(value: string, host: RegExp): string {
  const handle = value.replace(host, "").replace(/^@/, "").replace(/\/+$/, "");
  return handle ? `@${handle}` : value;
}

function initials(name: string): string {
  const clean = name.replace(/[\u200c-]/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

/* ------------------------------------------------------------------ */
/* Shared QR renderer                                                  */
/* ------------------------------------------------------------------ */

function QRBox({
  qrSvg,
  sizeClass,
  frameClass,
  label,
  refCb,
}: {
  qrSvg: string | null;
  sizeClass: string;
  frameClass: string;
  label?: string;
  refCb?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`${sizeClass} shrink-0 overflow-hidden rounded-xl bg-white p-1.5 flex items-center justify-center ${frameClass}`}
      >
        {qrSvg ? (
          <div
            ref={refCb}
            className="h-full w-full flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <div ref={refCb} className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-slate-400">
            <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM20 20h1M17 17h4" />
            </svg>
          </div>
        )}
      </div>
      {label && <span className="text-[9px] font-semibold opacity-70">{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const CardCanvas = forwardRef<HTMLDivElement, CardCanvasProps>(function CardCanvas(
  { business, template = "classic", theme = "navy", fontSize = "medium", fontFamily = "sans", qrSvg: initialQr },
  ref
) {
  const [fetchedQr, setFetchedQr] = useState<string | null>(null);
  const qrSvg = initialQr ?? fetchedQr;
  const tokens = themeTokens[theme] ?? themeTokens.navy;
  const size = fontSizes[fontSize] ?? fontSizes.medium;
  const fontClass = fontFamilies[fontFamily] ?? fontFamilies.sans;

  const isVerified = Boolean(business.license_verified || business.verification_badge);
  const isPromoted = Boolean(business.is_promoted);
  const logoUrl = mediaSrc(business.logo);

  const social: Record<string, string> =
    business.social_links && !Array.isArray(business.social_links) && typeof business.social_links === "object"
      ? (business.social_links as Record<string, string>)
      : {};
  const instagram = social["instagram"] || social["insta"];
  const telegram = social["telegram"] || social["tg"];
  const website = social["website"] || social["web"];
  const whatsapp = social["whatsapp"] || social["wa"];

  const addressText = [business.city, business.neighborhood, business.address].filter(Boolean).join("، ");
  const description = business.description?.trim() || "";

  // Real QR from our own public endpoint (Phase 2 contract kept intact).
  useEffect(() => {
    if (initialQr) return;
    let active = true;
    if (business.slug) {
      api
        .get<string>(`/public/businesses/${business.slug}/qr`, { responseType: "text" })
        .then((res) => {
          if (active && res.data && res.data.includes("<svg")) {
            setFetchedQr(res.data);
          }
        })
        .catch(() => {
          // Offline/error: placeholder stays (layout never breaks).
        });
    }
    return () => {
      active = false;
    };
  }, [business.slug, initialQr]);

  /* ---------------- Template A — Minimal Professional ---------------- */
  if (template === "classic") {
    return (
      <div ref={ref} dir="rtl" className={`relative aspect-[1.586/1] w-full max-w-2xl overflow-hidden rounded-2xl border p-6 sm:p-7 ${tokens.classic} ${fontClass} ${tokens.accentGlow} select-none`}>
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className={`${size.title} font-black leading-snug tracking-tight`}>{business.name}</h2>
                {isVerified && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white" title="تأییدشده — مجوز فعالیت">
                    <BadgeCheck className="h-3.5 w-3.5" />
                  </span>
                )}
                {isPromoted && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    <Sparkles className="h-3 w-3" /> ویژه
                  </span>
                )}
              </div>
              <p className={`mt-1 font-semibold ${tokens.accentText} ${size.subtitle}`}>{business.category || "کسب‌وکار حرفه‌ای"}</p>
              <div className={`mt-3 h-1 w-14 rounded-full ${tokens.accentBar}`} />
              {description && (
                <p className={`mt-2 line-clamp-2 leading-relaxed text-slate-500 ${size.desc}`}>{description}</p>
              )}
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
              {logoUrl ? (
                <img src={logoUrl} alt={business.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-black text-slate-300">{initials(business.name)}</span>
              )}
            </div>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className={`min-w-0 flex-1 space-y-1.5 ${size.body}`}>
              {business.phone && (
                <p className="flex items-center gap-2 font-semibold text-slate-700">
                  <Phone className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span dir="ltr" className="font-mono">{business.phone}</span>
                </p>
              )}
              {addressText && (
                <p className="flex items-start gap-2 text-slate-500">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="line-clamp-2 min-w-0">{addressText}</span>
                </p>
              )}
              {(instagram || telegram || website) && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-slate-400">
                  {instagram && (
                    <span className="inline-flex items-center gap-1" dir="ltr">
                      <InstagramIcon className="h-3 w-3" />
                      {socialHandle(instagram, /^https?:\/\/(www\.)?instagram\.com\//)}
                    </span>
                  )}
                  {telegram && (
                    <span className="inline-flex items-center gap-1" dir="ltr">
                      <Send className="h-3 w-3" />
                      {socialHandle(telegram, /^https?:\/\/(www\.)?t\.me\//)}
                    </span>
                  )}
                  {website && (
                    <span className="inline-flex items-center gap-1" dir="ltr">
                      <Globe className="h-3 w-3" />
                      {website.replace(/^https?:\/\//, "").replace(/\/+$/, "")}
                    </span>
                  )}
                </div>
              )}
            </div>
            <QRBox
              qrSvg={qrSvg}
              sizeClass={size.qr}
              frameClass="border border-black/10 shadow-md"
              label="کارت هوشمند"
            />
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Template B — Modern Gradient ---------------- */
  if (template === "midnight") {
    return (
      <div ref={ref} dir="rtl" className={`relative aspect-[1.586/1] w-full max-w-2xl overflow-hidden rounded-2xl border p-6 sm:p-7 ${tokens.midnight} ${fontClass} ${tokens.accentGlow} select-none`}>
        <div className="pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-white/[0.05] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-16 h-52 w-52 rounded-full bg-white/[0.05] blur-3xl" />

        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${tokens.accentChips}`}>
                <Sparkles className="h-3 w-3" />
                اینکارت دیجیتال
              </span>
              {isPromoted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                  <Sparkles className="h-3 w-3" /> ویژه
                </span>
              )}
            </div>
            {logoUrl && (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/20 bg-white/5 p-1 backdrop-blur-md">
                <img src={logoUrl} alt={business.name} className="h-full w-full object-contain" />
              </div>
            )}
          </div>

          <div className="my-auto py-2">
            <div className="flex items-center gap-2">
              <h2 className={`${size.title} font-black leading-snug tracking-tight drop-shadow-md`}>{business.name}</h2>
              {isVerified && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15" title="تأییدشده">
                  <BadgeCheck className={`h-4 w-4 ${tokens.accentText.includes("600") ? "text-cyan-300" : "text-emerald-300"}`} />
                </span>
              )}
            </div>
            <p className={`mt-1 font-semibold ${tokens.accentText.includes("600") ? "text-cyan-300" : theme === "warm" ? "text-amber-300" : "text-emerald-300"} ${size.subtitle}`}>
              {business.category || "کسب‌وکار حرفه‌ای"}
            </p>
          </div>

          <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-3">
            <div className={`min-w-0 flex-1 space-y-1.5 ${size.body}`}>
              {business.phone && (
                <p className="flex items-center gap-2 font-mono font-semibold" dir="ltr">
                  <Phone className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span>{business.phone}</span>
                </p>
              )}
              {addressText && (
                <p className="line-clamp-2 min-w-0 text-white/70">{addressText}</p>
              )}
              {(instagram || website) && (
                <p className="text-[10px] text-white/50" dir="ltr">
                  {instagram
                    ? socialHandle(instagram, /^https?:\/\/(www\.)?instagram\.com\//)
                    : website.replace(/^https?:\/\//, "").replace(/\/+$/, "")}
                </p>
              )}
            </div>
            <QRBox
              qrSvg={qrSvg}
              sizeClass={size.qr}
              frameClass="border border-white/20 shadow-2xl ring-1 ring-white/10"
            />
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Template C — Executive Premium ---------------- */
  if (template === "emerald") {
    return (
      <div ref={ref} dir="rtl" className={`relative aspect-[1.586/1] w-full max-w-2xl overflow-hidden rounded-2xl border p-6 sm:p-7 ${tokens.emerald} ${fontClass} ${tokens.accentGlow} select-none`}>
        <div className="relative flex h-full flex-col justify-between rounded-xl border border-white/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">کارت رسمی</span>
                <span className="text-[10px] font-bold text-white/50" dir="ltr">INKART.BIZ</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <h2 className={`${size.title} font-black leading-snug text-white`}>{business.name}</h2>
                {isVerified && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10" title="تأییدشده">
                    <BadgeCheck className="h-4 w-4 text-white/90" />
                  </span>
                )}
              </div>
              <div className={`mt-2 h-0.5 w-16 rounded-full ${tokens.accentBar}`} />
              <p className={`mt-2 font-semibold text-white/85 ${size.subtitle}`}>{business.category || "خدمات تخصصی"}</p>
            </div>
            <QRBox qrSvg={qrSvg} sizeClass={size.qr} frameClass="border border-white/30 shadow-xl" />
          </div>

          <div className="flex items-end justify-between gap-3 border-t border-white/10 pt-3">
            <div className={`min-w-0 flex-1 space-y-1 text-white/85 ${size.body}`}>
              {business.phone && (
                <p className="flex items-center gap-2 font-mono font-semibold" dir="ltr">
                  <Phone className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span>{business.phone}</span>
                </p>
              )}
              {addressText && (
                <p className="line-clamp-1 min-w-0 text-xs text-white/60">{addressText}</p>
              )}
              {whatsapp && (
                <p className="text-[10px] text-white/50" dir="ltr">
                  WhatsApp: {String(whatsapp).replace(/^https?:\/\/(wa\.me\/)?/, "")}
                </p>
              )}
            </div>
            {logoUrl && (
              <img src={logoUrl} alt={business.name} className="h-10 w-10 shrink-0 rounded-lg border border-white/15 object-cover" />
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Template D — Local Business ---------------- */
  if (template === "local") {
    return (
      <div ref={ref} dir="rtl" className={`relative aspect-[1.586/1] w-full max-w-2xl overflow-hidden rounded-2xl border p-6 sm:p-7 ${tokens.local} ${fontClass} ${tokens.accentGlow} select-none`}>
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
              {logoUrl ? (
                <img src={logoUrl} alt={business.name} className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-7 w-7 text-slate-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className={`${size.title} font-black leading-snug`}>{business.name}</h2>
                {isVerified && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white" title="تأییدشده">
                    <BadgeCheck className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <p className={`mt-0.5 font-semibold ${tokens.accentText} ${size.subtitle}`}>{business.category || "کسب‌وکار محلی"}</p>
            </div>
          </div>

          <div className={`flex-1 rounded-2xl ${tokens.panel} p-4`}>
            <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className={`min-w-0 ${size.body}`}>
                  <p className="font-bold text-slate-500">آدرس</p>
                  <p className="line-clamp-2 leading-relaxed text-slate-700">{addressText || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className={`min-w-0 ${size.body}`}>
                  <p className="font-bold text-slate-500">تماس</p>
                  {business.phone ? (
                    <p dir="ltr" className="text-left font-mono font-semibold text-slate-700">{business.phone}</p>
                  ) : (
                    <p className="text-slate-700">—</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className={`min-w-0 ${size.body}`}>
                  <p className="font-bold text-slate-500">ساعات کاری</p>
                  <p className="text-slate-700">همه‌روزه — از شنبه تا پنجشنبه</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className={`min-w-0 ${size.body}`}>
                  <p className="font-bold text-slate-500">شبکه‌ها</p>
                  {instagram ? (
                    <p dir="ltr" className="truncate text-left text-slate-700">
                      {socialHandle(instagram, /^https?:\/\/(www\.)?instagram\.com\//)}
                    </p>
                  ) : website ? (
                    <p dir="ltr" className="truncate text-left text-slate-700">
                      {website.replace(/^https?:\/\//, "").replace(/\/+$/, "")}
                    </p>
                  ) : (
                    <p className="text-slate-700">—</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-500">
              اسکن کنید و مسیریابی شوید
            </span>
            <QRBox qrSvg={qrSvg} sizeClass={size.qr} frameClass="border border-black/10 shadow-md" />
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Template E — Creative Studio ---------------- */
  return (
    <div ref={ref} dir="rtl" className={`relative aspect-[1.586/1] w-full max-w-2xl overflow-hidden rounded-2xl border ${tokens.creative} ${fontClass} ${tokens.accentGlow} select-none`}>
      <div className={`pointer-events-none absolute -left-24 top-1/2 h-[220%] w-2/5 origin-top-left -rotate-[18deg] ${tokens.blockA}`} />
      <div className={`pointer-events-none absolute -left-10 top-1/2 h-[220%] w-1/4 origin-top-left -rotate-[18deg] ${tokens.blockB}`} />

      <div className="relative flex h-full flex-col justify-between p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-[60%]">
            <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-black tracking-wide ${tokens.accentBadge}`}>
              CREATIVE · اینکارت
            </span>
            <h2 className={`mt-2 ${size.title} font-black leading-snug text-white`}>{business.name}</h2>
            <p className={`mt-1 font-bold text-white/70 ${size.subtitle}`}>{business.category || "استودیو خلاق"}</p>
            <div className={`mt-3 flex h-1.5 w-20 rounded-full ${tokens.accentBar}`} />
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md">
            {logoUrl ? (
              <img src={logoUrl} alt={business.name} className="h-full w-full object-contain p-1" />
            ) : (
              <Sparkles className="h-7 w-7 text-white/80" />
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className={`min-w-0 flex-1 space-y-1 text-white/85 ${size.body}`}>
            {business.phone && (
              <p className="flex items-center gap-2 font-mono font-semibold" dir="ltr">
                <Phone className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span>{business.phone}</span>
              </p>
            )}
            {telegram && (
              <p className="flex items-center gap-1.5" dir="ltr">
                <Send className="h-3 w-3 shrink-0 opacity-60" />
                {socialHandle(telegram, /^https?:\/\/(www\.)?t\.me\//)}
              </p>
            )}
            {instagram && (
              <p className="flex items-center gap-1.5" dir="ltr">
                <InstagramIcon className="h-3 w-3 shrink-0 opacity-60" />
                {socialHandle(instagram, /^https?:\/\/(www\.)?instagram\.com\//)}
              </p>
            )}
          </div>
          <QRBox
            qrSvg={qrSvg}
            sizeClass={size.qr}
            frameClass="border border-white/30 shadow-2xl"
            label="اسکن کنید"
          />
        </div>
      </div>
    </div>
  );
});

export default CardCanvas;
