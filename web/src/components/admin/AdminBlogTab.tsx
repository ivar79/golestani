"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import {
  getAdminArticles,
  saveAdminArticle,
  deleteAdminArticle,
  type Article,
} from "@/lib/admin";
import { PenSquare, Plus, Trash2, Check, AlertCircle, FileText, ChevronDown } from "lucide-react";

const EMPTY_DRAFT: Article = {
  slug: "",
  title: "",
  content: "",
  status: "draft",
};

/** Blog management: create / edit / publish articles with SEO fields. */
export default function AdminBlogTab() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [draft, setDraft] = useState<Article>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [coverFile, setCoverFile] = useState<File | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    try {
      const res = await getAdminArticles();
      setArticles(res.data ?? []);
      setError(null);
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function startEdit(article: Article) {
    setEditingId(article.id ?? null);
    setDraft({ ...article });
    setCoverFile(undefined);
    setSaved(false);
    // Scroll to top on mobile for convenience
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCoverFile(undefined);
    setSaved(false);
  }

  async function submit() {
    if (!draft.title || !draft.content) return;
    setSubmitting(true);
    setError(null);
    try {
      await saveAdminArticle(
        {
          slug: draft.slug,
          title: draft.title,
          content: draft.content,
          status: draft.status,
          seo_title: draft.seo_title ?? null,
          seo_description: draft.seo_description ?? null,
          og_title: draft.og_title ?? null,
          og_description: draft.og_description ?? null,
        },
        coverFile,
        editingId ?? undefined,
      );
      setSaved(true);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      setCoverFile(undefined);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(article: Article) {
    if (!article.id || !window.confirm(`حذف مقاله «${article.title}»؟`)) return;
    try {
      await deleteAdminArticle(article.id);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    }
  }

  return (
    <div className="space-y-6 text-right">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white">وبلاگ و مقالات</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            ایجاد، ویرایش و مدیریت انتشار مقالات و بهینه‌سازی سئو (SEO)
          </p>
        </div>
        {editingId && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>ایجاد مقاله جدید</span>
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs sm:text-sm text-rose-300"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs sm:text-sm text-emerald-300"
        >
          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>مقاله با موفقیت ذخیره شد.</span>
        </div>
      )}

      {/* Editor Form Card */}
      <section className="rounded-xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
          <PenSquare className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm sm:text-base font-bold text-white">
            {editingId ? "ویرایش مقاله انتخابی" : "ایجاد مقاله جدید"}
          </h3>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-300">عنوان مقاله *</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="عنوان جذاب برای مقاله..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-300">
                اسلاگ پیوند (اختیاری، خالی = خودکار)
              </span>
              <input
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 font-mono text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                placeholder="slug-name"
                dir="ltr"
              />
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-slate-300">محتوای مقاله * (متن یا مارک‌داون)</span>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              rows={8}
              placeholder="متن کامل مقاله..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-300">وضعیت انتشار</span>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, status: e.target.value as Article["status"] }))
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
              >
                <option value="draft">پیش‌نویس (عدم نمایش عمومی)</option>
                <option value="published">منتشر شده (نمایش در سایت)</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-300">
                تصویر کاور (JPG, PNG, WebP حداکثر ۵ مگابایت)
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setCoverFile(e.target.files?.[0])}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-800 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-cyan-300 hover:file:bg-slate-700"
              />
            </label>
          </div>

          <details className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
            <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300 select-none">
              <ChevronDown className="h-4 w-4 text-slate-500" />
              <span>تنظیمات پیشرفته سئو (SEO & OpenGraph)</span>
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-400">SEO عنوان صفحه</span>
                <input
                  value={draft.seo_title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, seo_title: e.target.value }))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-400">SEO توضیحات متا</span>
                <textarea
                  value={draft.seo_description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, seo_description: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-400">OG عنوان اشتراک‌گذاری</span>
                <input
                  value={draft.og_title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, og_title: e.target.value }))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-400">OG توضیحات شبکه‌های اجتماعی</span>
                <textarea
                  value={draft.og_description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, og_description: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100"
                />
              </label>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!draft.title || !draft.content || submitting}
              className="flex min-h-[42px] items-center justify-center rounded-xl bg-gradient-to-l from-cyan-600 to-teal-600 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md transition-all hover:from-cyan-500 hover:to-teal-500 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {submitting ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات مقاله" : "انتشار / ذخیره مقاله"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startCreate}
                className="flex min-h-[42px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-850 whitespace-nowrap cursor-pointer"
              >
                انصراف از ویرایش
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Article List Card */}
      <section className="rounded-xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm sm:text-base font-bold text-white">فهرست مقالات منتشرشده</h3>
          </div>
          <span className="text-xs text-slate-400">{articles.length} مقاله</span>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-slate-400">در حال دریافت مقالات…</p>
        ) : articles.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">هنوز مقاله‌ای ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {articles.map((article) => (
              <li
                key={article.id ?? article.slug}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white text-sm">{article.title}</span>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                        article.status === "published"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700/50"
                      }`}
                    >
                      {article.status === "published" ? "منتشر شده" : "پیش‌نویس"}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-400" dir="ltr">
                    /{article.slug}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => startEdit(article)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 active:scale-95 whitespace-nowrap cursor-pointer"
                  >
                    <PenSquare className="h-3 w-3" />
                    <span>ویرایش</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(article)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-95 whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>حذف</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
