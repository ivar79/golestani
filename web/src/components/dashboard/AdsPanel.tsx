"use client";

/**
 * AdsPanel — owner advertisement management (Phase 5).
 *
 * Existing owner endpoints + entitlement contract: creation is gated by
 * `ads` and capped by `max_ads` SERVER-SIDE; the lock here is a UX mirror
 * routing to /pricing. Status workflow: pending → approved/rejected by admin.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, RefreshCw, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { extractApiError } from "@/lib/api";
import type { EntitlementPayload } from "@/lib/entitlements";

type Advertisement = {
  id: number;
  title?: string | null;
  slot: string;
  target_url?: string | null;
  status: "pending" | "approved" | "rejected" | "suspended";
  admin_note?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

const statusLabels: Record<Advertisement["status"], string> = {
  pending: "در انتظار تأیید",
  approved: "تأییدشده (در حال نمایش)",
  rejected: "ردشده",
  suspended: "معلق",
};

const statusStyles: Record<Advertisement["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  suspended: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

const SLOTS = [
  { key: "search_top", label: "جست‌وجو — بالای نتایج" },
  { key: "search_side", label: "جست‌وجو — کنار نتایج" },
  { key: "home_banner", label: "صفحه اصلی — بنر" },
];

export function AdsPanel({ businessId, entitlements }: { businessId?: number; entitlements: EntitlementPayload }) {
  const [items, setItems] = useState<Advertisement[]>([]);
  const [slot, setSlot] = useState(SLOTS[0].key);
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adsAllowed = entitlements.capabilities.ads === true;
  const maxAds = entitlements.capabilities.max_ads;
  const activeCount = items.filter((item) => item.status === "pending" || item.status === "approved").length;
  const limitReached = typeof maxAds === "number" && activeCount >= maxAds && maxAds > 0;

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { default: api } = await import("@/lib/api");
      setItems((await api.get<Advertisement[]>(`/businesses/${businessId}/advertisements`)).data);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove(ad: Advertisement) {
    if (!window.confirm("این آگهی حذف شود؟")) return;
    setError(null);
    setMessage(null);
    try {
      const { default: api } = await import("@/lib/api");
      await api.delete(`/advertisements/${ad.id}`);
      setMessage("آگهی حذف شد.");
      await load();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const { default: api } = await import("@/lib/api");
      await api.post(`/businesses/${businessId}/advertisements`, {
        slot,
        title: `آگهی ${SLOTS.find((option) => option.key === slot)?.label ?? slot}`,
        target_url: targetUrl.trim() || undefined,
      });
      setTargetUrl("");
      setMessage("آگهی ثبت شد و پس از تأیید مدیریت در جایگاه انتخابی نمایش داده می‌شود.");
      await load();
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setSubmitting(false);
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
            <Megaphone className="h-5 w-5 text-ik-accent" /> تبلیغات حمایت‌شده
          </h2>
          <p className="mt-1 text-xs leading-6 text-ik-muted">
            {typeof maxAds === "number" ? `سقف پلن فعلی: ${maxAds.toLocaleString("fa-IR")} آگهی فعال · ` : ""}
            {activeCount.toLocaleString("fa-IR")} آگهی در جریان
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg p-2 text-ik-muted hover:bg-ik-wash hover:text-ik-text" title="بازخوانی">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-ik-danger/30 bg-ik-danger/10 p-3 text-xs text-ik-danger">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-ik-success/30 bg-ik-success/10 p-3 text-xs text-ik-success">{message}</div>}

      {(!adsAllowed || limitReached) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3">
          <p className="flex items-center gap-1.5 text-[11px] leading-5 text-amber-200">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {limitReached ? "سقف آگهی‌های فعال پلن فعلی پر شده است." : "تبلیغات ویژه نیازمند اشتراک فعال با این امکان است."}
          </p>
          <Link href="/pricing" className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-400/20">
            مشاهده پلن‌ها
          </Link>
        </div>
      )}

      {adsAllowed && !limitReached && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ik-border bg-ik-wash p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ik-muted">جایگاه نمایش</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} className="ik-field w-full rounded-xl border border-ik-border bg-ik-panel px-3 py-2.5 text-sm text-ik-text outline-none focus:border-ik-accent">
                {SLOTS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ik-muted">آدرس مقصد</span>
              <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} required type="url" dir="ltr" placeholder="https://" className="ik-field w-full rounded-xl border border-ik-border bg-ik-panel px-3 py-2.5 text-sm text-ik-text outline-none focus:border-ik-accent" />
            </label>
          </div>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-ik-accent px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            ثبت درخواست آگهی
          </button>
        </form>
      )}

      <div className="space-y-2 border-t border-ik-border pt-5">
        <h3 className="text-sm font-bold text-ik-text">آگهی‌های شما</h3>
        {loading ? (
          <p className="text-xs text-ik-muted">در حال دریافت...</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-ik-border p-6 text-center text-xs text-ik-muted">هنوز آگهی ثبت نکرده‌اید.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ik-wash p-3 text-xs">
                <span className="font-semibold text-ik-text">
                  {SLOTS.find((option) => option.key === item.slot)?.label ?? item.slot}
                </span>
                <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold ${statusStyles[item.status] ?? "border-ik-border text-ik-muted"}`}>
                  {statusLabels[item.status] ?? item.status}
                </span>
                {item.admin_note && <span className="basis-full text-ik-danger">یادداشت مدیر: {item.admin_note}</span>}
                <button type="button" onClick={() => void remove(item)} className="mr-auto inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 text-[10px] font-bold text-rose-400 hover:bg-rose-400/20" aria-label={`حذف آگهی ${item.id}`}>
                  <Trash2 className="h-3.5 w-3.5" /> حذف آگهی
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default AdsPanel;
