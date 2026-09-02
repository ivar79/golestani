"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import {
  getAdminArticles,
  saveAdminArticle,
  deleteAdminArticle,
  type Article,
} from "@/lib/admin";

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
  }

  function startCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCoverFile(undefined);
    setSaved(false);
  }

  async function submit() {
    try {
      await saveAdminArticle(
        { slug: draft.slug, title: draft.title, content: draft.content, status: draft.status,
          seo_title: draft.seo_title ?? null, seo_description: draft.seo_description ?? null,
          og_title: draft.og_title ?? null, og_description: draft.og_description ?? null },
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
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {saved && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">مقاله ذخیره شد.</p>
      )}

      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-bold text-navy-900">
          {editingId ? "ویرایش مقاله" : "مقاله جدید"}
        </h3>
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">عنوان *</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="rounded-xl border p-3"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">اسلاگ (اختیاری، خالی = از عنوان)</span>
              <input
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                className="rounded-xl border p-3 font-mono text-sm"
                placeholder="my-article"
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">محتوا *</span>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              className="min-h-56 rounded-xl border p-3 font-mono text-sm"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">وضعیت انتشار</span>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Article["status"] }))}
                className="rounded-xl border p-3"
              >
                <option value="draft">پیش‌نویس</option>
                <option value="published">منتشر شده</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">تصویر کاور (jpg/png/webp ≤5MB)</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setCoverFile(e.target.files?.[0])}
                className="rounded-xl border p-2 text-sm"
              />
            </label>
          </div>
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">SEO / OpenGraph</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">SEO عنوان</span>
                <input
                  value={draft.seo_title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, seo_title: e.target.value }))}
                  className="rounded-xl border p-3"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">SEO توضیحات</span>
                <textarea
                  value={draft.seo_description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, seo_description: e.target.value }))}
                  className="min-h-20 rounded-xl border p-3"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">OG عنوان</span>
                <input
                  value={draft.og_title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, og_title: e.target.value }))}
                  className="rounded-xl border p-3"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">OG توضیحات</span>
                <textarea
                  value={draft.og_description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, og_description: e.target.value }))}
                  className="min-h-20 rounded-xl border p-3"
                />
              </label>
            </div>
          </details>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => void submit()}
            disabled={!draft.title || !draft.content}
            className="btn btn-primary"
          >
            {editingId ? "ذخیره تغییرات" : "ایجاد مقاله"}
          </button>
          {editingId && (
            <button onClick={startCreate} className="btn btn-outline">
              انصراف
            </button>
          )}
        </div>
      </section>

      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-bold text-navy-900">مقالات</h3>
        {loading ? (
          <p className="text-sm text-zinc-500">در حال بارگذاری…</p>
        ) : articles.length === 0 ? (
          <p className="text-sm text-zinc-500">مقاله‌ای وجود ندارد.</p>
        ) : (
          <ul className="grid gap-2">
            {articles.map((article) => (
              <li
                key={article.id ?? article.slug}
                className="flex items-center justify-between gap-4 rounded-xl bg-navy-50 p-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{article.title}</span>
                  <span className="ms-2 font-mono text-xs text-zinc-500">{article.slug}</span>
                  <span
                    className={`ms-2 rounded-full px-2 py-0.5 text-xs ${
                      article.status === "published"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {article.status === "published" ? "منتشر شده" : "پیش‌نویس"}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(article)} className="text-emerald-700">ویرایش</button>
                  <button onClick={() => void remove(article)} className="text-red-600">حذف</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
