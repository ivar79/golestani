"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import {
  getAdminPages,
  saveAdminPage,
  type PageContent,
} from "@/lib/admin";
import { FileText, Save, Check, AlertCircle, Loader2 } from "lucide-react";

const PAGE_LABELS: Record<string, string> = {
  about: "درباره ما",
  contact: "تماس با ما",
  rules: "قوانین و مقررات",
  privacy: "حریم خصوصی کاربران",
  terms: "شرایط استفاده از خدمات",
  faq: "سوالات متداول",
};

/** Editable static pages (قوانین / درباره ما / تماس با ما …) keyed by slug. */
export default function AdminPagesTab() {
  const [pages, setPages] = useState<PageContent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<PageContent>>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
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
    setSavingSlug(slug);
    setError(null);
    try {
      await saveAdminPage(slug, drafts[slug] ?? {});
      setSavedSlug(slug);
      setTimeout(() => setSavedSlug(null), 3000);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setSavingSlug(null);
    }
  }

  function updateDraft(slug: string, patch: Partial<PageContent>) {
    setDrafts((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-right">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-white">مدیریت صفحات مستقل</h2>
        <p className="text-xs sm:text-sm text-slate-400">
          ویرایش محتوا و تنظیمات سئوی صفحات ثابت (قوانین، درباره ما، تماس و ...)
        </p>
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

      {pages.length === 0 && (
        <p className="py-8 text-center text-xs sm:text-sm text-slate-400">
          هیچ صفحه‌ای تعریف نشده است.
        </p>
      )}

      <div className="grid gap-6">
        {pages.map((page) => {
          const draft = drafts[page.slug] ?? page;
          const label = PAGE_LABELS[page.slug] || page.slug;
          const isSaving = savingSlug === page.slug;
          const isSaved = savedSlug === page.slug;

          return (
            <section
              key={page.slug}
              className="rounded-xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-400" />
                  <h3 className="font-bold text-white text-sm sm:text-base">
                    {label}
                    <span className="ms-2 font-mono text-xs text-slate-400" dir="ltr">
                      /{page.slug}
                    </span>
                  </h3>
                </div>
                {isSaved && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                    <Check className="h-3 w-3" />
                    ذخیره شد
                  </span>
                )}
              </div>

              <div className="grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-slate-300">عنوان صفحه</span>
                  <input
                    value={draft.title ?? ""}
                    onChange={(e) => updateDraft(page.slug, { title: e.target.value })}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-slate-300">
                    متن و محتوای صفحه (مارک‌داون یا متن ساده)
                  </span>
                  <textarea
                    value={draft.content ?? ""}
                    onChange={(e) => updateDraft(page.slug, { content: e.target.value })}
                    rows={6}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-base sm:text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-slate-400">SEO عنوان مرورگر</span>
                    <input
                      value={draft.seo_title ?? ""}
                      onChange={(e) => updateDraft(page.slug, { seo_title: e.target.value })}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-slate-400">SEO توضیحات متا</span>
                    <textarea
                      value={draft.seo_description ?? ""}
                      onChange={(e) =>
                        updateDraft(page.slug, { seo_description: e.target.value })
                      }
                      rows={2}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save(page.slug)}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-cyan-600 px-5 py-2 text-xs sm:text-sm font-semibold text-white shadow-md transition-all hover:bg-cyan-500 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span>{isSaving ? "در حال ذخیره..." : "ذخیره تغییرات این صفحه"}</span>
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
