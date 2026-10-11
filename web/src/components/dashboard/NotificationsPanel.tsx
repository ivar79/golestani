"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck, Clock3, RefreshCw } from "lucide-react";
import { default as api, extractApiError } from "@/lib/api";

type InternalNotification = {
  id: number;
  type: string;
  title: string;
  message: string;
  related_type?: string | null;
  related_id?: number | null;
  read_at: string | null;
  created_at: string;
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "زمان نامشخص"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function NotificationsPanel() {
  const [items, setItems] = useState<InternalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
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
    if (item.read_at || busyId !== null) return;
    setBusyId(item.id);
    setError(null);
    try {
      const response = await api.patch<InternalNotification>(`/notifications/${item.id}/read`);
      setItems((current) => current.map((entry) => entry.id === item.id ? response.data : entry));
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  const unreadCount = items.filter((item) => !item.read_at).length;

  return (
    <section className="space-y-5 rounded-3xl border border-ik-border bg-ik-panel/80 p-5 shadow-xl sm:p-8" aria-labelledby="notifications-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="notifications-heading" className="flex items-center gap-2 text-base font-bold text-ik-text sm:text-lg">
            <Bell className="h-5 w-5 text-ik-accent" /> اعلان‌های شما
          </h2>
          <p className="mt-1 text-xs leading-6 text-ik-muted">
            {unreadCount.toLocaleString("fa-IR")} اعلان خوانده‌نشده از {items.length.toLocaleString("fa-IR")} مورد
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} title="بازخوانی اعلان‌ها" className="rounded-lg p-2 text-ik-muted hover:bg-ik-wash hover:text-ik-text disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">{error}</div>}
      {loading ? (
        <p className="rounded-xl border border-ik-border p-6 text-center text-sm text-ik-muted">در حال دریافت اعلان‌ها…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ik-border p-8 text-center">
          <Bell className="mx-auto h-8 w-8 text-ik-muted" />
          <p className="mt-3 text-sm font-semibold text-ik-text">اعلانی برای نمایش وجود ندارد.</p>
          <p className="mt-1 text-xs text-ik-muted">اعلان‌های مربوط به اشتراک و بررسی اطلاعات کسب‌وکار در این بخش نمایش داده می‌شوند.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={`rounded-2xl border p-4 transition-colors ${item.read_at ? "border-ik-border bg-ik-wash/50" : "border-ik-accent/30 bg-ik-accent/[0.06]"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.read_at ? "bg-ik-wash text-ik-muted" : "bg-ik-accent/15 text-ik-accent"}`}>
                  {item.read_at ? <CheckCheck className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-ik-text">{item.title}</h3>
                    {!item.read_at && <span className="rounded-full bg-ik-accent/15 px-2 py-0.5 text-[10px] font-bold text-ik-accent">جدید</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-ik-muted">{item.message}</p>
                  <p className="mt-2 flex items-center gap-1 text-[10px] text-ik-muted"><Clock3 className="h-3 w-3" /> {formatDate(item.created_at)}</p>
                </div>
                {!item.read_at && (
                  <button type="button" onClick={() => void markRead(item)} disabled={busyId !== null} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ik-border px-2.5 text-[11px] font-semibold text-ik-muted hover:border-ik-accent/40 hover:text-ik-accent disabled:opacity-50" aria-label={`علامت‌گذاری اعلان ${item.title} به‌عنوان خوانده‌شده`}>
                    <Check className="h-3.5 w-3.5" /> خواندم
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default NotificationsPanel;
