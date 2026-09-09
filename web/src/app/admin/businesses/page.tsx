"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import {
  badgeLabel,
  getAdminBusinesses,
  getBusinessAudit,
  mediaUrl,
  moderateBusiness,
  safeHttpUrl,
  statusLabel,
  type AuditEvent,
  type Page,
  type Phase2Business,
} from "@/lib/phase2";
import {
  Building2,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  History,
  ExternalLink,
  MapPin,
  Phone,
  Mail,
  Loader2,
  X,
} from "lucide-react";

export default function BusinessModerationPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState("pending");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<Phase2Business> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Phase2Business | null>(null);
  const [note, setNote] = useState("");
  const [badges, setBadges] = useState<string[]>([]);
  const [decision, setDecision] = useState<"approved" | "rejected" | "suspended">("approved");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [audit, setAudit] = useState<Page<AuditEvent> | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user?.roles.includes("admin")) {
      router.replace("/admin/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.roles.includes("admin")) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        setData(await getAdminBusinesses(status, search, page, controller.signal));
      } catch (e) {
        if (!controller.signal.aborted) setMessage({ text: extractApiError(e), error: true });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [user, status, search, page, revision]);

  useEffect(() => {
    if (!selected?.id) return;
    const controller = new AbortController();
    void (async () => {
      setAuditLoading(true);
      try {
        setAudit(await getBusinessAudit(selected.id, auditPage));
      } catch (e) {
        if (!controller.signal.aborted) setMessage({ text: extractApiError(e), error: true });
      } finally {
        if (!controller.signal.aborted) setAuditLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selected?.id, auditPage, revision]);

  function choose(b: Phase2Business) {
    setSelected(b);
    setNote(b.moderation_note || "");
    setBadges(b.badges || []);
    setDecision("approved");
    setAudit(null);
    setAuditPage(1);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (decision !== "approved" && !note.trim()) {
      setMessage({ text: "برای رد یا تعلیق، دلیل تصمیم را بنویسید.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const b = await moderateBusiness(selected.id, decision, note, badges);
      setSelected({ ...selected, ...b });
      setBadges(b.badges || []);
      setMessage({ text: "تصمیم با موفقیت ثبت و رخداد آن ذخیره شد." });
      setRevision((x) => x + 1);
    } catch (e) {
      setMessage({ text: extractApiError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user?.roles.includes("admin")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090d16] text-slate-300">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#090d16] text-slate-100 selection:bg-cyan-500/20">
      {/* Top Floating Smart Taskbar */}
      <div className="sticky top-2 sm:top-4 z-40 px-3 sm:px-6">
        <header className="mx-auto max-w-7xl flex h-14 sm:h-16 items-center justify-between rounded-2xl border border-slate-800/80 bg-[#0b1120]/85 px-3 sm:px-5 backdrop-blur-2xl shadow-[0_10px_35px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-850/80 px-3 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-800 hover:text-white active:scale-[0.98]"
            >
              <ChevronRight className="h-4 w-4 text-cyan-400" />
              <span>پیشخوان ادمین</span>
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <span>/</span>
              <span className="font-semibold text-white">میزکار بررسی و احراز کسب‌وکارها</span>
            </div>
          </div>

          <Link
            href="/"
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-850/80 px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all active:scale-[0.98]"
          >
            <span>مشاهده سایت</span>
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </Link>
        </header>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-8 py-6 sm:py-8 space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-cyan-400" />
            <span>بررسی و اعتبارسنجی کسب‌وکارها</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            پروفایل، اطلاعات تماس، موقعیت، تصاویر و نشان‌های اعتبار را بررسی و تصمیم نهایی را ثبت کنید.
          </p>
        </div>

        {/* Status Alert */}
        {message && (
          <div
            role="alert"
            className={`flex items-center gap-3 rounded-xl border p-4 text-xs sm:text-sm ${
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
            <span>{message.text}</span>
          </div>
        )}

        {/* Filter Toolbar */}
        <section className="rounded-2xl border border-slate-800 bg-[#0f172a] p-4 sm:p-5 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
              setPage(1);
              setRevision((x) => x + 1);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
          >
            <label className="flex-1 space-y-1">
              <span className="text-xs font-medium text-slate-300">جستجوی نام کسب‌وکار</span>
              <div className="relative">
                <input
                  disabled={busy}
                  value={query}
                  maxLength={120}
                  placeholder="نام برند یا فروشگاه..."
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/70 py-2.5 pl-3 pr-9 text-base sm:text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
                <Search className="absolute right-3 top-3 h-4 w-4 text-slate-500" />
              </div>
            </label>

            <label className="sm:w-56 space-y-1">
              <span className="text-xs font-medium text-slate-300">فیلتر وضعیت</span>
              <select
                disabled={busy}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-base sm:text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                <option value="">همه وضعیت‌ها</option>
                {Object.entries(statusLabel).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="flex min-h-[42px] items-center justify-center rounded-xl bg-cyan-600 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md transition-all hover:bg-cyan-500 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              اعمال فیلتر
            </button>
          </form>
        </section>

        {/* Moderation Review Modal / Slide-over Card */}
        {selected && (
          <section className="rounded-2xl border-2 border-cyan-500/40 bg-[#0f172a] p-4 sm:p-6 shadow-xl relative animate-in fade-in">
            <button
              onClick={() => setSelected(null)}
              className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-slate-400 hover:text-white"
              aria-label="بستن بررسی"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-4">
              <h2 className="text-lg sm:text-xl font-bold text-white">{selected.name}</h2>
              <span className="rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-0.5 text-xs font-bold text-cyan-300">
                {statusLabel[selected.status]}
              </span>
            </div>

            {/* Details Grid */}
            <div className="my-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs sm:text-sm">
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-400">موقعیت:</span>
                <p className="flex items-center gap-1.5 text-slate-200">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span>
                    {[selected.city, selected.neighborhood, selected.address]
                      .filter(Boolean)
                      .join("، ") || "ثبت نشده"}
                  </span>
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="font-semibold text-slate-400">تماس و ارتباط:</span>
                <p className="flex items-center gap-1.5 text-slate-200" dir="ltr">
                  <Phone className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span>{selected.phone || "بدون شماره"}</span>
                </p>
                {selected.email && (
                  <p className="flex items-center gap-1.5 text-slate-200" dir="ltr">
                    <Mail className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                    <span>{selected.email}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="font-semibold text-slate-400">خدمات و دسته‌بندی:</span>
                <p className="text-slate-200">
                  {selected.category || "بدون دسته‌بندی"} •{" "}
                  {(selected.services || []).join("، ") || "بدون خدمات درج‌شده"}
                </p>
              </div>
            </div>

            {selected.description && (
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5 text-xs sm:text-sm text-slate-300 whitespace-pre-wrap">
                {selected.description}
              </div>
            )}

            {/* Social Links */}
            {selected.social_links && Object.keys(selected.social_links).length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">شبکه‌های اجتماعی:</span>
                {Object.entries(selected.social_links).map(([key, raw]) => {
                  const url = safeHttpUrl(raw);
                  return url ? (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-cyan-300 hover:border-cyan-400"
                    >
                      <span>{key}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null;
                })}
              </div>
            )}

            {/* Gallery Images */}
            <div className="mt-5">
              <span className="text-xs font-semibold text-slate-400">تصاویر و مدارک ارسالی:</span>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                {[
                  { id: "logo", path: selected.logo, alt: "لوگو" },
                  { id: "cover", path: selected.cover_image, alt: "کاور" },
                  ...(selected.images || []),
                ].map((img) => {
                  const url = mediaUrl(img.path);
                  if (!url) return null;
                  return (
                    <a
                      key={img.id}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative aspect-square overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
                    >
                      <Image
                        src={url}
                        alt={img.alt || "تصویر کسب‌وکار"}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="160px"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[9px] text-white">
                        {img.alt}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Decision & Badges Form */}
            <form onSubmit={submit} className="mt-6 border-t border-slate-800 pt-5">
              <fieldset disabled={busy} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300">تصمیم مدیریت *</span>
                    <select
                      value={decision}
                      onChange={(e) => setDecision(e.target.value as typeof decision)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    >
                      <option value="approved">تأیید و انتشار عمومی</option>
                      <option value="rejected">رد درخواست ثبت</option>
                      <option value="suspended">تعلیق و توقف نمایش عمومی</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300">
                      دلیل یا توضیح تصمیم {decision !== "approved" && "(الزامی)"}
                    </span>
                    <textarea
                      maxLength={1000}
                      rows={2}
                      required={decision !== "approved"}
                      value={note}
                      placeholder="علت رد یا تایید برای اطلاع مالک..."
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </label>
                </div>

                {/* Badges Checklist */}
                <div>
                  <span className="text-xs font-semibold text-slate-300">
                    نشان‌های اعتبارسنجی (Badges):
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(badgeLabel).map(([key, label]) => {
                      const isChecked = badges.includes(key);
                      return (
                        <label
                          key={key}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium cursor-pointer transition-all ${
                            isChecked
                              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                              : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setBadges((xs) =>
                                e.target.checked ? [...xs, key] : xs.filter((x) => x !== key),
                              )
                            }
                            className="hidden"
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex min-h-[42px] items-center gap-2 rounded-xl bg-gradient-to-l from-cyan-600 to-teal-600 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md transition-all hover:from-cyan-500 hover:to-teal-500 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{busy ? "در حال ثبت..." : "ثبت تصمیم و نشان‌ها"}</span>
                  </button>
                </div>
              </fieldset>
            </form>

            {/* Audit History */}
            <div className="mt-6 border-t border-slate-800 pt-5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                <History className="h-4 w-4 text-cyan-400" />
                <span>تاریخچه رخدادها و بررسی‌های قبلی</span>
              </h3>
              {auditLoading ? (
                <p className="py-4 text-xs text-slate-400">در حال دریافت تاریخچه…</p>
              ) : !audit?.data.length ? (
                <p className="py-4 text-xs text-slate-400">رخدادی ثبت نشده است.</p>
              ) : (
                <ul className="space-y-2">
                  {audit.data.map((evt) => (
                    <li
                      key={evt.id}
                      className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="font-bold text-white">{evt.event}</span>
                        <span className="text-slate-400" dir="ltr">
                          {new Date(evt.created_at).toLocaleString("fa-IR")}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Businesses List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-bold text-white">
              فهرست کسب‌وکارها ({data?.total ?? 0} مورد)
            </h2>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-800 bg-[#0f172a]">
              <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
            </div>
          ) : !data?.data.length ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0f172a] p-8 text-center text-xs sm:text-sm text-slate-400">
              موردی با فیلترهای انتخابی یافت نشد.
            </div>
          ) : (
            <div className="grid gap-3">
              {data.data.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0f172a] p-4 shadow-sm transition-all hover:border-slate-700"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-bold text-white text-sm sm:text-base truncate">
                        {b.name}
                      </h3>
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                          b.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : b.status === "pending"
                              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                              : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {statusLabel[b.status] || b.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {[b.city, b.neighborhood, b.category].filter(Boolean).join(" • ")}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => choose(b)}
                    className="flex min-h-[40px] items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap self-end sm:self-auto"
                  >
                    بررسی و تغییر وضعیت
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {data && data.last_page > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <button
                disabled={busy || page <= 1}
                onClick={() => setPage((x) => x - 1)}
                className="flex min-h-[38px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                صفحه قبل
              </button>
              <span className="text-xs text-slate-400">
                صفحه {page} از {data.last_page}
              </span>
              <button
                disabled={busy || page >= data.last_page}
                onClick={() => setPage((x) => x + 1)}
                className="flex min-h-[38px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                صفحه بعد
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
