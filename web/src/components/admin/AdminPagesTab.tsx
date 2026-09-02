"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import {
  getAdminPages,
  saveAdminPage,
  type PageContent,
} from "@/lib/admin";

/** Editable static pages (قوانین / درباره ما / تماس با ما …) keyed by slug. */
export default function AdminPagesTab() {
  const [pages, setPages] = useState<PageContent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<PageContent>>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const rows = await getAdminPages();
      setPages(rows);
      setDrafts(Object.fromEntries(rows.map((p) => [p.slug, { ...p }])));
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

  async function save(slug: string) {
    try {
      await saveAdminPage(slug, drafts[slug] ?? {});
      setSavedSlug(slug);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    }
  }

  function updateDraft(slug: string, patch: Partial<PageContent>) {
    setDrafts((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  if (loading) return <p className="p-4 text-sm text-zinc-500">در حال بارگذاری…</p>;

  return (
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {pages.length === 0 && (
        <p className="text-sm text-zinc-500">هیچ صفحه‌ای تعریف نشده است.</p>
      )}
      {pages.map((page) => {
        const draft = drafts[page.slug] ?? page;
        return (
          <section key={page.slug} className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-navy-900">
                {page.slug}
                {page.title ? <span className="ms-2 text-sm font-normal text-zinc-500">{page.title}</span> : null}
              </h3>
              {savedSlug === page.slug && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">ذخیره شد</span>
              )}
            </div>
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">عنوان</span>
                <input
                  value={draft.title ?? ""}
                  onChange={(e) => updateDraft(page.slug, { title: e.target.value })}
                  className="rounded-xl border p-3"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">محتوا</span>
                <textarea
                  value={draft.content ?? ""}
                  onChange={(e) => updateDraft(page.slug, { content: e.target.value })}
                  className="min-h-48 rounded-xl border p-3 font-mono text-sm"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">SEO عنوان</span>
                  <input
                    value={draft.seo_title ?? ""}
                    onChange={(e) => updateDraft(page.slug, { seo_title: e.target.value })}
                    className="rounded-xl border p-3"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">SEO توضیحات</span>
                  <textarea
                    value={draft.seo_description ?? ""}
                    onChange={(e) => updateDraft(page.slug, { seo_description: e.target.value })}
                    className="min-h-20 rounded-xl border p-3"
                  />
                </label>
              </div>
            </div>
            <button
              onClick={() => void save(page.slug)}
              className="btn btn-primary mt-4"
            >
              ذخیره صفحه
            </button>
          </section>
        );
      })}
    </div>
  );
}
