"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { badgeLabel, getAdminBusinesses, getBusinessAudit, mediaUrl, moderateBusiness, safeHttpUrl, statusLabel, type AuditEvent, type Page, type Phase2Business } from "@/lib/phase2";
import s from "@/components/business/phase2.module.css";
export default function BusinessModerationPage() {
  const router=useRouter();const {user,loading:authLoading}=useAuth();
  const [status,setStatus]=useState("pending"),[query,setQuery]=useState(""),[search,setSearch]=useState("");
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [data,setData]=useState<Page<Phase2Business>|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Phase2Business|null>(null);
  const [note,setNote]=useState(""),[badges,setBadges]=useState<string[]>([]);
  const [decision,setDecision]=useState<"approved"|"rejected"|"suspended">("approved");
  const [message,setMessage]=useState<{text:string;error?:boolean}|null>(null);
  const [audit,setAudit]=useState<Page<AuditEvent>|null>(null),[auditPage,setAuditPage]=useState(1),[auditLoading,setAuditLoading]=useState(false);
  useEffect(()=>{if(!authLoading&&!user?.roles.includes("admin"))router.replace("/admin/login");},[user,authLoading,router]);
  useEffect(()=>{
    if(!user?.roles.includes("admin"))return;
    const controller=new AbortController();setLoading(true);
    getAdminBusinesses(status,search,page,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setMessage({text:extractApiError(e),error:true});}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[user,status,search,page,revision]);
  useEffect(()=>{
    if(!selected?.id)return;
    let active=true;setAuditLoading(true);
    getBusinessAudit(selected.id,auditPage).then(x=>{if(active)setAudit(x);}).catch(e=>{if(active)setMessage({text:extractApiError(e),error:true});}).finally(()=>{if(active)setAuditLoading(false);});
    return ()=>{active=false;};
  },[selected?.id,auditPage,revision]);
  function choose(b:Phase2Business){setSelected(b);setNote(b.moderation_note||"");setBadges(b.badges||[]);setDecision("approved");setAudit(null);setAuditPage(1);setMessage(null);}
  async function submit(e:FormEvent){
    e.preventDefault();if(!selected)return;
    if(decision!=="approved"&&!note.trim()){setMessage({text:"برای رد یا تعلیق، دلیل تصمیم را بنویسید.",error:true});return;}
    setBusy(true);setMessage(null);
    try{const b=await moderateBusiness(selected.id,decision,note,badges);setSelected({...selected,...b});setBadges(b.badges||[]);setMessage({text:"تصمیم ذخیره شد و رخداد آن ثبت شد."});setRevision(x=>x+1);}
    catch(e){setMessage({text:extractApiError(e),error:true});}finally{setBusy(false);}
  }
  if(authLoading||!user?.roles.includes("admin"))return <main className={s.page} dir="rtl">در حال بررسی دسترسی…</main>;
  return <main className={s.page} dir="rtl"><Link href="/admin">بازگشت به مرکز مدیریت</Link><h1>بررسی کسب‌وکارها</h1><p>پروفایل را بررسی کنید، نشان‌ها را تعیین کنید و تصمیم را همراه دلیل ثبت کنید.</p>
    {message&&<p role={message.error?"alert":"status"} className={`${s.notice} ${message.error?s.error:""}`}>{message.text}</p>}
    <form className={s.toolbar} onSubmit={e=>{e.preventDefault();setSearch(query.trim());setPage(1);setRevision(x=>x+1);}}>
      <label>وضعیت<select disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">همه وضعیت‌ها</option>{Object.entries(statusLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>جستجوی نام<input disabled={busy} value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label><button type="submit" disabled={busy}>جستجو</button>
    </form>
    {loading?<p aria-busy="true">در حال دریافت فهرست…</p>:<><ul className={s.list}>{data?.data.map(b=><li key={b.id}><div><strong>{b.name}</strong><p className={s.muted}>{[b.city,b.category,statusLabel[b.status]].filter(Boolean).join(" • ")}</p></div><button disabled={busy} onClick={()=>choose(b)}>بررسی پروفایل</button></li>)}</ul>{!data?.data.length&&<p>موردی با این فیلتر پیدا نشد.</p>}<div className={s.toolbar}><button disabled={busy||page<=1} onClick={()=>setPage(x=>x-1)}>صفحه قبل</button><span>{page} / {data?.last_page||1}</span><button disabled={busy||!data||page>=data.last_page} onClick={()=>setPage(x=>x+1)}>صفحه بعد</button></div></>}
    {selected&&<section className={s.section}><h2>{selected.name}</h2><span className={s.status}>{statusLabel[selected.status]}</span>
      <p style={{whiteSpace:"pre-wrap"}}>{selected.description}</p><p>{[selected.city,selected.neighborhood,selected.address].filter(Boolean).join("، ")}</p><p dir="ltr">{selected.phone} {selected.email}</p><p>خدمات: {(selected.services||[]).join("، ")}</p>
      {selected.latitude!=null&&selected.longitude!=null&&<p dir="ltr">{selected.latitude}, {selected.longitude}</p>}
      <div className={s.toolbar}>{Object.entries(selected.social_links||{}).map(([key,raw])=>{const url=safeHttpUrl(raw);return url?<a key={key} href={url} target="_blank" rel="noopener noreferrer">{key}</a>:<span key={key}>لینک نامعتبر: {key}</span>;})}</div>
      <div className={s.gallery}>{[{id:"logo",path:selected.logo,alt:"لوگو"},{id:"cover",path:selected.cover_image,alt:"کاور"},...(selected.images||[])].map(image=>{const url=mediaUrl(image.path);return url?<figure key={image.id}><a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={image.alt||"تصویر کسب‌وکار"}/></a></figure>:null;})}</div>
      <form onSubmit={submit}><fieldset disabled={busy}><div className={s.grid}><label>تصمیم<select value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}><option value="approved">تأیید و انتشار</option><option value="rejected">رد</option><option value="suspended">تعلیق و توقف نمایش عمومی</option></select></label><label>دلیل یا توضیح تصمیم<textarea maxLength={1000} required={decision!=="approved"} value={note} onChange={e=>setNote(e.target.value)}/></label></div>
        <p className={s.muted}>نشان احراز شده فقط برای کسب‌وکار تأییدشده باقی می‌ماند.</p><div className={s.toolbar}>{Object.entries(badgeLabel).map(([key,label])=><label key={key} className={s.check}><input type="checkbox" checked={badges.includes(key)} onChange={e=>setBadges(xs=>e.target.checked?[...xs,key]:xs.filter(x=>x!==key))}/>{label}</label>)}</div>
        <button type="submit">{busy?"در حال ثبت…":"ثبت تصمیم و نشان‌ها"}</button></fieldset></form>
      <section className={s.section}><h2>تاریخچه رخدادها</h2>{auditLoading?<p aria-busy="true">در حال دریافت تاریخچه…</p>:<><ul className={s.list}>{audit?.data.map(event=><li key={event.id}><div><strong>{event.event}</strong><p>{new Date(event.created_at.replace(" ","T")+(event.created_at.includes("Z")?"":"Z")).toLocaleString("fa-IR")} | شناسه عامل: {event.actor_id||"سیستم"}</p><pre dir="ltr">{typeof event.metadata==="string"?event.metadata:JSON.stringify(event.metadata,null,2)}</pre></div></li>)}</ul>{!audit?.data.length&&<p>رخدادهای قبل از نصب این نسخه ثبت نشده‌اند.</p>}<div className={s.toolbar}><button disabled={auditPage<=1} onClick={()=>setAuditPage(x=>x-1)}>رخدادهای قبلی</button><button disabled={!audit||auditPage>=audit.last_page} onClick={()=>setAuditPage(x=>x+1)}>رخدادهای بعدی</button></div></>}</section>
    </section>}
  </main>;
}
