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

const STATUS_STYLE: Record<BusinessStatus, { label: string; cls: string }> = {
  draft: { label: "پیش‌نویس", cls: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  pending: { label: "در انتظار بررسی", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "تأییدشده", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "ردشده", cls: "bg-red-50 text-red-700 border-red-200" },
  suspended: { label: "معلق", cls: "bg-red-50 text-red-700 border-red-200" },
};

function StatusBadge({ status }: { status: BusinessStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

type Feedback = { kind: "success" | "error"; text: string } | null;

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const cls =
    feedback.kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-red-200 bg-red-50 text-red-600";
  return (
    <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {feedback.text}
    </p>
  );
}

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "",
  phone: "",
  address: "",
  city: "",
  services: "",
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

  useEffect(() => {
    if (!user) return;
    listBusinesses()
      .then(setItems)
      .catch((err) => setFeedback({ kind: "error", text: extractApiError(err) }))
      .finally(() => setLoading(false));
  }, [user]);

  const set = (key: keyof typeof EMPTY_FORM) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: event.target.value }));

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
    };

    try {
      const saved = editing
        ? await updateBusiness(editing.id, payload)
        : await createBusiness(payload);

      setItems((prev) =>
        editing ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev],
      );
      setEditing(null);
      setForm(EMPTY_FORM);
      setFeedback({
        kind: "success",
        text: editing
          ? "پروفایل به‌روزرسانی شد و برای بررسی ارسال شد."
          : "پروفایل ذخیره شد و برای بررسی ارسال شد.",
      });
    } catch (err) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("این پروفایل حذف شود؟")) return;
    try {
      await deleteBusiness(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      setFeedback({ kind: "success", text: "پروفایل حذف شد." });
    } catch (err) {
      setFeedback({ kind: "error", text: extractApiError(err) });
    }
  }

  function startEdit(b: Business) {
    setEditing(b);
    setForm({
      name: b.name,
      description: b.description ?? "",
      category: b.category ?? "",
      phone: b.phone ?? "",
      address: b.address ?? "",
      city: b.city ?? "",
      services: (b.services ?? []).join(", "),
    });
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const inputCls =
    "w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-navy-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

  if (authLoading || !user) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-24 text-center text-zinc-500">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-navy-200 border-t-emerald-600" />
        در حال بارگذاری…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      {/* Header: brand mark + user info + logout */}
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-navy-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-800 text-xl font-black text-white shadow-lg shadow-navy-800/25">
            اَ
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              پنل صاحب کسب‌وکار
            </p>
            <h1 className="text-2xl font-black text-navy-900">اینکارت</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-left">
            <p className="text-sm font-semibold text-navy-900" dir="ltr">
              {user.phone}
            </p>
            <p className="text-xs text-zinc-500">
              {user.roles.join(" · ") || "کاربر"}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-full border border-navy-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition hover:border-red-300 hover:text-red-600"
          >
            خروج
          </button>
        </div>
      </header>

      <FeedbackBanner feedback={feedback} />

      {/* Business profile form */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 grid gap-4 rounded-3xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy-900">
            {editing ? "ویرایش پروفایل" : "پروفایل کسب‌وکار جدید"}
          </h2>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-sm font-medium text-zinc-500 hover:text-navy-800"
            >
              انصراف
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-navy-900">نام کسب‌وکار *</span>
            <input
              required
              value={form.name}
              onChange={set("name")}
              placeholder="مثال: رستوران نمونه"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-navy-900">توضیحات</span>
            <textarea
              value={form.description}
              onChange={set("description")}
              placeholder="کسب‌وکار خود را معرفی کنید…"
              className={`${inputCls} min-h-28`}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-navy-900">دسته‌بندی</span>
            <input
              value={form.category}
              onChange={set("category")}
              placeholder="مثال: رستوران"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-navy-900">تلفن</span>
            <input
              type="tel"
              dir="ltr"
              value={form.phone}
              onChange={set("phone")}
              placeholder="021-12345678"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-navy-900">شهر</span>
            <input
              value={form.city}
              onChange={set("city")}
              placeholder="مثال: تهران"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-navy-900">خدمات</span>
            <input
              value={form.services}
              onChange={set("services")}
              placeholder="با کاما جدا کنید: کatering، ارسال"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-navy-900">آدرس</span>
            <input
              value={form.address}
              onChange={set("address")}
              placeholder="آدرس کامل کسب‌وکار"
              className={inputCls}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-[0_10px_25px_-10px_rgba(5,150,105,0.55)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? "در حال ذخیره…"
            : editing
              ? "به‌روزرسانی پروفایل"
              : "ایجاد پروفایل"}
        </button>
      </form>

      {/* Business list */}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold text-navy-900">پروفایل‌های من</h2>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-2xl border border-navy-100 bg-white"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-navy-200 bg-white/60 px-6 py-16 text-center">
            <p className="text-4xl">🏪</p>
            <p className="mt-4 font-semibold text-navy-900">هنوز پروفایلی ندارید</p>
            <p className="mt-2 text-sm text-zinc-500">
              اولین پروفایل خود را با فرم بالا بسازید.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((b) => (
              <article
                key={b.id}
                className="flex flex-col rounded-2xl border border-navy-100 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-navy-900">{b.name}</h3>
                  <StatusBadge status={b.status} />
                </div>
                {b.category && (
                  <p className="mt-1 text-xs font-medium text-emerald-600">
                    {b.category}
                  </p>
                )}
                {b.description && (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-600">
                    {b.description}
                  </p>
                )}
                {(b.city || b.phone) && (
                  <p className="mt-3 text-xs text-zinc-500">
                    {b.city && <span>📍 {b.city}</span>}
                    {b.city && b.phone && <span className="mx-2">·</span>}
                    {b.phone && (
                      <span dir="ltr" className="font-medium">
                        {b.phone}
                      </span>
                    )}
                  </p>
                )}
                {b.services && b.services.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {b.services.slice(0, 4).map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs text-navy-700"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {b.status === "rejected" && b.moderation_note && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    یادداشت بررسی: {b.moderation_note}
                  </p>
                )}
                <div className="mt-4 flex gap-4 border-t border-navy-50 pt-3 text-sm">
                  <button
                    onClick={() => startEdit(b)}
                    className="font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    ویرایش
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="font-medium text-zinc-400 hover:text-red-600"
                  >
                    حذف
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
