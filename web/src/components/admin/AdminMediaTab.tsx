"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import { listAdminMedia, uploadAdminMedia, type MediaFile } from "@/lib/admin";
import { mediaUrl } from "@/lib/phase2";
import { UploadCloud, FileIcon, Copy, Check, AlertCircle, Loader2 } from "lucide-react";

/** Media library: upload and list uploaded files with copyable URLs. */
export default function AdminMediaTab() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  function getFileUrl(f: MediaFile): string {
    return f.url || mediaUrl(f.path) || f.path || "";
  }

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
      const url = getFileUrl(f);
      await navigator.clipboard.writeText(url);
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
      <section className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
        <div className="mb-4 flex items-center gap-2.5 border-b border-white/[0.08] pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.15)]">
            <UploadCloud className="h-4 w-4" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-white">بارگذاری فایل جدید</h3>
        </div>
        <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-slate-950/50 p-7 text-center cursor-pointer transition-all hover:border-cyan-400/50 hover:bg-cyan-500/[0.03]">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
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
      <section className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]">
        <div className="mb-4 flex items-center justify-between border-b border-white/[0.08] pb-3">
          <h3 className="text-sm sm:text-base font-bold text-white">فایل‌های بارگذاری‌شده</h3>
          <span className="text-xs text-slate-400">{files.length} فایل</span>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-slate-400">در حال دریافت فهرست رسانه‌ها…</p>
        ) : files.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">هنوز فایلی بارگذاری نشده است.</p>
        ) : (
          <ul className="divide-y divide-white/[0.08]">
            {files.map((f) => {
              const isImage = f.mime_type?.startsWith("image/");
              const isCopied = copiedId === f.id;

              return (
                <li
                  key={f.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/80 text-slate-300 overflow-hidden shadow-inner">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getFileUrl(f)}
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
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap active:scale-95 cursor-pointer ${
                        isCopied
                          ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
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
