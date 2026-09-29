/**
 * SUBSCRIPTION TIME — نمایشِ countdown بر پایه snapshot سرور.
 *
 * SOURCE OF TRUTH سمت سرور است: started_at/expires_at (UTC timestamp) و
 * remaining_seconds که در هر fetch از اختلاف timestampها محاسبه می‌شود
 * (هیچ counter کاهشی‌ای وجود ندارد). این helperها فقط برای نمایش هستند و
 * هیچ تصمیم دسترسی‌ای از آن‌ها گرفته نمی‌شود (backend مرجع امنیتی است).
 *
 * الگوریتم ضد-دریفت: به‌جای تکیه بر ساعتِ مستقل کلاینت، اختلاف ساعتِ محلی
 * نسبت به لحظهٔ fetch به snapshot سرور اعمال می‌شود (offset anchoring):
 *
 *   displayed(t) = expires_at − (serverNowAtFetch + (t − fetchedAt))
 *                = remainingAtFetch − (t − fetchedAt)
 *
 * اگر ساعت سیستم کاربر تغییر کند (تغییر ناگهانی Date.now)، یک پرش بزرگ
 * نمایش داده می‌شود ولی هیچ چیز ذخیره نمی‌شود و با اولین resync (focus /
 * visibility / refetch) مقدار درست برمی‌گردد — دسترسی هیچ‌جا از این مقدار
 * کنترل نمی‌شود. چند tab/device چون همگی از snapshot یکسان سرور لنگر
 * می‌خورند، همان زمان را نشان می‌دهند.
 */

export type ServerTimeSnapshot = {
  /** ISO expires_at from the server (or null when the subscription has no lifetime). */
  expiresAt: string | null;
  /** Server-computed remaining seconds AT FETCH TIME. */
  remainingAtFetchMs: number | null;
  /** Date.now() at fetch time (client wall clock, only used as a local delta anchor). */
  fetchedAtMs: number;
};

/** Build a snapshot from a server payload. */
export function serverTimeSnapshot(
  expiresAtIso: string | null | undefined,
  remainingSeconds: number | null | undefined,
  nowMs: number = Date.now(),
): ServerTimeSnapshot {
  return {
    expiresAt: expiresAtIso ?? null,
    remainingAtFetchMs: remainingSeconds == null ? null : Math.max(0, remainingSeconds * 1000),
    fetchedAtMs: nowMs,
  };
}

/**
 * Displayed remaining ms at client time `nowMs`, derived from the server
 * snapshot (never from a client-owned absolute clock). Monotonically
 * decreases with local elapsed time between syncs; floored at 0.
 */
export function remainingMsFromSnapshot(snapshot: ServerTimeSnapshot, nowMs: number = Date.now()): number | null {
  if (snapshot.remainingAtFetchMs === null) return null;
  const elapsed = Math.max(0, nowMs - snapshot.fetchedAtMs);
  return Math.max(0, snapshot.remainingAtFetchMs - elapsed);
}

/**
 * Defensive re-anchor from the absolute expires_at when a local clock jump
 * is suspected (|now − fetchedAt| far beyond the remaining time). If the
 * expires_at ISO is trustworthy, the remaining time can always be recomputed
 * as expires_at − now; the caller decides when to refetch instead.
 */
export function remainingMsFromExpiresAt(expiresAtIso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!expiresAtIso) return null;
  const expires = Date.parse(expiresAtIso);
  if (Number.isNaN(expires)) return null;
  return Math.max(0, expires - nowMs);
}

/** «۲۹ روز و ۱۲ ساعت» | «۷ ساعت و ۳ دقیقه» | «۴۵ ثانیه» — نمایش فارسی. */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "منقضی شده";

  const nf = new Intl.NumberFormat("fa-IR");
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return hours > 0 ? `${nf.format(days)} روز و ${nf.format(hours)} ساعت` : `${nf.format(days)} روز`;
  if (hours > 0) return minutes > 0 ? `${nf.format(hours)} ساعت و ${nf.format(minutes)} دقیقه` : `${nf.format(hours)} ساعت`;
  if (minutes > 0) return `${nf.format(minutes)} دقیقه`;
  return `${nf.format(seconds)} ثانیه`;
}
