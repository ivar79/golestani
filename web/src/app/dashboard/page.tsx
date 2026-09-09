"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { getQrUrl } from "@/lib/businesses";
import { OnboardingView } from "@/components/dashboard/OnboardingView";
import MapViewLazy from "@/components/map/MapViewLazy";
import Image from "next/image";
import { addImage, badgeLabel, getImages, getOwnedBusiness, getOwnedBusinesses, mediaUrl, normalizeSocial, removeImage, safeHttpUrl, saveProfile, statusLabel, uploadProfileMedia, type BusinessImage, type BusinessInput, type Phase2Business } from "@/lib/phase2";
import s from "@/components/business/phase2.module.css";

type Form = { name:string; category:string; description:string; phone:string; email:string; address:string; city:string; neighborhood:string; latitude:string; longitude:string; services:string };
type Social = { key:string; url:string };
const EMPTY: Form = { name:"", category:"", description:"", phone:"", email:"", address:"", city:"", neighborhood:"", latitude:"", longitude:"", services:"" };
const CATEGORIES = ["مبلمان و دکوراسیون داخلی","کافه و رستوران","پوشاک و مد","زیبایی، پوست و سلامت","خدمات دیجیتال و وب","املاک و ساختمان","فروشگاه لوازم خانگی","خدمات خودرو و حمل‌ونقل","آموزش و تدریس","پزشکی و سلامت","سایر خدمات و مشاغل"];
const FIELDS = [ ["name","نام کسب‌وکار",120], ["category","دسته‌بندی",120], ["phone","شماره تماس",30], ["email","ایمیل",255], ["city","شهر",120], ["neighborhood","محله",120], ["address","آدرس",1000] ] as const;
export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [items,setItems] = useState<Phase2Business[]>([]);
  const [editing,setEditing] = useState<Phase2Business|null>(null);
  const [form,setForm] = useState<Form>(EMPTY);
  const [social,setSocial] = useState<Social[]>([]);
  const [images,setImages] = useState<BusinessImage[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [galleryLoading,setGalleryLoading] = useState(false);
  const [message,setMessage] = useState<{text:string; error?:boolean}|null>(null);
  const [onboarding,setOnboarding] = useState(false);
  const [logo,setLogo] = useState<File|null>(null);
  const [cover,setCover] = useState<File|null>(null);
  const [deleteImage,setDeleteImage] = useState<number|null>(null);
  const mediaForm = useRef<HTMLFieldSetElement>(null);

  function choose(b:Phase2Business|null) {
    setEditing(b); setLogo(null); setCover(null); setImages([]); setMessage(null); setDeleteImage(null);
    if (mediaForm.current) mediaForm.current.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(x => x.value = "");
    setForm(b ? { name:b.name, category:b.category||"", description:b.description||"", phone:b.phone||"", email:b.email||"", address:b.address||"", city:b.city||"", neighborhood:b.neighborhood||"", latitude:b.latitude == null ? "" : String(b.latitude), longitude:b.longitude == null ? "" : String(b.longitude), services:(b.services||[]).join("\n") } : EMPTY);
    const links = b?.social_links;
    setSocial(links ? (Array.isArray(links) ? links.map((url,i)=>({key:`link${i+1}`,url})) : Object.entries(links).map(([key,url])=>({key,url:url||""}))) : []);
  }
  function remember(b:Phase2Business) {
    setEditing(b); setItems(xs => xs.some(x=>x.id===b.id) ? xs.map(x=>x.id===b.id?b:x) : [b,...xs]);
  }
  useEffect(()=>{
    if (!authLoading && !user) router.replace("/login");
  },[user,authLoading,router]);
  useEffect(()=>{
    if (!user) return;
    let active=true;
    getOwnedBusinesses().then(data=>{ if(active){ setItems(data); choose(data[0]||null); setOnboarding(data.length===0); } })
      .catch(e=>{ if(active) setMessage({text:extractApiError(e),error:true}); })
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[user]);
  useEffect(()=>{
    if (!editing?.id) return;
    let active=true;
    void (async()=>{
      setGalleryLoading(true);
      try{const data=await getImages(editing.id);if(active)setImages(data);}
      catch(e){if(active)setMessage({text:extractApiError(e),error:true});}
      finally{if(active)setGalleryLoading(false);}
    })();
    return ()=>{active=false;};
  },[editing?.id]);
  const change = (key:keyof Form, value:string) => setForm(f=>({...f,[key]:value}));
  function payload():BusinessInput {
    const links:Record<string,string> = Object.create(null);
    for(const row of social) {
      if (!row.url.trim()) continue;
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(row.key) || ["__proto__","prototype","constructor"].includes(row.key) || Object.hasOwn(links,row.key)) throw new Error("نام شبکه‌ها باید انگلیسی و غیرتکراری باشد.");
      links[row.key] = normalizeSocial(row.key,row.url);
    }
    const latitude = form.latitude.trim()==="" ? null : Number(form.latitude);
    const longitude = form.longitude.trim()==="" ? null : Number(form.longitude);
    if ((latitude===null)!==(longitude===null) || (latitude!==null && (!Number.isFinite(latitude)||Math.abs(latitude)>90)) || (longitude!==null && (!Number.isFinite(longitude)||Math.abs(longitude)>180))) throw new Error("طول و عرض جغرافیایی معتبر را با هم وارد کنید.");
    const nullable=(value:string)=>value.trim()||null;
    return { name:form.name.trim(), category:nullable(form.category), description:nullable(form.description), phone:nullable(form.phone), email:nullable(form.email), city:nullable(form.city), neighborhood:nullable(form.neighborhood), address:nullable(form.address), latitude,longitude, services:Array.from(new Set(form.services.split(/\n|،/).map(x=>x.trim()).filter(Boolean))),social_links:links };
  }
  async function submit(e:FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(null); let profileSaved=false;
    try {
      let saved=await saveProfile(editing?.id||null,payload()); remember(saved); profileSaved=true;
      if (logo||cover) {
        const data=new FormData(); if(logo)data.append("logo",logo); if(cover)data.append("cover_image",cover);
        saved=await uploadProfileMedia(saved.id,data); remember(saved); setLogo(null);setCover(null);
        mediaForm.current?.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(x=>x.value="");
      }
      setMessage({text:saved.status==="suspended" ? "اطلاعات ذخیره شد؛ تعلیق فقط توسط مدیر برداشته می‌شود." : "اطلاعات ذخیره شد. تغییر محتوای پروفایل نیازمند بررسی مدیر است."});
    } catch(e) { setMessage({text:(profileSaved ? "پروفایل ذخیره شد ولی آپلود تصویر کامل نشد: " : "")+extractApiError(e),error:true}); }
    finally {setBusy(false);}
  }
  async function refreshSelected(id:number) { const b=await getOwnedBusiness(id); remember(b); setImages(await getImages(id)); }
  async function gallery(files:FileList|null) {
    if (!files?.length||!editing) return;
    const selected=Array.from(files);
    if(images.length+selected.length>5){setMessage({text:"گالری حداکثر پنج تصویر دارد.",error:true});return;}
    setBusy(true);setMessage(null);let added=0;
    try { for(const file of selected){await addImage(editing.id,file);added++;} setMessage({text:"تصاویر ثبت شدند و پروفایل برای بررسی مجدد آماده است."}); }
    catch(e){setMessage({text:`${added} تصویر ثبت شد؛ `+extractApiError(e),error:true});}
    finally {try{await refreshSelected(editing.id);}catch(e){setMessage({text:extractApiError(e),error:true});}setBusy(false);}
  }
  async function eraseImage(id:number) {
    if(!editing)return;setBusy(true);setMessage(null);
    try{await removeImage(editing.id,id);await refreshSelected(editing.id);setDeleteImage(null);setMessage({text:"تصویر حذف شد."});}
    catch(e){setMessage({text:extractApiError(e),error:true});}finally{setBusy(false);}
  }
  async function clearMedia(field:"logo"|"cover_image") {
    if(!editing)return;setBusy(true);setMessage(null);
    try{const data=new FormData();data.append(`remove_${field}`,"1");remember(await uploadProfileMedia(editing.id,data));setMessage({text:"تصویر حذف شد."});}
    catch(e){setMessage({text:extractApiError(e),error:true});}finally{setBusy(false);}
  }
  const publicUrl=safeHttpUrl(editing?.public_url);
  const validPoint=form.latitude!==""&&form.longitude!==""&&Number.isFinite(Number(form.latitude))&&Number.isFinite(Number(form.longitude))&&Math.abs(Number(form.latitude))<=90&&Math.abs(Number(form.longitude))<=180;
  if(authLoading||loading||!user)return <main className={s.page} dir="rtl" aria-busy="true">در حال بارگذاری پنل…</main>;
  if(onboarding)return <OnboardingView onSkip={()=>setOnboarding(false)} onSelect={path=>{setOnboarding(false);if(path===2)router.push("/card-maker");if(path===3)router.push("/designer");}}/>;
  return <main className={s.page} dir="rtl">
    <p className={s.muted}>پنل صاحب کسب‌وکار</p><h1>پروفایل کسب‌وکار شما</h1>
    <p>اطلاعات واقعی، راه‌های ارتباطی و تصاویر را ثبت کنید. انتشار عمومی پس از تأیید مدیر انجام می‌شود.</p>
    <nav className={s.toolbar}><Link href="/">صفحه اصلی</Link><Link href="/card-maker">کارت‌ساز</Link><button disabled={busy} onClick={()=>void logout()}>خروج</button></nav>
    <div className={s.toolbar}><label>کسب‌وکار انتخاب‌شده<select disabled={busy} value={editing?.id||""} onChange={e=>choose(items.find(x=>x.id===Number(e.target.value))||null)}><option value="">ثبت کسب‌وکار جدید</option>{items.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button disabled={busy} onClick={()=>choose(null)}>کسب‌وکار جدید</button></div>
    {editing&&<div className={s.notice}><strong>{statusLabel[editing.status]}</strong>{editing.moderation_note&&<p>توضیح مدیر: {editing.moderation_note}</p>}<p>{(editing.badges||[]).map(x=>badgeLabel[x]||x).join(" • ")||"هنوز نشانی ثبت نشده است."}</p></div>}
    {message&&<p role={message.error?"alert":"status"} className={`${s.notice} ${message.error?s.error:""}`}>{message.text}</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy} className={s.section}><legend>اطلاعات اصلی و تماس</legend><div className={s.grid}>
        {FIELDS.map(([key,label,max])=><label key={key} className={key==="address"?s.full:undefined}>{label}{key==="name"?" *":""}<input required={key==="name"} maxLength={max} type={key==="email"?"email":key==="phone"?"tel":"text"} dir={key==="email"||key==="phone"?"ltr":undefined} list={key==="category"?"business-categories":undefined} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}
        <datalist id="business-categories">{CATEGORIES.map(x=><option key={x} value={x}/>)}</datalist>
        <label className={s.full}>توضیحات<textarea rows={5} maxLength={5000} value={form.description} onChange={e=>change("description",e.target.value)}/></label>
        <label className={s.full}>خدمات، هر خدمت در یک خط<textarea rows={4} value={form.services} onChange={e=>change("services",e.target.value)}/><span className={s.muted}>حداکثر ۳۰ خدمت، هر کدام ۱۲۰ کاراکتر.</span></label>
      </div></fieldset>
      <fieldset disabled={busy} className={s.section}><legend>موقعیت جغرافیایی</legend><p className={s.muted}>روی نقشه انتخاب کنید یا مختصات را وارد کنید؛ آدرس و شهر مستقل ذخیره می‌شوند.</p>
        <div className={s.grid}><label>عرض جغرافیایی<input type="number" min={-90} max={90} step="any" dir="ltr" value={form.latitude} onChange={e=>change("latitude",e.target.value)}/></label><label>طول جغرافیایی<input type="number" min={-180} max={180} step="any" dir="ltr" value={form.longitude} onChange={e=>change("longitude",e.target.value)}/></label></div>
        <div className={s.toolbar}><button type="button" onClick={()=>setForm(f=>({...f,latitude:"",longitude:""}))}>پاک‌کردن موقعیت</button></div>
        <MapViewLazy className="h-[320px] w-full" markers={validPoint?[{id:"picked",title:form.name||"موقعیت انتخاب‌شده",latitude:Number(form.latitude),longitude:Number(form.longitude)}]:[]} onPick={busy?undefined:(lat,lng)=>setForm(f=>({...f,latitude:lat.toFixed(7),longitude:lng.toFixed(7)}))}/>
      </fieldset>
      <fieldset disabled={busy} className={s.section}><legend>شبکه‌های اجتماعی</legend><p className={s.muted}>نام شبکه مثل instagram، telegram، whatsapp یا website؛ برای واتساپ شماره هم پذیرفته می‌شود.</p>
        {social.map((row,i)=><div className={s.social} key={i}><label>نام شبکه<input dir="ltr" maxLength={40} value={row.key} onChange={e=>setSocial(xs=>xs.map((x,j)=>j===i?{...x,key:e.target.value}:x))}/></label><label>لینک یا شماره<input dir="ltr" maxLength={500} value={row.url} onChange={e=>setSocial(xs=>xs.map((x,j)=>j===i?{...x,url:e.target.value}:x))}/></label><button type="button" onClick={()=>setSocial(xs=>xs.filter((_,j)=>j!==i))}>حذف شبکه</button></div>)}
        <button type="button" disabled={social.length>=10} onClick={()=>setSocial(xs=>[...xs,{key:"",url:""}])}>افزودن شبکه</button>
      </fieldset>
      <fieldset disabled={busy} className={s.section} ref={mediaForm}><legend>لوگو و تصویر کاور</legend><div className={s.grid}>
        <label>لوگو، حداکثر ۲ مگابایت{mediaUrl(editing?.logo)&&<span className={s.logoFrame}><Image src={mediaUrl(editing?.logo)!} alt="لوگوی فعلی" fill sizes="96px"/></span>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setLogo(e.target.files?.[0]||null)}/>{logo&&<span>{logo.name} (پس از ذخیره آپلود می‌شود)</span>}</label>
        <label>کاور، حداکثر ۵ مگابایت{mediaUrl(editing?.cover_image)&&<span className={s.logoFrame}><Image src={mediaUrl(editing?.cover_image)!} alt="کاور فعلی" fill sizes="96px"/></span>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setCover(e.target.files?.[0]||null)}/>{cover&&<span>{cover.name} (پس از ذخیره آپلود می‌شود)</span>}</label>
      </div><div className={s.toolbar}>{editing?.logo&&<button type="button" onClick={()=>void clearMedia("logo")}>حذف لوگوی فعلی</button>}{editing?.cover_image&&<button type="button" onClick={()=>void clearMedia("cover_image")}>حذف کاور فعلی</button>}</div></fieldset>
      <div className={s.toolbar}><button type="submit" disabled={busy}>{busy?"در حال ذخیره…":"ذخیره پروفایل"}</button><span className={s.muted}>خالی‌کردن فیلد و ذخیره، مقدار قبلی آن را پاک می‌کند.</span></div>
    </form>
    <section className={s.section}><h2>گالری کسب‌وکار</h2><p className={s.muted}>پنج تصویر رایگان، بدون نیاز به اشتراک. آپلود گالری مستقل از دکمه ذخیره پروفایل است.</p>
      {!editing?<p>ابتدا پروفایل را ذخیره کنید.</p>:<><label>افزودن تصاویر<input disabled={busy||galleryLoading||images.length>=5} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{void gallery(e.target.files);e.target.value="";}}/></label>{galleryLoading?<p aria-busy="true">در حال دریافت تصاویر…</p>:<div className={s.gallery}>{images.map(image=><figure key={image.id}>{mediaUrl(image.path)&&<span className={s.frame}><Image src={mediaUrl(image.path)!} alt={image.alt||"تصویر کسب‌وکار"} fill sizes="180px"/></span>}<figcaption>{deleteImage===image.id?<><span>حذف این تصویر؟ </span><button disabled={busy} onClick={()=>void eraseImage(image.id)}>بله، حذف</button><button disabled={busy} onClick={()=>setDeleteImage(null)}>انصراف</button></>:<button disabled={busy} onClick={()=>setDeleteImage(image.id)}>حذف تصویر</button>}</figcaption></figure>)}</div>}</>}
    </section>
    {editing&&<section className={s.section}><h2>لینک مستقل و QR</h2>{publicUrl&&<p dir="ltr">{publicUrl}</p>}{editing.status==="approved"&&publicUrl?<div className={s.toolbar}><a href={publicUrl} target="_blank" rel="noopener noreferrer">مشاهده صفحه عمومی</a>{/* QR endpoint serves SVG; next/image cannot optimize SVG without enabling dangerouslyAllowSVG globally. */}
{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={getQrUrl(editing.slug)} alt="QR اختصاصی کسب‌وکار" width={140} height={140}/><a href={getQrUrl(editing.slug)} target="_blank" rel="noopener noreferrer">بازکردن QR اختصاصی</a></div>:<p>لینک ثابت است؛ صفحه عمومی و QR پس از تأیید مدیر در دسترس قرار می‌گیرند.</p>}</section>}
  </main>;
}
