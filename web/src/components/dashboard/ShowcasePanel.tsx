"use client";

/**
 * ShowcasePanel — owner showcase (ویترین) management (Phase 5).
 *
 * Uses the existing owner endpoints + entitlement contract: creation is
 * gated by `showcase` and capped by `max_showcases` SERVER-SIDE; the locks
 * here are UX mirrors that route the user to /pricing when appropriate.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Package, RefreshCw, Trash2, Lock, Pencil, X } from "lucide-react";
import Link from "next/link";
import { extractApiError } from "@/lib/api";
import {
  deleteShowcase,
  getBusinessShowcases,
  uploadShowcase,
  updateShowcase,
  type Showcase,
} from "@/lib/businesses";
import type { EntitlementPayload } from "@/lib/entitlements";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function ShowcasePanel({ businessId, entitlements }: { businessId?: number; entitlements: EntitlementPayload }) {
  const [items, setItems] = useState<Showcase[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showcaseAllowed = entitlements.capabilities.showcase === true;
  const maxShowcases = entitlements.capabilities.max_showcases;
  const limitReached = typeof maxShowcases === "number" && items.length >= maxShowcases && maxShowcases > 0;
  // PDF Phase 5 «توضیحات کامل‌تر خدمات»: the description length is a plan
  // entitlement (max_description_length). Higher plans get more room; the
  // SERVER enforces the same number, so this is only the editor's mirror.
  const maxDescriptionLength =
    typeof entitlements.capabilities.max_description_length === "number"
      ? entitlements.capabilities.max_description_length
      : null;

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await getBusinessShowcases(businessId));
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function onFileChange(candidate: File | null) {
    setError(null);
    if (!candidate) {
      setFile(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(candidate.type)) {
      setError("فرمت تصویر مجاز نیست — فقط JPEG، PNG یا WebP.");
      return;
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      setError("حجم تصویر بیشتر از سقف ۵ مگابایت است.");
      return;
    }
    setFile(candidate);
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function startEditing(item: Showcase) {
    setEditingId(item.id);
    setTitle(item.title);
    setDescription(item.description ?? "");
    setPrice(item.price == null ? "" : String(item.price));
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessage(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || !title.trim() || (editingId === null && !file)) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    const itemId = editingId;
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("description", description.trim());
      form.set("price", price);
      if (file) form.set("image", file);
      if (itemId !== null) await updateShowcase(itemId, form);
      else await uploadShowcase(businessId, form);
      resetForm();
      setMessage(itemId !== null ? "تغییرات آیتم ویترین ذخیره شد." : "آیتم ویترین ثبت شد و پس از تأیید مدیریت منتشر می‌شود.");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("این آیتم ویترین حذف شود؟")) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteShowcase(id);
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setDeletingId(null);
    }
  }

  if (!businessId) {
    return <section className="rounded-3xl border border-ik-border bg-ik-panel/80 p-6 text-sm text-ik-muted">ابتدا یک کسب‌وکار انتخاب یا ثبت کنید.</section>;
  }

  return (
    <section className="space-y-6 rounded-3xl border border-ik-border bg-ik-panel/80 p-6 shadow-xl sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-ik-text sm:text-lg">
            <Package className="h-5 w-5 text-ik-accent" /> ویترین محصولات و خدمات
          </h2>
          <p className="mt-1 text-xs leading-6 text-ik-muted">
            {typeof maxShowcases === "number" ? `سقف پلن فعلی: ${maxShowcases.toLocaleString("fa-IR")} آیتم · ` : ""}
            {items.length.toLocaleString("fa-IR")} آیتم ثبت‌شده
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg p-2 text-ik-muted hover:bg-ik-wash hover:text-ik-text" title="بازخوانی">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-ik-success/30 bg-ik-success/10 p-3 text-xs text-ik-success">{message}</div>}

      {(!showcaseAllowed || limitReached) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
          <p className="flex items-center gap-1.5 text-[11px] leading-5 text-amber-200">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {limitReached
              ? "سقف ویترین پلن فعلی پر شده است."
              : "ویترین محصولات نیازمند اشتراک فعال با این امکان است."}
          </p>
          <Link href="/pricing" className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-400/20">
            مشاهده پلن‌ها
          </Link>
        </div>
      )}

      {showcaseAllowed && (!limitReached || editingId !== null) && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ik-border bg-ik-wash p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} placeholder="عنوان آیتم" className="ik-field rounded-xl border border-ik-border bg-ik-panel px-3 py-2.5 text-sm text-ik-text outline-none focus:border-ik-accent" />
            <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min={0} placeholder="قیمت (تومان — اختیاری)" className="ik-field rounded-xl border border-ik-border bg-ik-panel px-3 py-2.5 text-sm text-ik-text outline-none focus:border-ik-accent" />
          </div>
          <div className="space-y-1">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={maxDescriptionLength ?? undefined}
              rows={3}
              placeholder={
                maxDescriptionLength === null
                  ? "توضیح خدمات و محصولات (اختیاری — بدون محدودیت طول در پلن فعلی)"
                  : `توضیح خدمات و محصولات (اختیاری — حداکثر ${maxDescriptionLength} کاراکتر در پلن فعلی)`
              }
              className="ik-field w-full rounded-xl border border-ik-border bg-ik-panel px-3 py-2.5 text-sm text-ik-text outline-none focus:border-ik-accent"
            />
            {maxDescriptionLength !== null && (
              <p className="text-[11px] text-ik-muted" aria-live="polite">
                {description.length} از {maxDescriptionLength} کاراکتر
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ik-text">
            <ImagePlus className="h-4 w-4 text-ik-accent" />
            {file ? file.name : editingId !== null ? "تصویر جدید (اختیاری؛ تصویر فعلی حفظ می‌شود)" : "انتخاب تصویر (JPEG، PNG، WebP — حداکثر ۵MB)"}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={submitting || !title.trim() || (editingId === null && !file)} className="inline-flex items-center gap-2 rounded-xl bg-ik-accent px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId !== null ? <Pencil className="h-4 w-4" /> : <Package className="h-4 w-4" />}
              {editingId !== null ? "ذخیره تغییرات" : "ثبت آیتم ویترین"}
            </button>
            {editingId !== null && <button type="button" onClick={resetForm} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl border border-ik-border px-4 py-2.5 text-sm font-semibold text-ik-muted hover:text-ik-text disabled:opacity-50"><X className="h-4 w-4" /> لغو ویرایش</button>}
          </div>
        </form>
      )}

      <div className="space-y-2 border-t border-ik-border pt-5">
        <h3 className="text-sm font-bold text-ik-text">آیتم‌های ویترین</h3>
        {loading ? (
          <p className="text-xs text-ik-muted">در حال دریافت...</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-ik-border p-6 text-center text-xs text-ik-muted">هنوز آیتمی ثبت نشده است.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-ik-wash p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ik-text">{item.title}</p>
                  <p className="text-[10px] text-ik-muted">
                    {item.is_published ? "منتشرشده" : "در انتظار تأیید"}
                    {item.price != null ? ` · ${new Intl.NumberFormat("fa-IR").format(item.price)} تومان` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => startEditing(item)} className="rounded-lg border border-ik-accent/30 bg-ik-accent/10 p-1.5 text-ik-accent hover:bg-ik-accent/20" title="ویرایش آیتم" aria-label={`ویرایش ${item.title}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => void remove(item.id)} disabled={deletingId === item.id} className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-1.5 text-rose-400 hover:bg-rose-400/20 disabled:opacity-50" title="حذف">
                    {deletingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default ShowcasePanel;
