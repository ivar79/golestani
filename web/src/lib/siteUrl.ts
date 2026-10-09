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

/**
 * Was the canonical origin actually CONFIGURED (vs. the dev fallback above)?
 *
 * The fallback keeps SEO metadata valid, but it is NOT a URL to show a user:
 * the designer referral link would otherwise paint "http://localhost:3000" for
 * the first frame (SSR) before the mount effect swaps in the real origin.
 * Callers that render a user-visible address use this flag to stay blank until
 * the browser origin is known — never to render an address the site is not at.
 */
export const SITE_URL_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.VERCEL_URL?.trim(),
);
