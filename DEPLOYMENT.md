# Deployment Guide (Vercel + Render)

Monorepo با دو بخش مستقل:

| بخش | مسیر | استک | پلتفرم |
|-----|------|------|--------|
| فرانت‌اند | `web/` | Next.js 16 + Tailwind v4 | **Vercel** |
| بک‌اند | `api/` | Laravel 12 (PHP 8.3) + PostgreSQL/PostGIS | **Render** |

---

## ۱. فرانت‌اند → Vercel

### Root Directory (مهم!)
اپلیکیشن Next.js داخل زیرپوشه‌ی `web/` است، نه ریشه‌ی ریپو.

**گزینه A — تنظیمات پروژه (پیشنهادی):**
1. در Vercel: *New Project → Import*.
2. در **Build & Output Settings → Root Directory** مقدار **`web`** را بگذارید.
3. Vercel به‌طور خودکار Next.js را از `web/package.json` تشخیص می‌دهد (Build Command و Install Command را پیش‌فرض بگذارید).

**گزینه B — `vercel.json`:**
فایل `vercel.json` در ریشه‌ی ریپو فقط framework را `nextjs` تنظیم می‌کند. تعیین ریشه فقط از طریق گزینه‌ی A (فیلد Root Directory در داشبورد) انجام می‌شود — property ی به نام `cwd` در کانفیگ Vercel **معتبر نیست** و خطای `should NOT have additional property 'cwd'` می‌دهد.

### متغیرهای محیطی (در Vercel → Settings → Environment Variables)

| متغیر | نمونه | توضیح |
|-------|-------|-------|
| `NEXT_PUBLIC_API_URL` | `https://one-ns2s.onrender.com/api` | آدرس API لاراول (در `web/src/lib/api.ts` و `homepageContent.ts` خوانده می‌شود). **الزامی.** اگر ست نشود، صفحه‌ی اصلی در بیلد Vercel به `localhost:8000` می‌رود و ارور `ECONNREFUSED` می‌دهد. (کد حالا ایمن شده: در نبود این متغیر، fetch سرور skip می‌شود و بیلد fail نمی‌کند — ولی برای نمایش محتوای CMS واقعی باید ست باشد.) |

### نکته‌ی بیلد
`lucide-react` به `package.json` اضافه شد (قبلاً در `node_modules` بود ولی در `package.json` ثبت نشده بود → خطای *Module not found* در بیلد Vercel).

---

## ۲. بک‌اند → Render (Blueprint)

فایل **`render.yaml`** در ریشه‌ی ریپو سرویس بک‌اند را تعریف می‌کند:

- **Web Service** با نام `golestani-api` — runtime نوع **Docker (image)** با `api/Dockerfile` (PHP 8.3-FPM + Nginx در یک کانتینر، opcache+JIT فعال)
- **preDeploy:** `php artisan migrate --force` و سپس `php artisan db:validate-postgis` (اعتبارسنجی خودکار PostGIS — قبل از ترافیک اجرا می‌شود و در صورت خرابی دیپلای را متوقف می‌کند)
- **Health check:** `/api/health` (این مسیر در `routes/api.php` وجود دارد ✅)

### متغیرهای کلیدی

| متغیر | مقدار | توضیح |
|-------|-------|-------|
| `APP_KEY` | generateValue | بار اول خودکار ساخته می‌شود؛ بعداً ثابت نگه دارید |
| `APP_URL` | `https://golestani-api.onrender.com` | در داشبورد تنظیم شود |
| `DATABASE_URL` | اتصال دیتابیس | ⚠️ **باید PostGIS داشته باشد** |
| `CACHE_STORE` / `SESSION_DRIVER` / `QUEUE_CONNECTION` | `database` | بدون Redis؛ بعداً قابل تغییر به `redis` |
| `OTP_DEMO_MODE` | `false` | در پروداکشن حتماً false |
| `SMS_DRIVER` | `log` | اتصال درگاه SMS واقعی بعداً |
| `CORS_ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` | قفل‌کردن دامنه‌ی فرانت (در `config/cors.php` خوانده می‌شود ✅) |

### ⚠️ دیتابیس و PostGIS
مایگریشن‌ها اکستنشن `postgis` را فعال و ستون `geom` می‌سازند. پستگرس استاندارد Render **PostGIS ندارد**؛ از دیتابیس PostGIS-capable (مثل Neon) استفاده کنید و URL آن را در `DATABASE_URL` بگذارید. **راهنمای گام‌به‌گام:** [`DEPLOYMENT_POSTGIS_NEON.md`](DEPLOYMENT_POSTGIS_NEON.md) به همین دلیل در Blueprint هیچ دیتابیسی خودکار ساخته نمی‌شود تا دیتابیس ناسازگار ساخته نشود.

### راه‌اندازی
1. Render → **New → Blueprint** → انتخاب این ریپو → Render فایل `render.yaml` را می‌خواند.
2. متغیرهای `sync: false` (APP_URL، DATABASE_URL، CORS) را در داشبورد تکمیل کنید.
3. اولین دیپلای به‌طور خودکار مایگریشن را اجرا می‌کند.

---

## ۳. بررسی سلامت مسیرها/ایمپورت‌ها (تأیید شده)

- ایمپورت‌های `web/` کاملاً داخلی‌اند (`@/*` داخل `web/src`) و هیچ ارجاعی به `api/` ندارند؛ همه‌ی پکیج‌های خارجی در `package.json` ثبت شده‌اند.
- `api/` یک اپ استاندارد Laravel است (`composer.json` + `composer.lock` سالم) و document root آن `public/` است.
- ارتباط فرانت و بک **فقط** از طریق `NEXT_PUBLIC_API_URL` است (وابستگی مسیری ندارند) → تفکیک پوشه‌ها مشکلی برای دیپلای ایجاد نمی‌کند.
- CORS سمت Laravel با متغیر محیطی کنترل می‌شود — حتماً دامنه‌ی Vercel را تنظیم کنید.
