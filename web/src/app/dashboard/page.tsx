"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { getQrUrl } from "@/lib/businesses";
import { OnboardingView } from "@/components/dashboard/OnboardingView";
import MapViewLazy from "@/components/map/MapViewLazy";
import {
  addImage,
  badgeLabel,
  getImages,
  getOwnedBusiness,
  getOwnedBusinesses,
  mediaUrl,
  normalizeSocial,
  removeImage,
  safeHttpUrl,
  saveProfile,
  statusLabel,
  uploadProfileMedia,
  type BusinessImage,
  type BusinessInput,
  type Phase2Business,
} from "@/lib/phase2";
import {
  Building2,
  Plus,
  Save,
  ExternalLink,
  MapPin,
  Phone,
  Mail,
  Camera,
  Globe,
  Trash2,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Clock,
  QrCode,
  Sparkles,
  LogOut,
  CreditCard,
  ChevronDown,
  X,
  Loader2,
  Image as ImageIcon,
  Share2,
} from "lucide-react";

type Form = {
  name: string;
  category: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  neighborhood: string;
  latitude: string;
  longitude: string;
  services: string;
};

type Social = { key: string; url: string };

const EMPTY: Form = {
  name: "",
  category: "",
  description: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  neighborhood: "",
  latitude: "",
  longitude: "",
  services: "",
};

const CATEGORIES = [
  "کافه و رستوران",
  "مبلمان و دکوراسیون داخلی",
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

const PRESET_SOCIALS = [
  { key: "instagram", label: "اینستاگرام", placeholder: "username یا لینک کامل", icon: Camera },
  { key: "telegram", label: "تلگرام", placeholder: "username یا t.me/username", icon: Share2 },
  { key: "whatsapp", label: "واتساپ", placeholder: "شماره با 98 یا لینک wa.me", icon: Phone },
  { key: "website", label: "وب‌سایت", placeholder: "https://example.com", icon: Globe },
];

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Phase2Business[]>([]);
  const [editing, setEditing] = useState<Phase2Business | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [social, setSocial] = useState<Social[]>([]);
  const [images, setImages] = useState<BusinessImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [deleteImage, setDeleteImage] = useState<number | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const mediaForm = useRef<HTMLDivElement>(null);

  function choose(b: Phase2Business | null) {
    setEditing(b);
    setLogo(null);
    setCover(null);
    setImages([]);
    setMessage(null);
    setDeleteImage(null);
    if (mediaForm.current) {
      mediaForm.current
        .querySelectorAll<HTMLInputElement>('input[type="file"]')
        .forEach((x) => (x.value = ""));
    }
    setForm(
      b
        ? {
            name: b.name,
            category: b.category || "",
            description: b.description || "",
            phone: b.phone || "",
            email: b.email || "",
            address: b.address || "",
            city: b.city || "",
            neighborhood: b.neighborhood || "",
            latitude: b.latitude == null ? "" : String(b.latitude),
            longitude: b.longitude == null ? "" : String(b.longitude),
            services: (b.services || []).join("\n"),
          }
        : EMPTY,
    );
    const links = b?.social_links;
    setSocial(
      links
        ? Array.isArray(links)
          ? links.map((url, i) => ({ key: `link${i + 1}`, url }))
          : Object.entries(links).map(([key, url]) => ({ key, url: url || "" }))
        : [],
    );
  }

  function remember(b: Phase2Business) {
    setEditing(b);
    setItems((xs) => (xs.some((x) => x.id === b.id) ? xs.map((x) => (x.id === b.id ? b : x)) : [b, ...xs]));
  }

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    getOwnedBusinesses()
      .then((data) => {
        if (active) {
          setItems(data);
          choose(data[0] || null);
          setOnboarding(data.length === 0);
        }
      })
      .catch((e) => {
        if (active) setMessage({ text: extractApiError(e), error: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!editing?.id) return;
    let active = true;
    void (async () => {
      setGalleryLoading(true);
      try {
        const data = await getImages(editing.id);
        if (active) setImages(data);
      } catch (e) {
        if (active) setMessage({ text: extractApiError(e), error: true });
      } finally {
        if (active) setGalleryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [editing?.id]);

  const change = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  function payload(): BusinessInput {
    const links: Record<string, string> = Object.create(null);
    for (const row of social) {
      if (!row.url.trim()) continue;
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(row.key) ||
        ["__proto__", "prototype", "constructor"].includes(row.key) ||
        Object.hasOwn(links, row.key)
      ) {
        throw new Error("نام شبکه‌ها باید انگلیسی و غیرتکراری باشد.");
      }
      links[row.key] = normalizeSocial(row.key, row.url);
    }
    const latitude = form.latitude.trim() === "" ? null : Number(form.latitude);
    const longitude = form.longitude.trim() === "" ? null : Number(form.longitude);
    if (
      (latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))
    ) {
      throw new Error("طول و عرض جغرافیایی معتبر را با هم وارد کنید.");
    }
    const nullable = (value: string) => value.trim() || null;
    return {
      name: form.name.trim(),
      category: nullable(form.category),
      description: nullable(form.description),
      phone: nullable(form.phone),
      email: nullable(form.email),
      city: nullable(form.city),
      neighborhood: nullable(form.neighborhood),
      address: nullable(form.address),
      latitude,
      longitude,
      services: Array.from(new Set(form.services.split(/\n|،/).map((x) => x.trim()).filter(Boolean))),
      social_links: links,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    let profileSaved = false;
    try {
      let saved = await saveProfile(editing?.id || null, payload());
      remember(saved);
      profileSaved = true;
      if (logo || cover) {
        const data = new FormData();
        if (logo) data.append("logo", logo);
        if (cover) data.append("cover_image", cover);
        saved = await uploadProfileMedia(saved.id, data);
        remember(saved);
        setLogo(null);
        setCover(null);
        if (mediaForm.current) {
          mediaForm.current
            .querySelectorAll<HTMLInputElement>('input[type="file"]')
            .forEach((x) => (x.value = ""));
        }
      }
      setMessage({
        text:
          saved.status === "suspended"
            ? "اطلاعات ذخیره شد؛ تعلیق فقط توسط مدیر برداشته می‌شود."
            : "اطلاعات با موفقیت ذخیره شد. تغییرات پروفایل برای بررسی و انتشار به مدیر ارسال شد.",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setMessage({
        text: (profileSaved ? "پروفایل ذخیره شد ولی آپلود تصویر کامل نشد: " : "") + extractApiError(e),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshSelected(id: number) {
    const b = await getOwnedBusiness(id);
    remember(b);
    setImages(await getImages(id));
  }

  async function gallery(files: FileList | null) {
    if (!files?.length || !editing) return;
    const selected = Array.from(files);
    if (images.length + selected.length > 5) {
      setMessage({ text: "گالری تصاویر حداکثر می‌تواند ۵ تصویر داشته باشد.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    let added = 0;
    try {
      for (const file of selected) {
        await addImage(editing.id, file);
        added++;
      }
      setMessage({ text: `${added} تصویر با موفقیت به ویترین افزوده شد.` });
    } catch (e) {
      setMessage({ text: `${added} تصویر ثبت شد؛ ` + extractApiError(e), error: true });
    } finally {
      try {
        await refreshSelected(editing.id);
      } catch (e) {
        setMessage({ text: extractApiError(e), error: true });
      }
      setBusy(false);
    }
  }

  async function eraseImage(id: number) {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeImage(editing.id, id);
      await refreshSelected(editing.id);
      setDeleteImage(null);
      setMessage({ text: "تصویر از گالری حذف شد." });
    } catch (e) {
      setMessage({ text: extractApiError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function clearMedia(field: "logo" | "cover_image") {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = new FormData();
      data.append(`remove_${field}`, "1");
      remember(await uploadProfileMedia(editing.id, data));
      setMessage({ text: "تصویر با موفقیت حذف شد." });
    } catch (e) {
      setMessage({ text: extractApiError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = safeHttpUrl(editing?.public_url);
  const validPoint =
    form.latitude !== "" &&
    form.longitude !== "" &&
    Number.isFinite(Number(form.latitude)) &&
    Number.isFinite(Number(form.longitude)) &&
    Math.abs(Number(form.latitude)) <= 90 &&
    Math.abs(Number(form.longitude)) <= 180;

  if (authLoading || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090d16] text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <p className="text-xs sm:text-sm text-slate-400 font-medium">در حال بارگذاری پنل کسب‌وکار…</p>
        </div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <OnboardingView
        onSkip={() => setOnboarding(false)}
        onSelect={(path) => {
          setOnboarding(false);
          if (path === 2) router.push("/card-maker");
          if (path === 3) router.push("/designer");
        }}
      />
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#090d16] text-slate-100 selection:bg-cyan-500/20 font-sans pb-28">
      {/* Top Floating Smart Taskbar */}
      <div className="sticky top-3 sm:top-5 z-50 px-3 sm:px-6">
        <header className="mx-auto max-w-5xl rounded-2xl border border-slate-800/80 bg-[#0b1120]/85 p-1 backdrop-blur-2xl shadow-[0_10px_35px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)]">
          <div className="flex h-14 sm:h-16 items-center justify-between px-3 sm:px-5">
            {/* Right: Brand & Panel Indicator */}
            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <Link href="/" className="flex items-center gap-2 group shrink-0" aria-label="اینکارت">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 font-black text-base shadow-sm">
                  اَ
                </span>
                <span className="font-black text-base sm:text-lg text-white group-hover:text-cyan-400 transition-colors">
                  اینکارت
                </span>
              </Link>
              <div className="h-4 w-px bg-slate-800 hidden sm:block shrink-0" />
              <span className="truncate rounded-md bg-slate-850 px-2.5 py-1 text-[11px] font-semibold text-slate-300 border border-slate-700/50 hidden sm:inline-block">
                پنل مدیریت کسب‌وکار
              </span>
            </div>

            {/* Left: Human-Engineered Button Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <Link
                href="/card-maker"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-850/80 px-2.5 sm:px-3 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white transition-all active:scale-[0.98]"
                title="کارت‌ساز دیجیتال"
              >
                <CreditCard className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span className="hidden md:inline">کارت‌ساز دیجیتال</span>
                <span className="md:hidden text-[11px]">کارت‌ساز</span>
              </Link>

              <Link
                href="/"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 sm:px-3 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-850 hover:text-white transition-all active:scale-[0.98]"
              >
                <span className="hidden sm:inline">صفحه اصلی</span>
                <span className="sm:hidden text-[11px]">خانه</span>
              </Link>

              <button
                type="button"
                disabled={busy}
                onClick={() => void logout()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 sm:px-3 text-xs font-medium text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/40 active:scale-[0.98] transition-all cursor-pointer"
                title="خروج از حساب کاربری"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>
        </header>
      </div>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Page Title & Business Switcher Header */}
        <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm">
          <div>
            <span className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
              مرکز مدیریت نمایه
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-white mt-1">
              {editing ? editing.name : "ثبت کسب‌وکار جدید"}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              اطلاعات، راه‌های ارتباطی، تصاویر و لوکیشن را کامل کنید تا پس از بررسی مدیر به صورت عمومی منتشر شود.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:self-center">
            {/* Business Dropdown Switcher */}
            <div className="relative min-w-[200px] flex-1 sm:flex-none">
              <select
                disabled={busy}
                value={editing?.id || ""}
                onChange={(e) =>
                  choose(items.find((x) => x.id === Number(e.target.value)) || null)
                }
                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-8 pr-9 text-xs sm:text-sm font-semibold text-white outline-none transition focus:border-cyan-400 cursor-pointer"
              >
                <option value="">+ ثبت کسب‌وکار جدید</option>
                {items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Building2 className="absolute right-3 top-3 h-4 w-4 text-cyan-400 pointer-events-none" />
              <ChevronDown className="absolute left-2.5 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => choose(null)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>کسب‌وکار جدید</span>
            </button>
          </div>
        </section>

        {/* Global Feedback Message */}
        {message && (
          <div
            role={message.error ? "alert" : "status"}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-xs sm:text-sm animate-in fade-in ${
              message.error
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {message.error ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            )}
            <div className="flex-1 font-medium leading-relaxed">{message.text}</div>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Verification Status & Public Links Card (Polaris Banner) */}
        {editing && (
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400">وضعیت نمایه:</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap ${
                    editing.status === "approved"
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      : editing.status === "pending"
                        ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {editing.status === "approved" && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {editing.status === "pending" && <Clock className="h-3.5 w-3.5" />}
                  {editing.status !== "approved" && editing.status !== "pending" && (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <span>{statusLabel[editing.status] || editing.status}</span>
                </span>
              </div>

              {/* Badges preview */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(editing.badges || []).map((x) => (
                  <span
                    key={x}
                    className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[11px] font-medium text-cyan-300"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{badgeLabel[x] || x}</span>
                  </span>
                ))}
              </div>
            </div>

            {editing.moderation_note && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                <strong className="font-bold">یادداشت مدیر بررسی: </strong>
                <span>{editing.moderation_note}</span>
              </div>
            )}

            {/* Public Link & QR Code row */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="text-slate-400">آدرس اختصاصی:</span>
                {publicUrl ? (
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-cyan-300 hover:underline truncate max-w-[240px] sm:max-w-md"
                    dir="ltr"
                  >
                    {publicUrl}
                  </a>
                ) : (
                  <span className="text-slate-500">پس از تایید مدیر فعال خواهد شد.</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {editing.status === "approved" && publicUrl && (
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:text-white"
                  >
                    <span>مشاهده صفحه</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {editing.slug && (
                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:text-white cursor-pointer"
                  >
                    <QrCode className="h-3 w-3 text-cyan-400" />
                    <span>کد QR اختصاصی</span>
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* QR Code Modal */}
        {showQrModal && editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0f172a] p-6 text-center shadow-2xl space-y-4">
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>

              <h3 className="text-base font-bold text-white">بارکد QR اختصاصی کسب‌وکار</h3>
              <p className="text-xs text-slate-400">
                این بارکد را چاپ کرده یا در کارت ویزیت و بنرهای فروشگاه قرار دهید تا مشتریان مستقیماً به نمایه شما وارد شوند.
              </p>

              <div className="flex justify-center py-2">
                <div className="rounded-xl border-4 border-white bg-white p-3 shadow-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getQrUrl(editing.slug)}
                    alt="QR اختصاصی"
                    width={180}
                    height={180}
                    className="mx-auto"
                  />
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 pt-2">
                <a
                  href={getQrUrl(editing.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>دانلود فایل بارکد</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Main Edit Form */}
        <form onSubmit={submit} className="space-y-6">
          {/* Card 1: Visual Identity & Branding (Logo & Cover) */}
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5" ref={mediaForm}>
            <div className="flex items-center gap-2.5 border-b border-slate-800/80 pb-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                <ImageIcon className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  هویت بصری (لوگو و تصویر کاور)
                </h3>
                <p className="text-[11px] text-slate-400">
                  لوگو نماد برند شماست و کاور در بالای صفحه نمایه به عنوان بنر اصلی قرار می‌گیرد.
                </p>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {/* Logo Box */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300">لوگوی کسب‌وکار</span>
                <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                    {mediaUrl(editing?.logo) ? (
                      <Image
                        src={mediaUrl(editing?.logo)!}
                        alt="لوگوی فعلی"
                        fill
                        className="object-contain p-1"
                        sizes="80px"
                      />
                    ) : (
                      <Building2 className="h-8 w-8 text-slate-600" />
                    )}
                  </div>
                  <div className="space-y-2 min-w-0 flex-1">
                    <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap">
                      <UploadCloud className="h-3.5 w-3.5 text-cyan-400" />
                      <span>{logo ? logo.name : "انتخاب لوگوی جدید"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(e) => setLogo(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[10px] text-slate-400">حداکثر ۲ مگابایت (PNG، JPG یا WebP)</p>
                    {editing?.logo && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void clearMedia("logo")}
                        className="text-[11px] text-rose-400 hover:underline cursor-pointer block"
                      >
                        حذف لوگوی فعلی
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Cover Photo Box */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300">تصویر کاور و بنر</span>
                <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="relative h-24 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
                    {mediaUrl(editing?.cover_image) ? (
                      <Image
                        src={mediaUrl(editing?.cover_image)!}
                        alt="کاور فعلی"
                        fill
                        className="object-cover"
                        sizes="400px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
                        بدون تصویر کاور
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap">
                      <UploadCloud className="h-3.5 w-3.5 text-cyan-400" />
                      <span>{cover ? cover.name : "انتخاب کاور جدید"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(e) => setCover(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                    {editing?.cover_image && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void clearMedia("cover_image")}
                        className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                      >
                        حذف کاور
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Core Business Info & Contact */}
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-800/80 pb-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">اطلاعات اصلی و راه‌های ارتباطی</h3>
                <p className="text-[11px] text-slate-400">
                  این اطلاعات در کارت‌های جستجو و بالای نمایه عمومی شما نمایش داده می‌شوند.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300">
                  نام کسب‌وکار یا فروشگاه <span className="text-rose-400">*</span>
                </span>
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                  placeholder="مثال: کافه رستوران سپیدار"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300">دسته‌بندی و صنف</span>
                <input
                  list="business-categories"
                  maxLength={120}
                  value={form.category}
                  onChange={(e) => change("category", e.target.value)}
                  placeholder="انتخاب یا تایپ صنف..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
                <datalist id="business-categories">
                  {CATEGORIES.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </label>

              {/* Categories quick pills */}
              <div className="sm:col-span-2 -mt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">پیشنهادات صنف:</span>
                  {CATEGORIES.slice(0, 6).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => change("category", cat)}
                      className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                        form.category === cat
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span>شماره تماس پاسخگویی</span>
                </span>
                <input
                  type="tel"
                  dir="ltr"
                  maxLength={30}
                  value={form.phone}
                  onChange={(e) => change("phone", e.target.value)}
                  placeholder="0912... یا 021..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 font-mono text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>ایمیل کاری یا پشتیبانی</span>
                </span>
                <input
                  type="email"
                  dir="ltr"
                  maxLength={255}
                  value={form.email}
                  onChange={(e) => change("email", e.target.value)}
                  placeholder="contact@example.com"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 font-mono text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300">شهر</span>
                <input
                  maxLength={120}
                  value={form.city}
                  onChange={(e) => change("city", e.target.value)}
                  placeholder="مثال: تهران، مشهد، اصفهان..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300">محله یا منطقه</span>
                <input
                  maxLength={120}
                  value={form.neighborhood}
                  onChange={(e) => change("neighborhood", e.target.value)}
                  placeholder="مثال: سعادت‌آباد، احمدآباد..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="sm:col-span-2 space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>آدرس دقیق پستی</span>
                </span>
                <input
                  maxLength={1000}
                  value={form.address}
                  onChange={(e) => change("address", e.target.value)}
                  placeholder="خیابان، پلاک، طبقه یا نشانی دقیق..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>
          </section>

          {/* Card 3: About & Services */}
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-800/80 pb-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">معرفی و فهرست خدمات</h3>
                <p className="text-[11px] text-slate-400">
                  داستان برند، تخصص‌ها، ساعات کاری و مزیت‌های رقابتی خود را برای مشتریان توضیح دهید.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="space-y-1.5 block">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">توضیحات و بیوگرافی کسب‌وکار</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {form.description.length} / 5000 کاراکتر
                  </span>
                </div>
                <textarea
                  rows={4}
                  maxLength={5000}
                  value={form.description}
                  onChange={(e) => change("description", e.target.value)}
                  placeholder="توضیح کامل درباره تاریخچه، زمینه فعالیت، خدمات ویژه و ساعات کاری..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="space-y-1.5 block">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    لیست خدمات و محصولات ویژه (هر مورد در یک سطر)
                  </span>
                  <span className="text-[10px] text-slate-500">حداکثر ۳۰ خدمت</span>
                </div>
                <textarea
                  rows={3}
                  value={form.services}
                  onChange={(e) => change("services", e.target.value)}
                  placeholder="مثال:&#10;اینترنت رایگان&#10;پارکینگ اختصاصی&#10;سفارش بیرون‌بر&#10;مشاوره رایگان"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>
          </section>

          {/* Card 4: Location & Map Picker */}
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">موقعیت جغرافیایی و نقشه</h3>
                  <p className="text-[11px] text-slate-400">
                    روی نقشه کلیک کنید تا مکان دقیق فروشگاه یا دفتر شما ثبت شود.
                  </p>
                </div>
              </div>
              {validPoint && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, latitude: "", longitude: "" }))}
                  className="text-xs text-rose-400 hover:underline cursor-pointer"
                >
                  پاک‌کردن پین
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-300">عرض جغرافیایی (Latitude)</span>
                <input
                  type="number"
                  min={-90}
                  max={90}
                  step="any"
                  dir="ltr"
                  value={form.latitude}
                  onChange={(e) => change("latitude", e.target.value)}
                  placeholder="35.6892..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-300">طول جغرافیایی (Longitude)</span>
                <input
                  type="number"
                  min={-180}
                  max={180}
                  step="any"
                  dir="ltr"
                  value={form.longitude}
                  onChange={(e) => change("longitude", e.target.value)}
                  placeholder="51.3890..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            {/* Interactive Map */}
            <div className="relative isolate z-10 overflow-hidden rounded-xl border border-slate-800">
              <MapViewLazy
                className="h-[320px] w-full"
                markers={
                  validPoint
                    ? [
                        {
                          id: "picked",
                          title: form.name || "موقعیت کسب‌وکار",
                          latitude: Number(form.latitude),
                          longitude: Number(form.longitude),
                        },
                      ]
                    : []
                }
                onPick={
                  busy
                    ? undefined
                    : (lat, lng) =>
                        setForm((f) => ({
                          ...f,
                          latitude: lat.toFixed(7),
                          longitude: lng.toFixed(7),
                        }))
                }
              />
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              برای تعیین مکان، کافیست روی نقشه در نقطه دلخواه کلیک کنید یا پین را جابجا کنید.
            </p>
          </section>

          {/* Card 5: Social Media & Channels */}
          <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                  <Share2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    شبکه‌های اجتماعی و پیام‌رسان‌ها
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    مشتریان از طریق این پیوندها می‌توانند با شما در ارتباط باشند.
                  </p>
                </div>
              </div>

              {/* Quick Add Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">افزودن سریع:</span>
                {PRESET_SOCIALS.map((p) => {
                  const alreadyHas = social.some((s) => s.key.toLowerCase() === p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={alreadyHas || social.length >= 10}
                      onClick={() => setSocial((xs) => [...xs, { key: p.key, url: "" }])}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      <p.icon className="h-3 w-3 text-cyan-400" />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              {social.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3"
                >
                  <div className="sm:w-44 space-y-1">
                    <span className="text-[11px] text-slate-400">نام شبکه (انگلیسی)</span>
                    <input
                      dir="ltr"
                      maxLength={40}
                      value={row.key}
                      placeholder="instagram, telegram..."
                      onChange={(e) =>
                        setSocial((xs) =>
                          xs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                        )
                      }
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div className="flex-1 space-y-1">
                    <span className="text-[11px] text-slate-400">لینک صفحه، نام کاربری یا شماره</span>
                    <input
                      dir="ltr"
                      maxLength={500}
                      value={row.url}
                      placeholder="https://... یا username"
                      onChange={(e) =>
                        setSocial((xs) =>
                          xs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        )
                      }
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setSocial((xs) => xs.filter((_, j) => j !== i))}
                    className="self-end sm:self-center mt-2 sm:mt-5 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                    title="حذف این شبکه"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {social.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-500">
                  هنوز شبکه ارتباطی اضافه نکرده‌اید. از دکمه‌های «افزودن سریع» بالا یا دکمه زیر استفاده کنید.
                </p>
              )}

              <button
                type="button"
                disabled={social.length >= 10}
                onClick={() => setSocial((xs) => [...xs, { key: "", url: "" }])}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>افزودن شبکه دلخواه دیگر</span>
              </button>
            </div>
          </section>

          {/* Floating Contextual Save Bar (Linear / Vercel Pattern) */}
          <div className="fixed bottom-3 sm:bottom-5 inset-x-0 z-50 pointer-events-none px-4">
            <div className="mx-auto max-w-3xl pointer-events-auto rounded-2xl border border-slate-700/60 bg-[#0b1120]/95 backdrop-blur-2xl p-3 sm:px-6 sm:py-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.06)] flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 transition-all">
              <div className="text-center sm:text-right min-w-0">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-white truncate">
                    {editing ? `در حال ویرایش: ${form.name || editing.name}` : "ثبت کسب‌وکار جدید"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 hidden sm:block">
                  تغییرات شما در دیتابیس ثبت و برای بررسی ارسال خواهد شد.
                </p>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-center sm:justify-end shrink-0">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 sm:px-8 text-xs sm:text-sm font-bold text-slate-950 shadow-sm transition-all hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-50 cursor-pointer whitespace-nowrap select-none"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{busy ? "در حال ذخیره‌سازی..." : "ذخیره تغییرات نمایه"}</span>
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Card 6: Showcase Gallery (Independent form section) */}
        <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                <ImageIcon className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  گالری و ویترین تصاویر کسب‌وکار
                </h3>
                <p className="text-[11px] text-slate-400">
                  تا ۵ تصویر از محیط، محصولات و نمونه‌کارهای خود را به صورت رایگان اضافه کنید.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-400 self-end sm:self-auto">
              {images.length} از ۵ تصویر
            </span>
          </div>

          {!editing ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
              برای مدیریت گالری تصاویر، ابتدا فرم بالا را یک بار ذخیره کنید تا شناسه کسب‌وکار ایجاد شود.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Upload Dropzone */}
              {images.length < 5 && (
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 p-6 text-center cursor-pointer transition-colors hover:border-cyan-400/60 hover:bg-slate-900/30">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-cyan-400">
                    <UploadCloud className="h-5 w-5" />
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-200">
                    انتخاب یا کشیدن تصاویر به این بخش
                  </span>
                  <span className="mt-1 text-[11px] text-slate-400">
                    فرمت‌های JPG، PNG یا WebP تا سقف ۵ مگابایت
                  </span>
                  <input
                    disabled={busy || galleryLoading || images.length >= 5}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      void gallery(e.target.files);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </label>
              )}

              {/* Gallery Grid */}
              {galleryLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                </div>
              ) : images.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  هنوز هیچ تصویری در گالری ثبت نشده است.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {images.map((image) => {
                    const url = mediaUrl(image.path);
                    const isDeleting = deleteImage === image.id;

                    return (
                      <div
                        key={image.id}
                        className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm"
                      >
                        <div className="relative aspect-square w-full">
                          {url ? (
                            <Image
                              src={url}
                              alt={image.alt || "تصویر گالری"}
                              fill
                              className="object-cover transition-transform group-hover:scale-105"
                              sizes="200px"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-600">
                              بدون تصویر
                            </div>
                          )}
                        </div>

                        {/* Actions overlay */}
                        <div className="p-2 border-t border-slate-800/80 bg-slate-900">
                          {isDeleting ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-rose-300 font-bold text-center">
                                حذف شود؟
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void eraseImage(image.id)}
                                  className="flex-1 rounded bg-rose-600 py-1 text-[10px] font-bold text-white hover:bg-rose-500 cursor-pointer"
                                >
                                  بله
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setDeleteImage(null)}
                                  className="flex-1 rounded bg-slate-800 py-1 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                                >
                                  انصراف
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDeleteImage(image.id)}
                              className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950 py-1 text-[11px] font-medium text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/10 cursor-pointer transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>حذف</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
