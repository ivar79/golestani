import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Phase 3.5 SEO — robots.txt استاندارد Next.js.
 *
 * فقط مسیرهای genuinely private بسته می‌شوند (پنل‌ها و احراز هویت و API)؛
 * هیچ مسیر public مهمی block نمی‌شود. صفحات عمومی کسب‌وکار (/b/[slug] و
 * مسیرهای city/category) عمداً allow می‌مانند تا وقتی indexable شدند
 * نیازی به تغییر robots نباشد.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/dashboard",
          "/designer",
          "/login",
          "/otp",
          "/api/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
