import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import axios from "axios";
import api from "@/lib/api";
import { getPublicShowcases, getQrUrl, type Showcase } from "@/lib/businesses";
import { badgeLabel, mediaUrl, safeHttpUrl, type Phase2Business } from "@/lib/phase2";
import AppTaskbar from "@/components/layout/AppTaskbar";
import Image from "next/image";
import SiteFooter from "@/components/layout/SiteFooter";
import PublicCardView from "@/features/card-editor/react/PublicCardView";
import { fetchPublicCard, resolveCardRender } from "@/lib/publicCard";
import {
  ArrowUpRight,
  BadgeCheck,
  Globe,
  Images,
  Mail,
  MapPin,
  Phone,
  QrCode,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{slug:string}> };
/** "unpublished": the business exists but is awaiting (re-)review — not a missing page. */
type FetchedBusiness = Phase2Business | "unpublished" | null;
const fetchBusiness = cache(async(slug:string):Promise<FetchedBusiness> => {
  try { return (await api.get<Phase2Business>(`/public/businesses/${encodeURIComponent(slug)}`)).data; }
  catch(e) {
    if(axios.isAxiosError(e)&&e.response?.status===404){
      return (e.response.data as {reason?:string}|undefined)?.reason==="not_published"?"unpublished":null;
    }
    // A server outage is not a missing business. Let Next show the error boundary.
    throw e;
  }
});
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {slug}=await params;const b=await fetchBusiness(slug);
  if(b==="unpublished")return {title:"در انتظار تأیید",robots:{index:false,follow:false}};
  if(!b)return {title:"کسب‌وکار یافت نشد",robots:{index:false,follow:false}};
  return {title:`${b.name} | اینکارت`,description:(b.description||[b.category,b.city].filter(Boolean).join("، ")).slice(0,160),alternates:{canonical:safeHttpUrl(b.public_url)||undefined}};
}

/* ============================================================
   Public business profile — THE night shell.

   This page is the end-user surface a QR scan lands on, so it carries the
   SAME visual system as the design studio (`EditorStage` / `CardStudio`)
   instead of the previous light editorial sheet:

     studio shell        → here
     #060b12 backdrop    → `bg-[#060b12]` + the same radial cyan/emerald glows
     #0c1626 panels      → `bg-[#0c1626]/80` glass sections
     white/[0.07] border → identical hairline borders
     cyan-400 / emerald  → accents on icons, chips and the primary action

   Structure: identity band → the digital card as the HERO → supporting
   profile detail. The card is the reason the visitor scanned, so it is the
   largest, brightest element on the page, centred in its own stage panel the
   way it sits on the studio artboard.

   All data contracts, links, sanitising and the moderation gate are
   unchanged — this is a presentation-layer refactor only.
   ============================================================ */

/** Page column — was `.page` */
const shell = "relative mx-auto w-full max-w-[1180px] px-4 pb-24 pt-28 sm:px-6";
/** Glass section — was `.section` */
const panel = "relative overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#0c1626]/80 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8";
/** Section heading — was `.page h2` */
const h2 = "flex items-center gap-2 text-sm font-bold text-white";
/** Chip — was `.status` */
const chip = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300";
/** Muted meta text — was `.muted` */
const muted = "text-sm text-slate-400";
/** Link — was `.page a` */
const link = "text-cyan-300 underline decoration-cyan-400/40 underline-offset-4 transition hover:text-cyan-200";
/** 2-col info grid — was `.grid` */
const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2";
/** Contact tile */
const tile = "rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4";
/** Media frame for next/image fill — was `.frame` */
const frame = "relative block overflow-hidden rounded-xl border border-white/10 bg-black/30";
/** Ambient studio glow used by the shell and the hero stage */
const glow =
  "radial-gradient(circle at 50% 0%, rgba(34,211,238,0.10), transparent 55%), radial-gradient(circle at 85% 100%, rgba(16,185,129,0.08), transparent 45%)";

export default async function PublicBusinessPage({params}:Props) {
  const {slug}=await params;const b=await fetchBusiness(slug);if(!b)notFound();
  if(b==="unpublished")return <><AppTaskbar/><main dir="rtl" className="relative min-h-screen bg-[#060b12] text-slate-200">
    <div className={shell}>
      <section className={panel}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: glow }} />
        <div className="relative flex flex-col items-center gap-4 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10">
            <ShieldCheck className="h-7 w-7 text-amber-300" />
          </span>
          <h1 className="text-2xl font-extrabold text-white sm:text-3xl">این صفحه در انتظار تأیید است</h1>
          <p className={`${muted} max-w-[60ch] leading-7`}>صفحه‌ی این کسب‌وکار هنوز منتشر نشده یا پس از ویرایش برای بررسی مجدد به مدیر ارسال شده است. پس از تأیید، دوباره با همین لینک در دسترس خواهد بود.</p>
        </div>
      </section>
    </div>
  </main><SiteFooter/></>;
  // Published card. The design/legacy decision is made here once (pure), so the
  // client view only renders: design_json valid → layered projection, absent →
  // template renderer, malformed → template renderer + a visible notice.
  const card=await fetchPublicCard(slug);
  const cardPlan=resolveCardRender(card);
  const cardFellBack=cardPlan.mode==="legacy"&&Boolean(card?.design_json);
  let showcases:Showcase[]=[];
  try { showcases=await getPublicShowcases(slug); } catch { /* Optional paid module must not hide the profile. */ }
  const socials=Array.isArray(b.social_links)?b.social_links.map((url,i)=>[`لینک ${i+1}`,url]):Object.entries(b.social_links||{});
  const cover=mediaUrl(b.cover_image),logo=mediaUrl(b.logo);
  const map=b.latitude!=null&&b.longitude!=null&&Number.isFinite(Number(b.latitude))&&Number.isFinite(Number(b.longitude))?`https://www.openstreetmap.org/?mlat=${Number(b.latitude)}&mlon=${Number(b.longitude)}#map=16/${Number(b.latitude)}/${Number(b.longitude)}`:null;
  const phone=b.phone?.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[^0-9+]/g,"");
  const email=b.email&&/^[^\s<>@]+@[^\s<>@]+$/.test(b.email)?`mailto:${encodeURIComponent(b.email)}`:null;
  const badges=(b.badges||[]).filter(x=>badgeLabel[x]);
  const meta=[b.category,b.city,b.neighborhood].filter(Boolean) as string[];
  const hasContact=Boolean(b.phone||b.email||b.address||b.city||b.neighborhood||map);

  return <><AppTaskbar/>
  <main dir="rtl" className="relative min-h-screen bg-[#060b12] text-slate-200">
    {/* Fixed ambient studio glow behind every section (matches the stage bg). */}
    <div aria-hidden="true" className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(circle at 50% 12%, rgba(49,70,92,0.22), transparent 34%), radial-gradient(circle at 10% 90%, rgba(16,185,129,0.05), transparent 28%)" }} />
    <div className={shell}>

      {/* ── Identity band ─────────────────────────────────────────────── */}
      <header className="relative">
        <div className="relative h-40 w-full overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#0c1626] sm:h-52">
          {cover
            ? <Image src={cover} alt={`کاور ${b.name}`} fill sizes="100vw" priority className="object-cover opacity-90" />
            : null}
          {/* Keeps the identity text legible over any cover image. */}
          <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,11,18,0.35) 0%, rgba(6,11,18,0.85) 100%)" }} />
          <div aria-hidden="true" className="absolute inset-0" style={{ background: glow }} />
        </div>

        <div className="relative -mt-14 flex flex-col items-center gap-4 px-2 text-center sm:-mt-16 sm:flex-row sm:items-end sm:gap-6 sm:px-6 sm:text-right">
          <span className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#0a1220] shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
            {logo
              ? <Image src={logo} alt={`لوگوی ${b.name}`} width={96} height={96} className="size-24 object-contain" sizes="96px" />
              : <Store className="size-9 text-cyan-400/80" />}
          </span>

          <div className="min-w-0 flex-1">
            {meta.length>0&&<p className="text-xs font-semibold tracking-wide text-cyan-300/90">{meta.join(" · ")}</p>}
            <h1 className="mt-1.5 text-balance text-[clamp(1.75rem,4.4vw,2.75rem)] font-extrabold leading-[1.25] text-white">{b.name}</h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
                <BadgeCheck className="h-3.5 w-3.5" />
                انتشار با تأیید مدیر
              </span>
              {badges.map(x=><span key={x} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" />
                {badgeLabel[x]}
              </span>)}
            </div>
          </div>

          {phone&&<a href={`tel:${phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-500 px-5 text-sm font-bold text-slate-950 shadow-[0_10px_30px_rgba(16,185,129,0.28)] transition hover:bg-emerald-400">
            <Phone className="h-4 w-4" />
            تماس
          </a>}
        </div>
      </header>

      {/* ── Digital card — the hero ───────────────────────────────────── */}
      <section className={`${panel} mt-8`}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: glow }} />
        <div className="relative">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className={h2}>
              <Sparkles className="h-4 w-4 text-cyan-400" />
              کارت ویزیت دیجیتال
            </h2>
            {cardFellBack&&<span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-200">طرح سفارشی این کارت قابل نمایش نیست؛ قالب استاندارد نمایش داده می‌شود.</span>}
          </div>
          {/* Stage pad: the same inset/rounded treatment the studio gives the
              artboard, so the published card reads as a finished design. */}
          <div className="mx-auto w-full max-w-[880px] rounded-[22px] border border-white/10 bg-black/25 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-5">
            <PublicCardView business={b} plan={cardPlan}/>
          </div>
        </div>
      </section>

      {b.description&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Store className="h-4 w-4 text-cyan-400" />درباره کسب‌وکار</h2>
        <p className="mt-4 max-w-[75ch] whitespace-pre-wrap text-sm leading-7 text-slate-300">{b.description}</p>
      </section>}

      {!!b.services?.length&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Sparkles className="h-4 w-4 text-cyan-400" />خدمات</h2>
        <div className="mt-4 flex flex-wrap gap-2">{b.services.map((x,i)=><span key={i} className={chip}>{x}</span>)}</div>
      </section>}

      {hasContact&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Phone className="h-4 w-4 text-cyan-400" />تماس و نشانی</h2>
        <div className={`${grid} mt-4`}>
          {b.phone&&<div className={tile}>
            <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400"><Phone className="h-3.5 w-3.5 text-cyan-400" />شماره تماس</span>
            <p dir="ltr" className="mt-2 text-left text-sm">{phone?<a href={`tel:${phone}`} className={link}>{b.phone}</a>:b.phone}</p>
          </div>}
          {b.email&&<div className={tile}>
            <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400"><Mail className="h-3.5 w-3.5 text-cyan-400" />ایمیل</span>
            <p dir="ltr" className="mt-2 text-left text-sm">{email?<a href={email} className={link}>{b.email}</a>:b.email}</p>
          </div>}
          {(b.address||b.city||b.neighborhood)&&<div className={tile}>
            <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400"><MapPin className="h-3.5 w-3.5 text-cyan-400" />نشانی</span>
            <p className="mt-2 max-w-[60ch] text-sm leading-7 text-slate-300">{[b.city,b.neighborhood,b.address].filter(Boolean).join("، ")}</p>
          </div>}
          {map&&<a href={map} target="_blank" rel="noopener noreferrer" className={`${tile} flex min-h-11 items-center justify-between gap-3 transition hover:border-white/20 hover:bg-white/[0.06]`}>
            <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400"><MapPin className="h-3.5 w-3.5 text-cyan-400" />موقعیت روی نقشه</span>
            <ArrowUpRight className="h-4 w-4 text-cyan-300" />
          </a>}
        </div>
      </section>}

      {socials.some(([,url])=>safeHttpUrl(url))&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Globe className="h-4 w-4 text-cyan-400" />شبکه‌های اجتماعی</h2>
        <div className="mt-4 flex flex-wrap gap-2">{socials.map(([key,raw])=>{const url=safeHttpUrl(raw);return url?<a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow" className={`${chip} min-h-11 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-200`}>{key}<ArrowUpRight className="h-3.5 w-3.5" /></a>:null;})}</div>
      </section>}

      {!!b.images?.length&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Images className="h-4 w-4 text-cyan-400" />تصاویر کسب‌وکار</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{b.images.map(image=>{const src=mediaUrl(image.path);return src?<figure key={image.id} className={`${frame} m-0 aspect-[4/3]`}><Image src={src} alt={image.alt||b.name} fill sizes="(max-width:640px) 50vw, 280px" className="object-cover"/></figure>:null;})}</div>
      </section>}

      {!!showcases.length&&<section className={`${panel} mt-6`}>
        <h2 className={h2}><Store className="h-4 w-4 text-cyan-400" />ویترین</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{showcases.map(item=>{const src=mediaUrl(item.image_path);return src?<figure key={item.id} className="m-0">
          <span className={`${frame} aspect-[4/3]`}><Image src={src} alt={item.title} fill sizes="(max-width:640px) 50vw, 280px" className="object-cover"/></span>
          <figcaption className="mt-2 text-xs font-semibold text-slate-200">{item.title}{item.price!=null&&<p className="mt-0.5 font-mono text-[11px] text-cyan-300">{Number(item.price).toLocaleString("fa-IR")} تومان</p>}</figcaption>
        </figure>:null;})}</div>
      </section>}

      <section className={`${panel} mt-6`}>
        <h2 className={h2}><QrCode className="h-4 w-4 text-cyan-400" />QR اختصاصی</h2>
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          {/* QR endpoint serves SVG; next/image cannot optimize SVG without enabling dangerouslyAllowSVG globally. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getQrUrl(b.slug)} alt={`QR ${b.name}`} width={160} height={160} className="size-[160px] rounded-2xl border border-white/10 bg-white p-2"/>
          <div className="text-center sm:text-right">
            <p className={`${muted} max-w-[60ch] leading-7`}>این کد به لینک ثابت همین کسب‌وکار می‌رسد.</p>
            <a href={getQrUrl(b.slug)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm font-bold text-slate-200 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-200">
              بازکردن و ذخیره QR (SVG)
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

    </div>
  </main><SiteFooter/></>;
}
