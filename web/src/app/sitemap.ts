import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Phase 3.5 SEO — sitemap فقط با routeهای واقعاً public و indexable.
 *
 * صفحات خصوصی (dashboard/admin/login/otp/designer) و API عمداً غایب‌اند.
 * صفحه‌های عمومی کسب‌وکار (/b/[slug] و مسیرهای city/category) فعلاً وارد
 * نمی‌شوند: برای فهرست‌کردنشان به endpoint عمومیِ فهرست اسلاگ‌ها نیاز است
 * که در API فعلی وجود ندارد — بدون هماهنگی API جدید ساخته نمی‌شود
 * (طبق scope این مرحله). معماری پیشنهادی در گزارش نهایی ثبت شده است.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
