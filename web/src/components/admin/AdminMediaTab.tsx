"use client";
import { useEffect, useState } from "react";
import { extractApiError } from "@/lib/api";
import { listAdminMedia, uploadAdminMedia, type MediaFile } from "@/lib/admin";

/** Media library: upload and list uploaded files. */
export default function AdminMediaTab() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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
    try {
      await uploadAdminMedia(file);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-bold text-navy-900">Upload a file</h3>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf,image/svg+xml"
          disabled={busy}
          onChange={(e) => void onUpload(e.target.files?.[0])}
          className="rounded-xl border p-2 text-sm"
        />
        <p className="mt-2 text-xs text-zinc-500">
          JPG, PNG, WebP, SVG or PDF, up to 10 MB.
        </p>
      </section>
      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-bold text-navy-900">Library</h3>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-zinc-500">No files uploaded yet.</p>
        ) : (
          <ul className="grid gap-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-xl bg-navy-50 p-3 text-sm">
                <span className="truncate">{f.original_name}</span>
                <span className="ms-2 shrink-0 text-xs text-zinc-500">
                  {(f.file_size / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
