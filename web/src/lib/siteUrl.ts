/**
 * Phase 3.5 SEO — canonical production origin for metadata/OG/sitemap/robots.
 *
 * Fail-safe chain (هرگز invalid/empty برنمی‌گرداند):
 *  1. NEXT_PUBLIC_SITE_URL  → تنظیم صریح در deployment (توصیه‌شده)
 *  2. VERCEL_URL            → به‌صورت خودکار توسط Vercel تزریق می‌شود (https-ified)
 *  3. http://localhost:3000 → فقط برای dev؛ URL معتبر می‌سازد تا canonical/OG
 *     هرگز ناقص یا invalid نشود.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const SITE_URL = getSiteUrl();
