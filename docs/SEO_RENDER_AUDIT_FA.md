# گزارش رفع مشکل رندر و سئو (SEO Render Audit — FA)

**تاریخ:** 2026-09-02
**وضعیت:** انجام شد — همه تست‌ها سبز

## ۱. مشکل چه بود؟

هنگام `npm run dev` (و production)، صفحه اصلی اول **خالی** رندر می‌شد و بعد از چند صد میلی‌ثانیه متن‌ها ناگهان ظاهر می‌شدند («پرش محتوا»).

### ریشه
تمام ۷ کامپوننت Homepage (Hero, Features, Showcase, HowItWorks, CTA, Footer, Taskbar) کلاینت بودند و متن‌ها را **بعد از mount** با `useEffect` از API می‌گرفتند:

```
HTML خالی → hydrate → fetch به API → setState → ظاهر شدن ناگهانی متن‌ها
```

### پیامدها
- **سئو:** خزنده گوگل HTML تقریباً خالی می‌دید؛ تایتل/دیسکریپشن هم ثابت بود و از CMS نمی‌آمد.
- **تجربه کاربری:** پرش متن، CLS، حس کندی.
- **کارایی:** هر بازدید = یک درخواست اضافه به API؛ بک‌اند هم بدون کش بود.

## ۲. راه‌حل پیاده‌سازی‌شده

### معماری جدید رندر

```
page.tsx (Server Component, ISR 60s)
  └─ fetchHomepageContentServer()   ← یک fetch سمت سرور، کش Next.js
      └─ <HomepageContentProvider content={...}>   ← Client Component
          ├─ AppTaskbar      (useHomepageContent → از Context، بدون fetch)
          ├─ HomeHero        (next/image priority — LCP بهینه)
          ├─ HomeFeatures
          ├─ Showcase/HowItWorks
          ├─ HomeCta
          └─ HomeFooter
```

- **SSR کامل:** متن‌ها در HTML اولیه هستند — نه پرش، نه مشکل سئو.
- **هوک قدیمی حفظ شد:** `useHomepageContent()` حالا اول از Context می‌خواند؛ اگر Provider نباشد (صفحات دیگر)، مثل قبل fetch می‌کند. **هیچ کامپوننتی تغییر API نداد.**
- **ساختار فایل‌ها:**
  - `src/lib/homepageContent.ts` — توابع خالص داده (سرور + کلاینت)
  - `src/lib/homepage.tsx` — Provider + هوک کلاینت
  - `src/app/page.tsx` — Server Component + `generateMetadata`

### ۵ تغییر اصلی

| # | تغییر | فایل |
|---|-------|------|
| ۱ | صفحه → async Server Component با SSR کامل | `web/src/app/page.tsx` |
| ۲ | ISR: `export const revalidate = 60` | `web/src/app/page.tsx` |
| ۳ | `generateMetadata` از کلید CMS `seo.homepage` | `web/src/app/page.tsx` |
| ۴ | `next/image` با `priority` برای Hero (LCP) و پس‌زمینه | `web/src/components/home/HomeHero.tsx` |
| ۵ | کش ۵ دقیقه‌ای Laravel + flush خودکار بعد از هر `saveSetting` | `api/.../AdminController.php` |

### کلید CMS جدید
`seo.homepage` — JSON با ساختار `{"title": "...", "description": "..."}` (رشته ساده هم پذیرفته می‌شود). از Admin → تنظیمات قابل ویرایش است؛ بعد از ذخیره، کش بک‌اند و ISR فرانت هر دو به‌روز می‌شوند (ISR حداکثر ۶۰ ثانیه).

### `next.config.ts`
`images.remotePatterns` برای HTTPS اضافه شد تا تصاویر CMS از دامنه/S3 هم با `next/image` بهینه شوند.

## ۳. نتایج تأیید

| بررسی | نتیجه |
|-------|-------|
| `npx tsc --noEmit` | ✅ PASS |
| `npm run lint` | ✅ PASS (۰ خطا) |
| `npm run build` | ✅ PASS — `/` حالا ISR با `Revalidate 1m` |
| `php -l` | ✅ PASS |
| SSR HTML (تولید واقعی) | ✅ عنوان، زیرعنوان، ویژگی‌ها، CTA، فوتر، تگ title، meta description — همه در HTML اولیه |
| ISR cache | ✅ درخواست دوم: **۶ms** با `x-nextjs-cache` |
| کش Laravel | ✅ `Cache::remember` + flush در `saveSetting` |
| Seed | ✅ `seo.homepage` به `HomepageSeeder` اضافه و اجرا شد (۴۳ کلید) |

## ۴. نحوه نگهداری آینده

- **تغییر متن‌ها:** Admin → تنظیمات CMS؛ تغییر فوری (کش بک‌اند همان لحظه flush می‌شود؛ فرانت حداکثر ۶۰ ثانیه بعد).
- **تغییر سئو:** کلید `seo.homepage` را در Admin ویرایش کنید (JSON با title/description).
- **صفحه جدید:** اگر Server Component است از `fetchHomepageContentServer()`؛ اگر کلاینت است از `useHomepageContent()` (خودکار fetch می‌کند).
- **توجه:** پورت پیش‌فرض dev ممکن است متفاوت باشد؛ API base از `NEXT_PUBLIC_API_URL` در `.env` خوانده می‌شود (بدون هاردکد).
