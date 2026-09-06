"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import {
  createBusiness,
  deleteBusiness,
  listBusinesses,
  updateBusiness,
  uploadBusinessMedia,
  type Business,
} from "@/lib/businesses";
import {
  Store,
  Home,
  BarChart3,
  User as UserIcon,
  Settings,
  Headphones,
  Search,
  Bell,
  CheckCircle2,
  Phone,
  Mail,
  Globe,
  MessageCircle,
  Copy,
  Check,
  Upload,
  Plus,
  ArrowLeft,
  Save,
  Image as ImageIcon,
  ChevronDown,
  Sparkles,
  LogOut,
  Edit2,
  Trash2,
} from "lucide-react";

import { OnboardingView } from "@/components/dashboard/OnboardingView";
const CATEGORIES = [
  "مبلمان و دکوراسیون داخلی",
  "کافه و رستوران",
  "پوشاک و مد",
  "زیبایی، پوست و سلامت",
  "خدمات دیجیتال و وب",
  "املاک و ساختمان",
  "فروشگاه لوازم خانگی",
  "خدمات خودرو و حمل‌ونقل",
  "آموزش و تدریس",
  "پزشکی و سلامت",
  "سایر خدمات و مشاغل",
];

const EMPTY_FORM = {
  name: "",
  category: "",
  description: "",
  phone: "",
  email: "",
  whatsapp: "",
  website: "",
  address: "",
  city: "",
};

type Feedback = { kind: "success" | "error"; text: string } | null;

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Business[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Media preview states
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>(
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
  );
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    listBusinesses()
      .then((data: Business[]) => {
        setItems(data);
        if (data.length > 0 && !editing) {
          populateForm(data[0]);
        } else if (data.length === 0) {
          setShowOnboarding(true);
        }
      })
      .catch((err: unknown) => setFeedback({ kind: "error", text: extractApiError(err) }))
      .finally(() => setLoading(false));
  }, [user]);

  function populateForm(b: Business) {
    setEditing(b);
    setLogoPreview(b.logo ? `${process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '')}${b.logo}` : null);
    setCoverPreview(b.cover_image ? `${process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '')}${b.cover_image}` : "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80");
    let ws = "";
    let wa = "";
    if (b.social_links && typeof b.social_links === "object") {
      const sl = b.social_links as Record<string, string>;
      ws = sl.website || "";
      wa = sl.whatsapp || "";
    }
    setForm({
      name: b.name || "",
      category: b.category || "",
      description: b.description || "",
      phone: b.phone || "",
      email: b.email || "",
      whatsapp: wa,
      website: ws,
      address: b.address || "",
      city: b.city || "",
    });
  }

  const set = (key: keyof typeof EMPTY_FORM) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
  };

  const handleCopy = (text: string, field: string) => {
    if (!text) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editing) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
      try {
        const formData = new FormData();
        formData.append('logo', file);
        const b = await uploadBusinessMedia(editing.id, formData);
        setEditing(b);
        setFeedback({ kind: "success", text: "لوگو با موفقیت آپلود شد." });
      } catch (err) {
        setFeedback({ kind: "error", text: "خطا در آپلود لوگو." });
      }
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editing) {
      const url = URL.createObjectURL(file);
      setCoverPreview(url);
      try {
        const formData = new FormData();
        formData.append('cover_image', file);
        const b = await uploadBusinessMedia(editing.id, formData);
        setEditing(b);
        setFeedback({ kind: "success", text: "تصویر کاور با موفقیت آپلود شد." });
      } catch (err) {
        setFeedback({ kind: "error", text: "خطا در آپلود کاور." });
      }
    }
  };

  const handleGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const urls: string[] = [];
      for (let i = 0; i < Math.min(files.length, 4); i++) {
        urls.push(URL.createObjectURL(files[i]));
      }
      setGalleryPreviews(urls);
    }
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);

    const socialLinks: Record<string, string> = {};
    if (form.whatsapp) socialLinks.whatsapp = form.whatsapp;
    if (form.website) socialLinks.website = form.website;

    const payload = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
    };

    try {
      const saved = editing
        ? await updateBusiness(editing.id, payload)
        : await createBusiness(payload);

      setItems((prev) =>
        editing ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev]
      );
      setEditing(saved);
      setFeedback({
        kind: "success",
        text: editing
          ? "اطلاعات کسب‌وکار با موفقیت به‌روزرسانی شد."
          : "کسب‌وکار با موفقیت ثبت شد.",
      });
    } catch (err: unknown) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setLogoPreview(null);
    setFeedback(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("آیا از حذف این پروفایل اطمینان دارید؟")) return;
    try {
      await deleteBusiness(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      if (editing?.id === id) {
        handleReset();
      }
      setFeedback({ kind: "success", text: "پروفایل کسب‌وکار حذف شد." });
    } catch (err: unknown) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    }
  }

  const handleSelectOnboardingPath = async (path: number) => {
    setSaving(true);
    try {
      const b = await createBusiness({ name: "کسب‌وکار من (پیش‌نویس)", category: CATEGORIES[0], onboarding_path: path });
      setItems([b]);
      populateForm(b);
      setShowOnboarding(false);
      if (path === 2) {
        router.push("/card-maker?b=" + b.id);
      } else if (path === 3) {
        router.push("/designer?b=" + b.id);
      }
    } catch (err) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    } finally {
      setSaving(false);
    }
  };

  if (showOnboarding) {
    return <OnboardingView onSelect={handleSelectOnboardingPath} />;
  }

  const userDisplayName = user?.phone ? user.phone : "کاربر گرامی";

  return (
    <div dir="rtl" className="min-h-screen bg-[#050b14] text-slate-100 font-sans selection:bg-[#00c98d]/20 selection:text-[#00c98d]">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={logoInputRef}
        onChange={handleLogoUpload}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
      />
      <input
        type="file"
        ref={coverInputRef}
        onChange={handleCoverUpload}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
      />
      <input
        type="file"
        ref={galleryInputRef}
        onChange={handleGalleryUpload}
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
      />

      {/* Top Header Bar (matches 6.png) */}
      <header className="sticky top-0 z-40 bg-[#070f1c]/90 backdrop-blur-md border-b border-[#12233b] px-4 lg:px-8 py-3.5 transition-all">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          {/* Logo Section (Right in RTL / Left in Visual layout) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00c98d] to-[#009267] flex items-center justify-center text-white shadow-lg shadow-[#00c98d]/20">
              <span className="font-black text-xl leading-none">i</span>
            </div>
            <div>
              <h1 className="font-black text-lg text-white tracking-tight leading-tight">اینکارت</h1>
              <p className="text-[10px] text-slate-400">کسب‌وکارهای برتر، در یک جا</p>
            </div>
          </div>

          {/* Search Bar in Middle */}
          <div className="flex-1 max-w-xl mx-4 relative hidden md:block">
            <Search className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="جستجوی کسب‌وکار، نام برند یا دسته‌بندی..."
              className="w-full bg-[#0a1526] border border-[#172b45] text-xs text-white placeholder:text-slate-500 rounded-full py-2.5 pr-11 pl-4 focus:outline-none focus:border-[#00c98d] transition"
            />
          </div>

          {/* Profile & Notification Header Icons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              title="اعلان‌ها"
              className="w-10 h-10 rounded-full bg-[#0a1526] border border-[#172b45] flex items-center justify-center text-slate-300 hover:text-white transition relative"
            >
              <Bell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-[#00c98d] absolute top-2.5 right-2.5 shadow-sm shadow-[#00c98d]" />
            </button>

            <div className="flex items-center gap-3 bg-[#0a1526]/80 border border-[#172b45] rounded-full py-1.5 px-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-900 to-teal-950 border border-teal-500/30 flex items-center justify-center text-teal-300 font-bold text-xs">
                {user?.phone ? user.phone.slice(-2) : <UserIcon className="w-4 h-4" />}
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-white leading-tight">
                  {userDisplayName}
                </p>
                <p className="text-[10px] text-[#00c98d] font-medium leading-none mt-0.5">مالک کسب‌وکار</p>
              </div>
              <button
                onClick={logout}
                title="خروج از حساب کاربری"
                className="text-slate-400 hover:text-red-400 p-1 mr-1 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container: 3 Columns (Left sidebar, Center form, Right live preview) */}
      <main className="max-w-[1600px] mx-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ================= COLUMN 1: LEFT NAVIGATION SIDEBAR ================= */}
          <aside className="lg:col-span-2 space-y-4">
            {/* Active Item: مدیریت کسب‌وکار */}
            <div className="p-3.5 rounded-2xl bg-[#091b24] border border-[#0d3b37] text-white flex items-center gap-3 shadow-lg shadow-[#00c98d]/5 cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-[#0e3b33] text-[#00c98d] flex items-center justify-center shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-white leading-tight">مدیریت کسب‌وکار</h2>
                <p className="text-[10px] text-slate-400 mt-0.5">ثبت و ویرایش اطلاعات کسب‌وکار</p>
              </div>
            </div>

            {/* Menu Links */}
            <nav className="space-y-1 bg-[#081322]/40 p-1.5 rounded-2xl border border-[#12233b]/60">
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#0b182b] transition text-right"
              >
                <Home className="w-4 h-4 text-slate-400" />
                <span>داشبورد</span>
              </button>
              <button
                onClick={() => router.push("/search")}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#0b182b] transition text-right"
              >
                <BarChart3 className="w-4 h-4 text-slate-400" />
                <span>آمار و بازدیدها</span>
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#0b182b] transition text-right"
              >
                <UserIcon className="w-4 h-4 text-slate-400" />
                <span>پروفایل کاربری</span>
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#0b182b] transition text-right"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                <span>تنظیمات</span>
              </button>
            </nav>

            {/* Support Widget */}
            <div className="p-4 rounded-2xl bg-[#081322] border border-[#13243a] text-center flex flex-col items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#0e2733] flex items-center justify-center text-[#00c98d]">
                <Headphones className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white">نیاز به راهنمایی دارید؟</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">با پشتیبانی ما در ارتباط باشید.</p>
              </div>
              <a
                href="tel:02112345678"
                className="w-full py-2 px-3 rounded-full border border-[#00c98d]/40 text-[#00c98d] text-xs font-medium hover:bg-[#00c98d]/10 transition flex items-center justify-center gap-1.5"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>تماس با پشتیبانی</span>
              </a>
            </div>

            {/* Existing businesses list (for quick switching) */}
            {items.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-[#081322] border border-[#13243a]">
                <p className="text-[11px] font-bold text-slate-300 mb-2.5">کسب‌وکارهای من ({items.length})</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {items.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => populateForm(b)}
                      className={`w-full text-right p-2 rounded-xl text-xs flex items-center justify-between gap-2 transition ${
                        editing?.id === b.id
                          ? "bg-[#0f2938] text-[#00c98d] font-bold border border-[#00c98d]/30"
                          : "text-slate-300 hover:bg-[#0b182b]"
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      <Edit2 className="w-3 h-3 shrink-0 text-slate-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ================= COLUMN 2: CENTER MAIN FORM ================= */}
          <section className="lg:col-span-7 space-y-6">
            {/* Header */}
            <div>
              <h2 className="text-lg lg:text-xl font-extrabold text-white">ثبت یا ویرایش کسب‌وکار</h2>
              <p className="text-xs text-slate-400 mt-1">
                اطلاعات کسب‌وکار خود را وارد کنید تا در اینکارت نمایش داده شود. این اطلاعات توسط کاربران قابل جستجو خواهد بود.
              </p>
            </div>

            {/* Feedback message */}
            {feedback && (
              <div
                className={`p-3.5 rounded-xl text-xs font-medium flex items-center justify-between border ${
                  feedback.kind === "success"
                    ? "bg-[#06241a] border-[#00c98d]/40 text-[#42e8b0]"
                    : "bg-[#280c10] border-red-500/40 text-red-300"
                }`}
              >
                <span>{feedback.text}</span>
                <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white text-sm mr-2">
                  ×
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Row 1: Brand Name & Category (Right) + Logo Upload (Left in RTL) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                
                {/* Inputs (Right sub-col in RTL: 7 cols) */}
                <div className="md:col-span-7 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-200 mb-1.5">
                      نام برند شما <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={set("name")}
                      placeholder="مثال: مبلمان خانه"
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-200 mb-1.5">
                      دسته‌بندی کسب‌وکار <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={form.category}
                        onChange={set("category")}
                        className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] appearance-none transition"
                      >
                        <option value="">انتخاب دسته‌بندی</option>
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat} className="bg-[#0b1626] text-white">
                            {cat}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Logo Upload Box (Left sub-col in RTL: 5 cols) */}
                <div className="md:col-span-5">
                  <span className="block text-xs font-medium text-slate-200 mb-1.5">لوگوی کسب‌وکار</span>
                  <div
                    onClick={() => logoInputRef.current?.click()}
                    className="h-[135px] rounded-2xl border-2 border-dashed border-[#1a3350] bg-[#07111f]/60 hover:bg-[#0a182c] hover:border-[#00c98d]/60 transition cursor-pointer flex flex-col items-center justify-center p-3 text-center group relative overflow-hidden"
                  >
                    {logoPreview ? (
                      <div className="relative w-full h-full flex flex-col items-center justify-center">
                        <img src={logoPreview} alt="لوگو" className="w-16 h-16 rounded-xl object-contain" />
                        <span className="text-[10px] text-[#00c98d] font-bold mt-1">تغییر لوگو</span>
                      </div>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-full bg-[#0e1e33] flex items-center justify-center text-slate-400 group-hover:text-[#00c98d] transition mb-1.5">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-white group-hover:text-[#00c98d] transition">
                          آپلود لوگو
                        </span>
                        <span className="text-[10px] text-slate-500 mt-0.5">حداکثر ۲ مگابایت • PNG, JPG</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Description (Right) + Business Images (Left in RTL) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                
                {/* Description (7 cols) */}
                <div className="md:col-span-7">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-200">
                      توضیحات کسب‌وکار <span className="text-red-400">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <textarea
                      rows={5}
                      maxLength={500}
                      value={form.description}
                      onChange={set("description")}
                      placeholder="توضیح کوتاهی درباره کسب‌وکار، محصولات یا خدمات خود بنویسید..."
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-2xl p-3.5 pb-7 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] resize-none transition h-[135px]"
                    />
                    <span className="absolute bottom-2 left-3 text-[10px] text-slate-500">
                      {form.description.length}/500
                    </span>
                  </div>
                </div>

                {/* Business Gallery Images (5 cols) */}
                <div className="md:col-span-5">
                  <span className="block text-xs font-medium text-slate-200 mb-1.5">تصاویر کسب‌وکار</span>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 1, 2, 3].map((idx) => {
                      const img = galleryPreviews[idx];
                      return (
                        <div
                          key={idx}
                          onClick={() => galleryInputRef.current?.click()}
                          className={`aspect-square rounded-xl border flex flex-col items-center justify-center cursor-pointer transition overflow-hidden relative group ${
                            idx === 0
                              ? "border-[#00c98d] bg-[#071822]"
                              : "border-[#172c48] bg-[#081220] hover:border-slate-500"
                          }`}
                        >
                          {img ? (
                            <img src={img} alt="گالری" className="w-full h-full object-cover" />
                          ) : (
                            <Plus
                              className={`w-4 h-4 ${
                                idx === 0 ? "text-[#00c98d]" : "text-slate-400 group-hover:text-white"
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">حداکثر ۵ تصویر، هر کدام تا ۵ مگابایت</p>
                </div>
              </div>

              {/* Row 3: Communication Methods (راه‌های ارتباطی) */}
              <div className="rounded-2xl bg-[#071220] border border-[#14263f] p-4 lg:p-5 space-y-4">
                <div className="flex items-center gap-2 text-white font-bold text-xs pb-1 border-b border-[#14263f]">
                  <Phone className="w-4 h-4 text-[#00c98d]" />
                  <span>راه‌های ارتباطی</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      شماره تماس <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      dir="ltr"
                      value={form.phone}
                      onChange={set("phone")}
                      placeholder="مثال: 0912 123 4567"
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] transition"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>ایمیل</span>
                    </div>
                    <input
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={set("email")}
                      placeholder="example@domain.com"
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] transition"
                    />
                  </div>

                  {/* WhatsApp */}
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                      <MessageCircle className="w-3.5 h-3.5 text-[#00c98d]" />
                      <span>واتساپ</span>
                    </div>
                    <input
                      type="tel"
                      dir="ltr"
                      value={form.whatsapp}
                      onChange={set("whatsapp")}
                      placeholder="مثال: 0912 123 4567"
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] transition"
                    />
                  </div>

                  {/* Website */}
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                      <Globe className="w-3.5 h-3.5 text-slate-400" />
                      <span>آدرس وب‌سایت</span>
                    </div>
                    <input
                      type="text"
                      dir="ltr"
                      value={form.website}
                      onChange={set("website")}
                      placeholder="www.example.com"
                      className="w-full bg-[#07101d] border border-[#192b45] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00c98d] transition"
                    />
                  </div>
                </div>
              </div>

              {/* Form Action Buttons (Save & Cancel) */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-gradient-to-r from-[#00c98d] to-[#009267] text-white px-7 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#00c98d]/25 hover:brightness-110 active:scale-[0.98] transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "در حال ذخیره..." : "ذخیره اطلاعات"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="bg-[#091524] border border-[#172c47] text-slate-300 hover:text-white px-6 py-2.5 rounded-xl font-medium text-xs hover:bg-[#0c1c30] transition cursor-pointer"
                >
                  انصراف
                </button>

                {editing && (
                  <button
                    type="button"
                    onClick={() => handleDelete(editing.id)}
                    className="mr-auto text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 transition flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف کسب‌وکار</span>
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* ================= COLUMN 3: RIGHT PANEL - LIVE PREVIEW ================= */}
          <aside className="lg:col-span-3 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">پیش‌نمایش پروفایل کسب‌وکار</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">این نمایشی از اطلاعات شما در صفحه جستجو است..</p>
            </div>

            {/* The Live Interactive Preview Card (exactly matches 6.png) */}
            <div className="rounded-2xl bg-[#091424] border border-[#162a44] overflow-hidden shadow-2xl shadow-black/50">
              {/* Cover Banner with Edit Cover Button */}
              <div className="relative h-36 w-full bg-slate-800 overflow-hidden group">
                <img
                  src={coverPreview}
                  alt="کاور کسب‌وکار"
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                />
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-lg border border-white/20 flex items-center gap-1.5 hover:bg-black/80 transition"
                >
                  <Upload className="w-3 h-3 text-[#00c98d]" />
                  <span>ویرایش تصویر کاور</span>
                </button>
              </div>

              {/* Avatar Logo Box */}
              <div className="relative px-5 pt-0 pb-5 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#062425] border-2 border-[#091424] flex items-center justify-center text-teal-300 font-bold text-xl shadow-xl -mt-8 mx-auto relative z-10 overflow-hidden">
                  {logoPreview ? (
                    <img src={logoPreview} alt="لوگو" className="w-full h-full object-contain p-1" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#072d2e] text-[#00c98d]">
                      <Sparkles className="w-7 h-7" />
                    </div>
                  )}
                </div>

                {/* Brand Name & Verified Badge */}
                <div className="mt-3 flex items-center justify-center gap-1.5">
                  <h4 className="font-extrabold text-sm text-white">
                    {form.name ? form.name : "مبلمان خانه"}
                  </h4>
                  <CheckCircle2 className="w-4 h-4 text-[#00c98d] shrink-0" />
                </div>

                {/* Category */}
                <p className="text-[11px] text-slate-400 mt-1 font-medium">
                  {form.category ? form.category : "مبلمان و دکوراسیون داخلی"}
                </p>

                {/* Description */}
                <p className="text-xs text-slate-300 leading-relaxed mt-2.5 line-clamp-3 text-right">
                  {form.description
                    ? form.description
                    : "تولید و عرضه انواع مبلمان راحتی و کلاسیک با کیفیت و طراحی مدرن، مناسب برای خانه و محل کار."}
                </p>

                {/* Contact items list with dark pill containers & copy icon */}
                <div className="space-y-2 mt-4 text-right">
                  {/* Phone */}
                  <div className="bg-[#060e19] border border-[#14253d] rounded-xl px-3 py-2 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-[#00c98d]" />
                      <span dir="ltr" className="font-mono text-xs">
                        {form.phone ? form.phone : "0912 123 4567"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(form.phone || "09121234567", "phone")}
                      className="text-slate-500 hover:text-white transition p-0.5"
                      title="کپی شماره"
                    >
                      {copiedField === "phone" ? (
                        <Check className="w-3 h-3 text-[#00c98d]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {/* WhatsApp */}
                  <div className="bg-[#060e19] border border-[#14253d] rounded-xl px-3 py-2 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-3.5 h-3.5 text-[#00c98d]" />
                      <span dir="ltr" className="font-mono text-xs">
                        {form.whatsapp ? form.whatsapp : "0912 123 4567"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(form.whatsapp || "09121234567", "whatsapp")}
                      className="text-slate-500 hover:text-white transition p-0.5"
                      title="کپی واتساپ"
                    >
                      {copiedField === "whatsapp" ? (
                        <Check className="w-3 h-3 text-[#00c98d]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {/* Email */}
                  <div className="bg-[#060e19] border border-[#14253d] rounded-xl px-3 py-2 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-[#00c98d]" />
                      <span dir="ltr" className="text-xs truncate max-w-[140px]">
                        {form.email ? form.email : "info@domain.com"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(form.email || "info@domain.com", "email")}
                      className="text-slate-500 hover:text-white transition p-0.5"
                      title="کپی ایمیل"
                    >
                      {copiedField === "email" ? (
                        <Check className="w-3 h-3 text-[#00c98d]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {/* Website */}
                  <div className="bg-[#060e19] border border-[#14253d] rounded-xl px-3 py-2 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-[#00c98d]" />
                      <span dir="ltr" className="text-xs truncate max-w-[140px]">
                        {form.website ? form.website : "www.domain.com"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(form.website || "www.domain.com", "website")}
                      className="text-slate-500 hover:text-white transition p-0.5"
                      title="کپی وب‌سایت"
                    >
                      {copiedField === "website" ? (
                        <Check className="w-3 h-3 text-[#00c98d]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Bottom CTA Button */}
                <button
                  type="button"
                  onClick={() => router.push(editing ? `/b/${editing.slug}` : "/search")}
                  className="w-full mt-4 py-2.5 rounded-xl bg-[#0c1a2d] border border-[#1a3352] text-xs font-semibold text-slate-200 hover:text-white hover:bg-[#10233d] transition flex items-center justify-center gap-2"
                >
                  <span>مشاهده در اینکارت</span>
                  <ArrowLeft className="w-3.5 h-3.5 text-[#00c98d]" />
                </button>
              </div>
            </div>
          </aside>

        </div>
      </main>
    </div>
  );
}
