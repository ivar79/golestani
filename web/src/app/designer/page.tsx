"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Share2, Users, UploadCloud, Sparkles, CheckCircle2, AlertCircle, Trash2, X, Building2, ArrowUpRight, LayoutDashboard, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api, { extractApiError } from "@/lib/api";
import { listBusinesses, type Business } from "@/lib/businesses";
import AppTaskbar from "@/components/layout/AppTaskbar";
import { SITE_URL } from "@/lib/siteUrl";

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
  attributed_businesses_count?: number;
  bio?: string;
  status: string;
  portfolios?: Portfolio[];
};

type StudioWorkspace = {
  business: Business;
  allowed: boolean | null;
  reason?: string;
  error?: string;
};

type StudioCardResponse = {
  studio?: {
    allowed?: boolean;
    reason?: string;
  };
};

type DesignerProgramStatus = "none" | "pending" | "approved" | "rejected" | "suspended";

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
  const [programStatus, setProgramStatus] = useState<DesignerProgramStatus | null>(null);
  const [programEnabled, setProgramEnabled] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [requestingProgram, setRequestingProgram] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const MAX_PORTFOLIO_BYTES = 10 * 1024 * 1024; // matches backend max:10240
  const ALLOWED_PORTFOLIO_TYPES = ["image/jpeg", "image/png", "application/pdf"];

  // Depend on the user ID (stable), not the user object (replaced on every
  // refreshUser()) — otherwise the profile/workspace loads re-run and flicker.
  const userId = user?.id;
  useEffect(() => {
    if (authLoading || !userId) return;
    let active = true;
    void api.get<{ designer_status: DesignerProgramStatus; program_enabled: boolean }>("/designer/program/status")
      .then(async ({ data: status }) => {
        if (!active) return;
        setProgramStatus(status.designer_status);
        setProgramEnabled(status.program_enabled);
        if (status.designer_status !== "approved") {
          setLoadingProfile(false);
          return;
        }
        try {
          const { data } = await api.get<Designer>("/designer/profile");
          if (!active) return;
          setDesigner(data);
          setName(data.display_name);
          setBio(data.bio || "");
        } catch (error) {
          if (active) setProfileError(extractApiError(error));
        } finally {
          if (active) setLoadingProfile(false);
        }
      })
      .catch((error) => {
        if (active) {
          setProfileError(extractApiError(error));
          setLoadingProfile(false);
        }
      })
      .finally(() => {
        if (active) setLoadingStatus(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, userId]);

  useEffect(() => {
    if (authLoading || !userId) return;
    if (programStatus !== "approved") {
      const timer = window.setTimeout(() => setLoadingWorkspaces(false), 0);
      return () => window.clearTimeout(timer);
    }
    let active = true;

    listBusinesses()
      .then(async (businesses) => {
        const rows = await Promise.all(
          businesses.map(async (business): Promise<StudioWorkspace> => {
            try {
              const { data } = await api.get<StudioCardResponse>(`/businesses/${business.id}/card`);
              return {
                business,
                allowed: data.studio?.allowed === true,
                reason: data.studio?.reason,
              };
            } catch (error) {
              return {
                business,
                allowed: null,
                error: extractApiError(error),
              };
            }
          }),
        );
        if (active) setWorkspaces(rows);
      })
      .catch((error) => {
        if (active) setWorkspaceError(extractApiError(error));
      })
      .finally(() => {
        if (active) setLoadingWorkspaces(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, userId, programStatus]);

  async function requestDesignerProgram() {
    setRequestingProgram(true);
    setMessage(null);
    try {
      const { data } = await api.post<{ designer_status: DesignerProgramStatus }>("/designer/program/request");
      setProgramStatus(data.designer_status);
      setMessage({ text: "درخواست عضویت ثبت شد و برای بررسی ارسال شد." });
    } catch (error) {
      setMessage({ text: extractApiError(error), error: true });
    } finally {
      setRequestingProgram(false);
    }
  }

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

  const referralCode = designer?.referral_code || "";
  const referralLink = `${SITE_URL}/dashboard?ref=${referralCode}`;

  function copyReferralLink() {
    void navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch((error: unknown) => {
      setMessage({ text: extractApiError(error), error: true });
    });
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

  if (loadingStatus) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8">
            <div className="h-6 w-40 rounded bg-white/10" />
            <div className="mt-4 h-4 w-3/4 rounded bg-white/10" />
            <div className="mt-8 h-32 rounded-2xl bg-white/5" />
          </div>
        </div>
      </main>
    );
  }

  if (profileError || programStatus !== "approved") {
    const pending = programStatus === "pending";
    const rejected = programStatus === "rejected";
    const suspended = programStatus === "suspended";
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="rounded-md border border-secondary/20 bg-secondary/10 px-2.5 py-1 text-xs font-bold text-secondary">پنل طراح</span>
              <h1 className="mt-3 text-2xl font-black">وضعیت حساب طراح</h1>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <LayoutDashboard className="h-4 w-4" />
              ورود به داشبورد
            </Link>
          </div>

          {profileError ? (
            <section className="mt-6 rounded-3xl border border-red-500/25 bg-red-500/[0.06] p-6">
              <AlertCircle className="h-6 w-6 text-red-300" />
              <h2 className="mt-3 text-lg font-bold">دریافت اطلاعات پنل ناموفق بود</h2>
              <p className="mt-2 text-sm leading-6 text-red-100/80">{profileError}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-300/25 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10"
              >
                <RefreshCw className="h-4 w-4" />
                تلاش دوباره
              </button>
            </section>
          ) : (
            <section className="mt-6 rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 sm:p-8">
              <span className={`inline-flex rounded-lg border px-3 py-1.5 text-xs font-bold ${
                pending
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                  : rejected || suspended
                    ? "border-red-400/30 bg-red-400/10 text-red-200"
                    : "border-white/15 bg-white/5 text-slate-300"
              }`}>
                {pending ? "در انتظار بررسی" : rejected ? "درخواست رد شده" : suspended ? "حساب تعلیق شده" : "هنوز عضو برنامه طراحان نیستید"}
              </span>
              <h2 className="mt-4 text-xl font-bold">
                {pending
                  ? "درخواست شما برای عضویت در حال بررسی است"
                  : rejected
                    ? "درخواست عضویت تأیید نشده است"
                    : suspended
                      ? "دسترسی حساب طراح موقتاً غیرفعال است"
                      : "برای دسترسی به امکانات طراح، درخواست عضویت ثبت کنید"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                {pending
                  ? "پس از بررسی مدیر، نتیجه در همین صفحه نمایش داده می‌شود. در این مدت ابزارهای اختصاصی طراح در دسترس نیست."
                  : rejected || suspended
                    ? "برای پیگیری نتیجه یا اطلاع از دلیل، با پشتیبانی سامانه تماس بگیرید."
                    : "درخواست شما پس از بررسی مدیر می‌تواند تأیید شود. تأیید طراح به‌تنهایی جای مجوز و اشتراک هر کسب‌وکار را نمی‌گیرد."}
              </p>
              {!pending && !suspended && (
                <button
                  type="button"
                  onClick={() => void requestDesignerProgram()}
                  disabled={!programEnabled || requestingProgram}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-secondary px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {requestingProgram && <RefreshCw className="h-4 w-4 animate-spin" />}
                  {programEnabled ? (requestingProgram ? "در حال ارسال…" : "ثبت درخواست عضویت") : "ثبت درخواست فعلاً غیرفعال است"}
                </button>
              )}
              {message && (
                <p className={`mt-4 text-sm ${message.error ? "text-red-300" : "text-emerald-300"}`} role="status">
                  {message.text}
                </p>
              )}
            </section>
          )}
        </div>
      </main>
    );
  }

  if (loadingProfile) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 text-white">
        <AppTaskbar />
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0c1626]/80 p-5">
            <span className="text-sm text-slate-300" role="status">در حال بارگذاری پنل طراح…</span>
            <Link href="/dashboard" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">
              <LayoutDashboard className="h-4 w-4" /> داشبورد
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#050B14] pb-20 pt-28 sm:pt-32 text-white">
      <AppTaskbar />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="rounded-md bg-secondary/15 px-2.5 py-1 text-xs font-bold text-secondary border border-secondary/20">
              پنل طراح
            </span>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black text-white">مدیریت حساب طراح</h1>
            <p className="mt-1 text-sm text-slate-400">
              وضعیت استودیو، معرفی کسب‌وکارها و نمونه‌کارهای خود را مدیریت کنید.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/10"
          >
            <LayoutDashboard className="h-4 w-4" />
            ورود به داشبورد
          </Link>
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

        <section className="mt-8 rounded-3xl border border-white/10 bg-[#0c1626]/80 p-6 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/15 text-secondary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">استودیوی طراحی بر اساس کسب‌وکار</h2>
              <p className="mt-1 text-xs leading-6 text-slate-400">
                دسترسی برای هر کسب‌وکار جداگانه بررسی می‌شود؛ تأیید طراح به‌تنهایی جای مالکیت کسب‌وکار یا قابلیت Studio آن را نمی‌گیرد.
              </p>
            </div>
          </div>

          {loadingWorkspaces ? (
            <p className="mt-5 text-sm text-slate-400">            در حال بررسی کسب‌وکارها و دسترسی استودیو…</p>
          ) : workspaceError ? (
            <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
              دریافت فهرست کسب‌وکارها ناموفق بود: {workspaceError}
            </div>
          ) : workspaces.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-300">هنوز کسب‌وکاری در این حساب ثبت نشده است.</p>
              <Link href="/dashboard" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-slate-950 hover:bg-secondary-hover">
                ثبت کسب‌وکار <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="mt-5 grid gap-3">
              {workspaces.map(({ business, allowed, reason, error }) => (
                <div key={business.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{business.name}</h3>
                    {error ? (
                      <p className="mt-1 text-xs text-amber-300">بررسی مجوز ناموفق بود: {error}</p>
                    ) : allowed ? (
                      <p className="mt-1 text-xs text-emerald-300">این کسب‌وکار مجاز به استفاده از Studio است.</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400">
                        {reason === "no_capability"
                          ? "امکان استفاده از استودیوی طراحی در اشتراک این کسب‌وکار فعال نیست."
                          : reason === "not_approved"
                            ? "حساب طراح هنوز تأیید نشده است."
                            : "دسترسی Studio برای این کسب‌وکار تأیید نشد."}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/card-maker?business_id=${business.id}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-secondary/30 px-4 py-2 text-sm font-bold text-secondary transition hover:bg-secondary/10"
                  >
                    مدیریت کارت <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

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
