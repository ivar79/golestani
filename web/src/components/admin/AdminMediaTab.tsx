"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import { listAdminMedia, uploadAdminMedia, type MediaFile } from "@/lib/admin";
import { UploadCloud, FileIcon, Copy, Check, AlertCircle, Loader2 } from "lucide-react";

/** Media library: upload and list uploaded files with copyable URLs. */
export default function AdminMediaTab() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function refresh() {
    try {
      const rows = await listAdminMedia();
      setFiles(rows);
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

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAdminMedia(file);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(f: MediaFile) {
    try {
      await navigator.clipboard.writeText(f.url);
      setCopiedId(f.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <div className="space-y-6 text-right">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-white">کتابخانه رسانه و فایل‌ها</h2>
        <p className="text-xs sm:text-sm text-slate-400">
          بارگذاری و مدیریت تصاویر بنر، مقالات و فایل‌های سامانه
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

      {/* Upload Zone Card */}
      <section className="rounded-xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 shadow-sm">
        <h3 className="mb-3 text-sm sm:text-base font-bold text-white flex items-center gap-2">
          <UploadCloud className="h-4 w-4 text-cyan-400" />
          <span>بارگذاری فایل جدید</span>
        </h3>
        <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/50 p-6 text-center cursor-pointer transition-colors hover:border-cyan-400/50 hover:bg-slate-900/40">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-cyan-400">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-slate-200">
            {busy ? "در حال بارگذاری فایل..." : "انتخاب فایل یا رها کردن در این بخش"}
          </span>
          <span className="mt-1 text-[11px] text-slate-400">
            فرمت‌های JPG، PNG، WebP، SVG یا PDF تا حجم حداکثر ۱۰ مگابایت
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,image/svg+xml"
            disabled={busy}
            onChange={(e) => void onUpload(e.target.files?.[0])}
            className="hidden"
          />
        </label>
      </section>

      {/* Files List Card */}
      <section className="rounded-xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-sm sm:text-base font-bold text-white">فایل‌های بارگذاری‌شده</h3>
          <span className="text-xs text-slate-400">{files.length} فایل</span>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-slate-400">در حال دریافت فهرست رسانه‌ها…</p>
        ) : files.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">هنوز فایلی بارگذاری نشده است.</p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {files.map((f) => {
              const isImage = f.mime_type?.startsWith("image/");
              const isCopied = copiedId === f.id;

              return (
                <li
                  key={f.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 overflow-hidden">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={f.url}
                          alt={f.original_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileIcon className="h-5 w-5 text-cyan-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs sm:text-sm font-medium text-slate-200">
                        {f.original_name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {(f.file_size / 1024).toFixed(0)} کیلوبایت • {f.mime_type || "نامشخص"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => void copyUrl(f)}
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap active:scale-95 cursor-pointer ${
                        isCopied
                          ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                          : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600 hover:text-white"
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span>کپی شد!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>کپی لینک فایل</span>
                        </>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
