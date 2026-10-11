"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import api, { extractApiError } from "@/lib/api";

type InternalNotification = {
  id: number;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "تاریخ نامشخص"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function NotificationsPanel() {
  const [items, setItems] = useState<InternalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<InternalNotification[]>("/notifications");
      setItems(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function markRead(item: InternalNotification) {
    if (item.read_at) return;
    setWorkingId(item.id);
    setError(null);
    try {
      const response = await api.patch<InternalNotification>(`/notifications/${item.id}/read`);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...response.data } : candidate));
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

  const unread = items.filter((item) => !item.read_at).length;

  return (
    <section className="space-y-5 rounded-3xl border border-ik-border bg-ik-panel/80 p-6 shadow-xl sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-ik-text sm:text-lg"><Bell className="h-5 w-5 text-ik-accent" /> اعلان‌ها</h2>
          <p className="mt-1 text-xs leading-6 text-ik-muted">{unread.toLocaleString("fa-IR")} اعلان خوانده‌نشده از {items.length.toLocaleString("fa-IR")} اعلان</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg p-2 text-ik-muted transition hover:bg-ik-wash hover:text-ik-text disabled:opacity-50" title="بازخوانی اعلان‌ها" aria-label="بازخوانی اعلان‌ها">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">{error}</div>}
      {loading && items.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-ik-muted"><Loader2 className="ml-2 h-4 w-4 animate-spin" />در حال دریافت اعلان‌ها…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ik-border p-8 text-center">
          <Bell className="mx-auto mb-3 h-7 w-7 text-ik-muted/70" />
          <p className="text-sm font-semibold text-ik-text">اعلان تازه‌ای ندارید</p>
          <p className="mt-1 text-xs text-ik-muted">تغییر وضعیت اشتراک و رویدادهای مهم حساب در این بخش نمایش داده می‌شوند.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={`rounded-2xl border p-4 transition-colors ${item.read_at ? "border-ik-border bg-ik-wash/50" : "border-ik-accent/30 bg-ik-accent/[0.06]"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.read_at ? "bg-ik-wash text-ik-muted" : "bg-ik-accent/10 text-ik-accent"}`}><Bell className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-ik-text">{item.title}</h3>
                    <time className="text-[10px] text-ik-muted">{dateLabel(item.created_at)}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-ik-muted">{item.message}</p>
                  {!item.read_at ? (
                    <button type="button" onClick={() => void markRead(item)} disabled={workingId === item.id} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-ik-accent/30 bg-ik-accent/10 px-3 py-2 text-[11px] font-bold text-ik-accent hover:bg-ik-accent/15 disabled:opacity-50">
                      {workingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} علامت‌گذاری به‌عنوان خوانده‌شده
                    </button>
                  ) : <p className="mt-2 text-[10px] font-medium text-ik-success">خوانده‌شده</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
