import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import axios from "axios";
import api from "@/lib/api";
import { getPublicShowcases, getQrUrl, type Showcase } from "@/lib/businesses";
import { badgeLabel, mediaUrl, safeHttpUrl, type Phase2Business } from "@/lib/phase2";
import AppTaskbar from "@/components/layout/AppTaskbar";
import SiteFooter from "@/components/layout/SiteFooter";
import s from "@/components/business/phase2.module.css";
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
export default async function PublicBusinessPage({params}:Props) {
  const {slug}=await params;const b=await fetchBusiness(slug);if(!b)notFound();
  let showcases:Showcase[]=[];
  try { showcases=await getPublicShowcases(slug); } catch { /* Optional paid module must not hide the profile. */ }
  const socials=Array.isArray(b.social_links)?b.social_links.map((url,i)=>[`link${i+1}`,url]):Object.entries(b.social_links||{});
  const cover=mediaUrl(b.cover_image),logo=mediaUrl(b.logo);
  const map=b.latitude!=null&&b.longitude!=null&&Number.isFinite(Number(b.latitude))&&Number.isFinite(Number(b.longitude))?`https://www.openstreetmap.org/?mlat=${Number(b.latitude)}&mlon=${Number(b.longitude)}#map=16/${Number(b.latitude)}/${Number(b.longitude)}`:null;
  const phone=b.phone?.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[^0-9+]/g,"");
  const email=b.email&&/^[^\s<>@]+@[^\s<>@]+$/.test(b.email)?`mailto:${encodeURIComponent(b.email)}`:null;
  return <><AppTaskbar/><main className={s.page} dir="rtl">
    {cover&&<img className={s.hero} src={cover} alt={`کاور ${b.name}`}/>}
    <header>{logo&&<img className={s.logo} src={logo} alt={`لوگوی ${b.name}`}/>}<p className={s.muted}>{[b.category,b.city,b.neighborhood].filter(Boolean).join(" • ")}</p><h1>{b.name}</h1><span className={s.status}>انتشار با تأیید مدیر</span><div className={s.toolbar}>{(b.badges||[]).filter(x=>badgeLabel[x]).map(x=><span className={s.status} key={x}>{badgeLabel[x]}</span>)}</div></header>
    {b.description&&<p style={{whiteSpace:"pre-wrap"}}>{b.description}</p>}
    {!!b.services?.length&&<section className={s.section}><h2>خدمات</h2><ul>{b.services.map((x,i)=><li key={i}>{x}</li>)}</ul></section>}
    <section className={s.section}><h2>تماس و نشانی</h2><div className={s.grid}>
      {b.phone&&<div><strong>شماره تماس</strong><p dir="ltr">{phone?<a href={`tel:${phone}`}>{b.phone}</a>:b.phone}</p></div>}
      {b.email&&<div><strong>ایمیل</strong><p dir="ltr">{email?<a href={email}>{b.email}</a>:b.email}</p></div>}
      {(b.address||b.city||b.neighborhood)&&<div className={s.full}><strong>نشانی</strong><p>{[b.city,b.neighborhood,b.address].filter(Boolean).join("، ")}</p></div>}
      {map&&<a href={map} target="_blank" rel="noopener noreferrer">مشاهده موقعیت روی نقشه</a>}
    </div></section>
    {socials.some(([,url])=>safeHttpUrl(url))&&<section className={s.section}><h2>شبکه‌های اجتماعی</h2><div className={s.toolbar}>{socials.map(([key,raw])=>{const url=safeHttpUrl(raw);return url?<a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow">{key}</a>:null;})}</div></section>}
    {!!b.images?.length&&<section className={s.section}><h2>تصاویر کسب‌وکار</h2><div className={s.gallery}>{b.images.map(image=>{const src=mediaUrl(image.path);return src?<figure key={image.id}><a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={image.alt||b.name} loading="lazy"/></a></figure>:null;})}</div></section>}
    {!!showcases.length&&<section className={s.section}><h2>ویترین</h2><div className={s.gallery}>{showcases.map(item=>{const src=mediaUrl(item.image_path);return src?<figure key={item.id}><img src={src} alt={item.title} loading="lazy"/><figcaption>{item.title}{item.price!=null&&<p>{Number(item.price).toLocaleString("fa-IR")} تومان</p>}</figcaption></figure>:null;})}</div></section>}
    <section className={s.section}><h2>QR اختصاصی</h2><p>این کد به لینک ثابت همین کسب‌وکار می‌رسد.</p><div className={s.toolbar}><img src={getQrUrl(b.slug)} alt={`QR ${b.name}`} width={160} height={160}/><a href={getQrUrl(b.slug)} target="_blank" rel="noopener noreferrer">بازکردن و ذخیره QR (SVG)</a></div></section>
  </main><SiteFooter/></>;
}
