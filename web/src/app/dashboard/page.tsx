
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import {
  createBusiness,
  deleteBusiness,
  listBusinesses,
  updateBusiness,
  type Business,
  type BusinessStatus,
} from "@/lib/businesses";

type Feedback = { kind: "success" | "error"; text: string } | null;

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "",
  phone: "",
  address: "",
  city: "",
  services: "",
  instagram: "",
  telegram: "",
};

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  const set = (key: keyof typeof EMPTY_FORM) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [key]: event.target.value }));

  function startEdit(b: Business) {
    setEditing(b);
    let ig = "", tg = "";
    if (b.social_links && !Array.isArray(b.social_links)) {
      ig = b.social_links.instagram || "";
      tg = b.social_links.telegram || "";
    }
    setForm({
      name: b.name || "",
      description: b.description || "",
      category: b.category || "",
      phone: b.phone || "",
      address: b.address || "",
      city: b.city || "",
      services: b.services?.join(", ") || "",
      instagram: ig,
      telegram: tg,
    });
    setFeedback(null);
  }

  useEffect(() => {
    if (!user) return;
    listBusinesses()
      .then((res) => {
        setItems(res);
        if (res.length > 0) {
           startEdit(res[0]); // Auto-load first business
        }
      })
      .catch((err) => setFeedback({ kind: "error", text: extractApiError(err) }))
      .finally(() => setLoading(false));
  }, [user]);

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    const payload = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      services: form.services
        ? form.services.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      social_links: {
        ...(form.instagram ? { instagram: form.instagram } : {}),
        ...(form.telegram ? { telegram: form.telegram } : {}),
      }
    };
    try {
      const saved = editing
        ? await updateBusiness(editing.id, payload)
        : await createBusiness(payload);
      
      setFeedback({
        kind: "success",
        text: editing ? "پروفایل با موفقیت به‌روزرسانی شد." : "پروفایل ایجاد شد.",
      });
      setItems((prev) => {
        if (editing) return prev.map((p) => (p.id === saved.id ? saved : p));
        return [...prev, saved];
      });
      if (!editing) {
        setEditing(saved);
      }
    } catch (err) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    } finally {
      setSaving(false);
    }
  }
  
  const handleLogout = () => {
    logout().then(() => router.push("/login"));
  };

  if (authLoading || !user) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-24 text-center text-zinc-500">
        در حال بارگذاری…
      </main>
    );
  }
  
  const StatusStyle: Record<BusinessStatus, { label: string; cls: string }> = {
    draft: { label: "پیش‌نویس", cls: "bg-d-surface-container text-d-on-surface-variant border-d-outline-variant" },
    pending: { label: "در انتظار بررسی", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
    approved: { label: "تأییدشده", cls: "bg-d-secondary-container text-d-on-secondary-container border-d-secondary/20" },
    rejected: { label: "ردشده", cls: "bg-d-error-container text-d-on-error-container border-d-error/20" },
    suspended: { label: "معلق", cls: "bg-d-error-container text-d-on-error-container border-d-error/20" },
  };

  return (
    <div className="bg-d-background font-body-md text-d-on-surface flex min-h-screen">
      <aside className="fixed right-0 top-0 h-full w-72 bg-d-surface-container-low backdrop-blur-xl border-l border-d-border-white-low z-50 flex flex-col py-8">
        <div className="px-8 mb-12 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-d-secondary-container flex items-center justify-center shadow-lg shadow-d-glow-emerald/20">
            <span className="material-symbols-outlined text-d-secondary">bolt</span>
          </div>
          <span className="font-headline-lg-mobile text-headline-lg-mobile text-d-on-surface tracking-tight">اینکارت</span>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <a className="flex items-center px-4 py-3.5 rounded-xl transition-all duration-300 group bg-d-secondary-container/20 text-d-secondary font-bold border-r-4 border-d-secondary" href="#">
            <span className="material-symbols-outlined ml-3 text-d-secondary group-hover:text-d-secondary">dashboard</span>
            داشبورد
          </a>
        </nav>
        <div className="px-8 mt-auto pt-8 border-t border-d-border-white-low">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-d-surface-container-highest/50 cursor-pointer" onClick={handleLogout}>
            <div className="w-8 h-8 rounded-full bg-d-error-container flex items-center justify-center">
              <span className="material-symbols-outlined text-d-on-error-container text-[18px]">logout</span>
            </div>
            <div className="flex flex-col">
              <span className="text-label-sm font-label-sm text-d-on-surface">خروج از حساب</span>
              <span className="text-caption-xs font-caption-xs text-d-on-surface-variant" dir="ltr">{user.phone}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="pr-72 w-full">
        <header className="fixed top-0 right-72 left-0 h-16 bg-d-surface/60 backdrop-blur-xl border-b border-d-border-white-low z-40 flex items-center justify-between px-margin-desktop">
          <div className="flex items-center gap-4">
             <div className="text-d-on-surface-variant text-sm font-medium">
               {editing ? (
                 <span className="flex items-center gap-2">
                    وضعیت:
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${StatusStyle[editing.status]?.cls || ''}`}>
                       {StatusStyle[editing.status]?.label || "نامشخص"}
                    </span>
                 </span>
               ) : null}
             </div>
          </div>
          <div className="flex items-center gap-4 text-d-on-surface-variant">
             <span className="material-symbols-outlined cursor-pointer hover:text-d-on-surface">search</span>
             <div className="w-8 h-8 rounded-full bg-d-primary flex items-center justify-center cursor-pointer hover:ring-2 ring-d-secondary transition-all">
               <span className="material-symbols-outlined text-d-on-primary text-[18px]">person</span>
             </div>
          </div>
        </header>

        <main className="relative pt-16 min-h-screen bg-d-surface">
          <form onSubmit={handleSubmit} className="flex flex-col w-full relative pb-margin-desktop">
            {/* Ambient background glow for depth */}
            <div className="fixed top-20 right-1/4 w-96 h-96 bg-d-primary/10 rounded-full blur-[100px] pointer-events-none -z-10"></div>
            <div className="fixed bottom-0 left-1/3 w-[500px] h-[500px] bg-d-secondary-container/10 rounded-full blur-[120px] pointer-events-none -z-10"></div>
            
            <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-gutter mt-8">
              {/* Page Header */}
              <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-2 h-2 rounded-full bg-d-secondary animate-pulse"></div>
                    <span className="text-label-sm text-d-secondary tracking-widest font-bold">پروفایل دیجیتال</span>
                  </div>
                  <h1 className="text-headline-lg font-headline-lg text-d-on-surface">
                     {editing ? "ویرایش پروفایل کسب‌وکار" : "ثبت کسب‌وکار جدید"}
                  </h1>
                  <p className="text-body-md text-d-on-surface-variant mt-2 max-w-2xl">
                     اطلاعات، آدرس و راه‌های ارتباطی مجموعه خود را بروزرسانی کنید.
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {feedback && (
                    <div className={`px-4 py-2 text-sm rounded-xl ${feedback.kind === 'error' ? 'bg-d-error-container text-d-on-error-container' : 'bg-d-secondary-container text-d-on-secondary-container'}`}>
                       {feedback.text}
                    </div>
                  )}
                  {editing && (
                    <a href={`/b/${editing.slug}`} target="_blank" rel="noreferrer" className="px-6 py-3 rounded-xl bg-d-surface-container-high hover:bg-d-surface-container-highest text-d-on-surface text-label-sm transition-all flex items-center gap-2 group">
                      <span className="material-symbols-outlined text-[20px] group-hover:rotate-12 transition-transform">visibility</span>
                      نمایش پروفایل
                    </a>
                  )}
                  <button type="submit" disabled={saving} className="px-6 py-3 rounded-xl bg-d-secondary-container hover:bg-d-secondary-container/90 text-d-on-secondary-fixed text-label-sm font-bold shadow-lg shadow-d-glow-emerald/30 transition-all flex items-center gap-2 group relative overflow-hidden">
                    <span className="material-symbols-outlined text-[20px]">save</span>
                    {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
                  </button>
                </div>
              </div>

              {/* Main Content Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter relative z-10">
                <div className="lg:col-span-8 flex flex-col gap-8">
                  
                  {/* Section 1: Basic Info */}
                  <section className="bg-d-surface-container-low backdrop-blur-xl rounded-[24px] p-6 md:p-8 shadow-sm">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="w-12 h-12 rounded-2xl bg-d-primary/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-d-primary text-[24px]">storefront</span>
                      </div>
                      <div>
                        <h2 className="text-title-md font-title-md text-d-on-surface">اطلاعات پایه</h2>
                        <p className="text-caption-xs text-d-on-surface-variant mt-1">مشخصات اصلی برند که به کاربران نمایش داده می‌شود.</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2 md:col-span-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">نام کسب‌وکار</label>
                        <input required value={form.name} onChange={set("name")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="نام برند شما" type="text" />
                      </div>
                      
                      <div className="flex flex-col gap-2 md:col-span-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">توضیحات</label>
                        <textarea value={form.description} onChange={set("description")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md resize-none" placeholder="کسب‌وکار خود را توصیف کنید..." rows={4}></textarea>
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">دسته‌بندی / زمینه فعالیت</label>
                        <input value={form.category} onChange={set("category")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="مثال: رستوران، کافه، خدماتی..." type="text" />
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">خدمات (با کاما جدا کنید)</label>
                        <input value={form.services} onChange={set("services")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="کترینگ، فضای باز، وای‌فای..." type="text" />
                      </div>
                    </div>
                  </section>

                  {/* Section 2: Contact & Address */}
                  <section className="bg-d-surface-container-low backdrop-blur-xl rounded-[24px] p-6 md:p-8 shadow-sm">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="w-12 h-12 rounded-2xl bg-d-primary/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-d-primary text-[24px]">location_on</span>
                      </div>
                      <div>
                        <h2 className="text-title-md font-title-md text-d-on-surface">ارتباط و موقعیت</h2>
                        <p className="text-caption-xs text-d-on-surface-variant mt-1">آدرس دقیق و شماره‌های تماس را وارد کنید.</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">شهر</label>
                        <input value={form.city} onChange={set("city")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="مثال: تهران" type="text" />
                      </div>
                      
                      <div className="flex flex-col gap-2 md:col-span-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">آدرس کامل</label>
                        <input value={form.address} onChange={set("address")} className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface rounded-xl px-4 py-3.5 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="نام خیابان، کوچه، پلاک، واحد" type="text" />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">تلفن ثابت یا موبایل</label>
                        <input value={form.phone} onChange={set("phone")} dir="ltr" className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface text-right rounded-xl px-4 py-3 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="021-XXXXXXX" type="tel" />
                      </div>
                    </div>
                  </section>
                  
                  {/* Section 3: Social Media */}
                  <section className="bg-d-surface-container-low backdrop-blur-xl rounded-[24px] p-6 md:p-8 shadow-sm">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="w-12 h-12 rounded-2xl bg-d-primary/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-d-primary text-[24px]">share</span>
                      </div>
                      <div>
                        <h2 className="text-title-md font-title-md text-d-on-surface">شبکه‌های اجتماعی</h2>
                        <p className="text-caption-xs text-d-on-surface-variant mt-1">لینک‌های ارتباطی خود را قرار دهید.</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">لینک اینستاگرام</label>
                        <input value={form.instagram} onChange={set("instagram")} dir="ltr" className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface text-right rounded-xl px-4 py-3 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="https://instagram.com/yourid" type="url" />
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <label className="text-label-sm text-d-on-surface-variant ml-1">آیدی یا لینک تلگرام</label>
                        <input value={form.telegram} onChange={set("telegram")} dir="ltr" className="w-full bg-d-surface-container hover:bg-d-surface-container-high focus:bg-d-surface-container-highest text-d-on-surface text-right rounded-xl px-4 py-3 outline-none transition-all placeholder-d-on-surface-variant/50 font-body-md" placeholder="@yourid" type="text" />
                      </div>
                    </div>
                  </section>

                </div>

                {/* Right Column: Sidebar features if any */}
                <div className="lg:col-span-4 flex flex-col gap-8">
                  {/* Future extensions (QR code, Map) will go here */}
                  <div className="bg-d-surface-container-low backdrop-blur-xl rounded-[24px] p-6 shadow-sm">
                     <h3 className="text-label-sm text-d-on-surface-variant mb-4 font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                        کد QR اختصاصی
                     </h3>
                     {editing ? (
                       <div className="flex flex-col items-center justify-center p-6 bg-d-surface-container rounded-2xl border border-d-outline-variant/30">
                          <img src={`/api/public/businesses/${editing.slug}/qr`} alt="QR Code" className="w-48 h-48 rounded-xl bg-white p-2" />
                          <p className="mt-4 text-center text-d-on-surface-variant text-sm">
                             کاربران با اسکن این کد مستقیماً به صفحه شما هدایت می‌شوند.
                          </p>
                       </div>
                     ) : (
                       <div className="flex flex-col items-center justify-center p-6 bg-d-surface-container rounded-2xl border border-d-outline-variant/30 text-center">
                          <span className="material-symbols-outlined text-4xl text-d-outline-variant mb-2">qr_code_scanner</span>
                          <p className="text-d-on-surface-variant text-sm">ابتدا پروفایل را ذخیره کنید تا QR کد ساخته شود.</p>
                       </div>
                     )}
                  </div>
                </div>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
