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
export const dynamic = "force-dynamic";
type Props = { params: Promise<{slug:string}> };
const fetchBusiness = cache(async(slug:string):Promise<Phase2Business|null> => {
  try { return (await api.get<Phase2Business>(`/public/businesses/${encodeURIComponent(slug)}`)).data; }
  catch(e) {
    if(axios.isAxiosError(e)&&e.response?.status===404)return null;
    // A server outage is not a missing business. Let Next show the error boundary.
    throw e;
  }
});
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {slug}=await params;const b=await fetchBusiness(slug);
  if(!b)return {title:"کسب‌وکار یافت نشد",robots:{index:false,follow:false}};
  return {title:`${b.name} | اینکارت`,description:(b.description||[b.category,b.city].filter(Boolean).join("، ")).slice(0,160),alternates:{canonical:safeHttpUrl(b.public_url)||undefined}};
}

/* ============================================================
   Tailwind-only restyle (پشته فنی مصوب — فایل CSS module قبلی حذف شد).

   Public business profile: light editorial sheet on the night shell.
   The oklch palette of the old CSS module maps to the nearest Tailwind
   emerald/slate scale:
     --ink    oklch(25%)  ≈ text-slate-800      (title/body)
     --muted  oklch(46%)  ≈ text-slate-500
     --line   oklch(87%)  ≈ border-slate-200
     --surface oklch(98%) ≈ bg-white
     --accent oklch(40%,.09,163) ≈ emerald-800 (links/primary buttons)
   All touch targets stay ≥44px (min-h-11 / size-11) as before.
   ============================================================ */

/** Page column — was `.page` */
const page = "mx-auto mt-24 min-h-[80vh] max-w-[1200px] rounded-2xl bg-white px-6 py-10 pb-20 text-base leading-[1.7] text-slate-800 sm:px-10 md:mt-[100px] md:rounded-3xl";
/** Section spacing — was `.section` */
const section = "mt-9 min-w-0 border-t border-slate-200 pt-7";
/** Heading — was `.page h2` */
const h2 = "mb-4 text-xl font-bold";
/** Flexible toolbar row — was `.toolbar` */
const toolbar = "my-6 flex flex-wrap items-center gap-3 [&>*]:max-w-full";
/** 2-col info grid — was `.grid` */
const grid = "grid grid-cols-1 gap-x-6 gap-y-5 min-[640px]:grid-cols-2";
/** Full-width cell — was `.full` */
const full = "col-span-full";
/** Pill badge — was `.status` */
const status = "inline-block rounded-full border border-slate-200 px-3 py-1 text-sm";
/** Muted meta text — was `.muted` */
const muted = "text-slate-500";
/** Link — was `.page a` */
const link = "text-emerald-800 underline decoration-2 underline-offset-4 [overflow-wrap:anywhere] transition hover:text-emerald-700";
/** Gallery — was `.gallery` */
const gallery = "my-5 flex flex-wrap gap-4";
/** Image frame for next/image fill — was `.frame` (180×140) */
const frame = "relative block h-[140px] w-[180px] overflow-hidden rounded-lg border border-slate-200";
/** Plain <img> in gallery (QR + hero/logo fallbacks) — was `.gallery img`/`.logo`/`.hero` */
const imgBox = "rounded-lg border border-slate-200";

export default async function PublicBusinessPage({params}:Props) {
  const {slug}=await params;const b=await fetchBusiness(slug);if(!b)notFound();
  // Published card. The design/legacy decision is made here once (pure), so the
  // client view only renders: design_json valid → layered projection, absent →
  // template renderer, malformed → template renderer + a visible notice.
  const card=await fetchPublicCard(slug);
  const cardPlan=resolveCardRender(card);
  const cardFellBack=cardPlan.mode==="legacy"&&Boolean(card?.design_json);
  let showcases:Showcase[]=[];
  try { showcases=await getPublicShowcases(slug); } catch { /* Optional paid module must not hide the profile. */ }
  const socials=Array.isArray(b.social_links)?b.social_links.map((url,i)=>[`link${i+1}`,url]):Object.entries(b.social_links||{});
  const cover=mediaUrl(b.cover_image),logo=mediaUrl(b.logo);
  const map=b.latitude!=null&&b.longitude!=null&&Number.isFinite(Number(b.latitude))&&Number.isFinite(Number(b.longitude))?`https://www.openstreetmap.org/?mlat=${Number(b.latitude)}&mlon=${Number(b.longitude)}#map=16/${Number(b.latitude)}/${Number(b.longitude)}`:null;
  const phone=b.phone?.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[^0-9+]/g,"");
  const email=b.email&&/^[^\s<>@]+@[^\s<>@]+$/.test(b.email)?`mailto:${encodeURIComponent(b.email)}`:null;
  return <><AppTaskbar/><main className={page} dir="rtl">
    {cover&&<div className={`${frame} h-auto max-h-[320px] w-full`}><Image src={cover} alt={`کاور ${b.name}`} width={1200} height={320} className="h-auto max-h-[320px] w-full object-cover" sizes="100vw"/></div>}
    <header className="border-t-0 pt-0">
      {logo&&<div className={`${frame} size-24`}><Image src={logo} alt={`لوگوی ${b.name}`} width={96} height={96} className="size-24 object-contain" sizes="96px"/></div>}
      <p className={muted}>{[b.category,b.city,b.neighborhood].filter(Boolean).join(" • ")}</p>
      <h1 className="mt-3 text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold leading-[1.3]">{b.name}</h1>
      <span className={`${status} mt-3`}>انتشار با تأیید مدیر</span>
      <div className={toolbar}>{(b.badges||[]).filter(x=>badgeLabel[x]).map(x=><span className={status} key={x}>{badgeLabel[x]}</span>)}</div>
    </header>
    <section className={section}>
      <h2 className={h2}>کارت ویزیت دیجیتال</h2>
      {cardFellBack&&<p className="max-w-[70ch]">طرح سفارشی این کارت در حال حاضر قابل نمایش نیست؛ قالب استاندارد نمایش داده می‌شود.</p>}
      <div className="mx-auto w-full max-w-[560px]">
        <PublicCardView business={b} plan={cardPlan}/>
      </div>
    </section>
    {b.description&&<p className="max-w-[70ch] whitespace-pre-wrap">{b.description}</p>}
    {!!b.services?.length&&<section className={section}><h2 className={h2}>خدمات</h2><ul>{b.services.map((x,i)=><li key={i}>{x}</li>)}</ul></section>}
    <section className={section}><h2 className={h2}>تماس و نشانی</h2><div className={grid}>
      {b.phone&&<div><strong>شماره تماس</strong><p dir="ltr" className="max-w-[70ch]">{phone?<a href={`tel:${phone}`} className={link}>{b.phone}</a>:b.phone}</p></div>}
      {b.email&&<div><strong>ایمیل</strong><p dir="ltr" className="max-w-[70ch]">{email?<a href={email} className={link}>{b.email}</a>:b.email}</p></div>}
      {(b.address||b.city||b.neighborhood)&&<div className={full}><strong>نشانی</strong><p className="max-w-[70ch]">{[b.city,b.neighborhood,b.address].filter(Boolean).join("، ")}</p></div>}
      {map&&<a href={map} target="_blank" rel="noopener noreferrer" className={link}>مشاهده موقعیت روی نقشه</a>}
    </div></section>
    {socials.some(([,url])=>safeHttpUrl(url))&&<section className={section}><h2 className={h2}>شبکه‌های اجتماعی</h2><div className={toolbar}>{socials.map(([key,raw])=>{const url=safeHttpUrl(raw);return url?<a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow" className={link}>{key}</a>:null;})}</div></section>}
    {!!b.images?.length&&<section className={section}><h2 className={h2}>تصاویر کسب‌وکار</h2><div className={gallery}>{b.images.map(image=>{const src=mediaUrl(image.path);return src?<figure key={image.id} className="m-0 w-[180px]"><a href={src} target="_blank" rel="noopener noreferrer"><span className={frame}><Image src={src} alt={image.alt||b.name} fill sizes="180px" className="object-cover"/></span></a></figure>:null;})}</div></section>}
    {!!showcases.length&&<section className={section}><h2 className={h2}>ویترین</h2><div className={gallery}>{showcases.map(item=>{const src=mediaUrl(item.image_path);return src?<figure key={item.id} className="m-0 w-[180px]"><span className={frame}><Image src={src} alt={item.title} fill sizes="180px" className="object-cover"/></span><figcaption className="mt-2">{item.title}{item.price!=null&&<p className="max-w-[70ch]">{Number(item.price).toLocaleString("fa-IR")} تومان</p>}</figcaption></figure>:null;})}</div></section>}
    <section className={section}><h2 className={h2}>QR اختصاصی</h2><p className="max-w-[70ch]">این کد به لینک ثابت همین کسب‌وکار می‌رسد.</p><div className={toolbar}>{/* QR endpoint serves SVG; next/image cannot optimize SVG without enabling dangerouslyAllowSVG globally. */}
{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={getQrUrl(b.slug)} alt={`QR ${b.name}`} width={160} height={160} className={imgBox}/><a href={getQrUrl(b.slug)} target="_blank" rel="noopener noreferrer" className={link}>بازکردن و ذخیره QR (SVG)</a></div></section>
  </main><SiteFooter/></>;
}
