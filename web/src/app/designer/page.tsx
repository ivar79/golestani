"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Share2, Users, UploadCloud, Sparkles, CheckCircle2, AlertCircle, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api, { extractApiError } from "@/lib/api";
import AppTaskbar from "@/components/layout/AppTaskbar";

type Portfolio = {
  id: number;
  title: string;
  description?: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  file_path: string;
  mime_type?: string;
  moderation_note?: string | null;
  created_at?: string;
};

type Designer = {
  display_name: string;
  slug: string;
  referral_code?: string;
  referral_link?: string;
  attributed_businesses_count?: number;
  bio?: string;
  status: string;
  portfolios?: Portfolio[];
};

export default function DesignerPage() {
  const { user, loading: authLoading } = useAuth();
  const [designer, setDesigner] = useState<Designer | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Portfolio | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const MAX_PORTFOLIO_BYTES = 10 * 1024 * 1024; // matches backend max:10240
  const ALLOWED_PORTFOLIO_TYPES = ["image/jpeg", "image/png", "application/pdf"];

  useEffect(() => {
    if (!authLoading && user) {
      // Deferred flag-set (project pattern): setState leaves the effect body
      // (react-hooks/set-state-in-effect) while behavior stays unchanged.
      const t = window.setTimeout(() => setLoadingProfile(true), 0);
      api
        .get<Designer>("/designer/profile")
        .then(({ data }) => {
          setDesigner(data);
          setName(data.display_name);
          setBio(data.bio || "");
        })
        .catch((err) => {
          setMessage({ text: extractApiError(err), error: true });
        })
        .finally(() => {
          window.clearTimeout(t);
          setLoadingProfile(false);
        });
    }
  }, [authLoading, user]);

  function handlePortfolioFile(file: File | null) {
    setFileError(null);
    if (!file) {
      setFile(null);
      return;
    }
    if (!ALLOWED_PORTFOLIO_TYPES.includes(file.type)) {
      setFileError("فرمت مجاز نیست — فقط JPEG، PNG یا PDF.");
      setFile(null);
      return;
    }
    if (file.size > MAX_PORTFOLIO_BYTES) {
      setFileError("حجم فایل بیشتر از سقف ۱۰ مگابایت است.");
      setFile(null);
      return;
    }
    setFile(file);
  }

  async function deletePortfolio() {
    if (!deleteCandidate) return;
    setDeleting(true);
    setMessage(null);
    try {
      await api.delete(`/designer/portfolios/${deleteCandidate.id}`);
      setDesigner((old) =>
        old ? { ...old, portfolios: (old.portfolios || []).filter((p) => p.id !== deleteCandidate.id) } : old
      );
      setDeleteCandidate(null);
      setMessage({ text: "نمونه‌کار حذف شد." });
    } catch (err) {
      setMessage({ text: extractApiError(err), error: true });
    } finally {
      setDeleting(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setMessage(null);
    try {
      const { data } = await api.put<Designer>("/designer/profile", { display_name: name, bio });
      setDesigner((old) => (old ? { ...old, ...data } : data));
      setMessage({ text: "پروفایل طراح با موفقیت ذخیره شد." });
    } catch (err) {
      setMessage({ text: extractApiError(err), error: true });
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadPortfolio(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("title", title);
      if (description) form.append("description", description);
      form.append("file", file);

      const { data } = await api.post<Portfolio>("/designer/portfolios", form);
      setDesigner((old) => (old ? { ...old, portfolios: [data, ...(old.portfolios || [])] } : old));
      setTitle("");
      setDescription("");
      setFile(null);
      setMessage({ text: "نمونه‌کار جدید ثبت و جهت تایید به صف مدیریت ارسال شد." });
    } catch (err) {
      setMessage({ text: extractApiError(err), error: true });
    } finally {
      setUploading(false);
    }
  }

  const referralCode = designer?.referral_code || "········";
  const referralLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/dashboard?ref=${referralCode}`
      : designer?.referral_link || `https://inkart.ir/dashboard?ref=${referralCode}`;

  function copyReferralLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (authLoading) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] flex items-center justify-center text-slate-400">
        در حال بارگذاری اطلاعات طراح…
      </main>
    );
  }

  if (!user) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pt-28 px-4 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8 text-center backdrop-blur-xl">
          <Sparkles className="mx-auto h-12 w-12 text-secondary opacity-80" />
          <h2 className="mt-4 text-xl font-bold">ورود به پنل طراحان</h2>
          <p className="mt-2 text-sm text-slate-400">برای مشاهده پروفایل طراح، ثبت نمونه‌کار و دریافت کد معرفی، لطفاً وارد شوید.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-cyan-500 px-6 py-3 font-bold text-slate-950 transition hover:bg-cyan-400">
            ورود به سیستم
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 sm:pt-32 text-white">
      <AppTaskbar />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-white/10 pb-6">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-secondary/15 px-2.5 py-1 text-xs font-bold text-secondary border border-secondary/20">
              فاز ۴ — اکوسیستم طراحان
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">پروفایل و پنل طراح اختصاصی</h1>
          <p className="text-sm text-slate-400">
            با کد و لینک اختصاصی خود کسب‌وکارها را معرفی کنید و نمونه‌کارهای گرافیکی و چاپی خود را به نمایش بگذارید.
          </p>
        </div>

        {/* Feedback Alert */}
        {message && (
          <div
            className={`mt-4 flex items-center gap-3 rounded-2xl p-4 text-sm ${
              message.error
                ? "border border-red-500/30 bg-red-500/10 text-red-300"
                : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {message.error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Top Referral & Stats Cards */}
        <div className="mt-8 grid gap-6 md:grid-cols-[1.5fr_1fr]">
          {/* Referral Code Box */}
          <div className="rounded-3xl border border-secondary/30 bg-gradient-to-br from-secondary/10 via-[#0c1626] to-[#0c1626] p-6 backdrop-blur-xl shadow-xl shadow-secondary/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/20 text-secondary border border-secondary/30">
                  <Share2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">کد و لینک معرفی طراح</h3>
                  <p className="text-xs text-slate-400">کسب‌وکارهایی که با این کد یا لینک ثبت شوند، به شما منتسب خواهند شد.</p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[auto_1fr]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
                <span className="block text-[11px] text-slate-400">کد معرف شما:</span>
                {loadingProfile ? (
                  <span className="mt-1 block h-7 w-28 animate-pulse rounded bg-white/10 mx-auto" />
                ) : (
                  <span className="mt-1 block font-mono text-xl font-black text-secondary tracking-widest" dir="ltr">
                    {referralCode}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 sm:p-3">
                <input
                  readOnly
                  value={referralLink}
                  dir="ltr"
                  className="w-full bg-transparent text-xs text-slate-300 outline-none font-mono truncate"
                />
                <button
                  type="button"
                  onClick={copyReferralLink}
                  className="flex items-center gap-1.5 shrink-0 rounded-xl bg-secondary px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-secondary-hover"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span>{copied ? "کپی شد" : "کپی لینک"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Stats Box */}
          <div className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl flex flex-col justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">کسب‌وکارهای منتسب</h4>
                <p className="text-xs text-slate-400">معرفی‌شده از طریق کد شما</p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-white/10 flex items-baseline gap-2">
              {loadingProfile ? (
                <span className="h-10 w-14 animate-pulse rounded bg-white/10" />
              ) : (
                <span className="text-4xl font-black text-white">
                  {(designer?.attributed_businesses_count ?? 0).toLocaleString("fa-IR")}
                </span>
              )}
              <span className="text-xs text-slate-400">کسب‌وکار ثبت‌شده در سامانه</span>
            </div>
          </div>
        </div>

        {/* Main 2-Column: Profile Edit & Portfolio Upload */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.3fr]">
          {/* Profile Form */}
          <form onSubmit={saveProfile} className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl space-y-4 h-fit">
            <h3 className="text-base font-bold text-white border-b border-white/10 pb-3">ویرایش پروفایل عمومی طراح</h3>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">نام نمایشی یا استودیو</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً: استودیو طراحی آوا"
                required
                className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">درباره شما و زمینه کاری</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder="توضیح تخصص، سبک‌های طراحی، کارت ویزیت، هویت بصری..."
                className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-cyan-400"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full rounded-xl bg-cyan-500 py-3 font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {savingProfile ? "در حال ذخیره‌سازی…" : "ذخیره تغییرات پروفایل"}
            </button>
          </form>

          {/* Portfolio Upload & List */}
          <div className="space-y-6">
            <form onSubmit={uploadPortfolio} className="rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl space-y-4">
              <h3 className="text-base font-bold text-white border-b border-white/10 pb-3">افزودن نمونه‌کار جدید</h3>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">عنوان نمونه‌کار</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثلاً: کارت ویزیت طلاکوب رستوران نارنج"
                  required
                  className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">توضیح کوتاه (اختیاری)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="جنس کاغذ، رنگ‌بندی، ویژگی‌های خاص..."
                  className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">فایل نمونه‌کار (عکس یا PDF)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(e) => handlePortfolioFile(e.target.files?.[0] || null)}
                  required
                  className="w-full text-xs text-slate-400 file:mr-0 file:ml-3 file:rounded-xl file:border file:border-white/15 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15 file:cursor-pointer"
                />
                {fileError && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {fileError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={uploading || !file || Boolean(fileError)}
                className="w-full rounded-xl border border-secondary/40 bg-secondary/15 py-3 font-bold text-secondary hover:bg-secondary/25 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{uploading ? "در حال آپلود…" : "ارسال نمونه‌کار جهت تایید مدیریت"}</span>
              </button>
            </form>

            {/* Portfolios List */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-300">نمونه‌کارهای ثبت‌شده شما:</h4>

              {(!designer?.portfolios || designer.portfolios.length === 0) && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-slate-500">
                  هنوز نمونه‌کاری ثبت نکرده‌اید. با بارگذاری اولین طرح، ویترین حرفه‌ای خود را بسازید.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {designer?.portfolios?.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-[#0c1626]/60 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h5 className="text-sm font-bold text-white truncate">{item.title}</h5>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                          item.status === "approved"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : item.status === "rejected"
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {item.status === "approved"
                          ? "تأییدشده"
                          : item.status === "rejected"
                          ? "ردشده"
                          : "در انتظار بررسی"}
                      </span>
                    </div>

                    {item.description && <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>}

                    {item.moderation_note && (
                      <p className="text-[11px] text-amber-200/90 bg-amber-500/10 p-2 rounded-lg">
                        پیام مدیر: {item.moderation_note}
                      </p>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setDeleteCandidate(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/20 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio delete confirmation */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c1626] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-bold text-white">حذف نمونه‌کار؟</h3>
              <button type="button" onClick={() => setDeleteCandidate(null)} className="text-slate-400 hover:text-white" aria-label="بستن">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              «{deleteCandidate.title}» برای همیشه حذف می‌شود. این عملیات بازگشت‌پذیر نیست.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void deletePortfolio()}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50"
              >
                {deleting ? "در حال حذف…" : "بله، حذف کن"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
