# Deployment Guide (Vercel + Render)

Monorepo با دو بخش مستقل:

| بخش | مسیر | استک | پلتفرم |
|-----|------|------|--------|
| فرانت‌اند | `web/` | Next.js 16 + Tailwind v4 | **Vercel** |
| بک‌اند | `api/` | Laravel 12 (PHP 8.3) + PostgreSQL/PostGIS | **Render / Railway** |

> **قرارداد پشته فنی:** پیاده‌سازی فقط با فناوری‌های مصوب — Next.js + TypeScript / Laravel + PHP 8.3 / PostgreSQL + PostGIS / Redis. Node.js هیچ سرویسی در پشته نیست؛ صرفاً ابزار build و اجرای خود Next.js است.

---

## ۰. زیرساخت نقشه (تایل‌سرور محلی — فقط PHP)

تایل‌های وکتوری ایران از فایل `iran-shortbread-1.0.mbtiles` (اسکیمای Shortbread 1.0، زوم ۰ تا ۱۴، حدود ۶۵۰ مگابایت) مستقیماً توسط **API لاراول** سرو می‌شود — با درایور بومی `pdo_sqlite` در PHP 8.3 و **بدون هیچ سرویس Node.js** (فرانت‌اند Next.js فقط لایه نمایش است و هیچ منطق ران‌تایم Node ندارد).

- **اندپوینت تایل وکتور:** `GET /api/map/tile/{z}/{x}/{y}` — بایت‌های gzip مستقیم از آرشیو خوانده می‌شوند (بدون decompress در PHP) با هدر `Content-Encoding: gzip` و کش مرورگر ۲۴ ساعته.
- **اندپوینت تایل رستری (فال‌بک آنلاین):** `GET /api/map/raster-tile/{z}/{x}/{y}` — پروکسی PHP خالص روی Laravel با کش Redis (TTL ۲۴ ساعت)، User-Agent صحیح طبق سیاست OSM و fallback تایل SVG خنثی در قطعی کامل شبکه. (پروکسی قبلی Node.js در فرانت حذف و به همین اندپوینت 308 شد.)
- **اندپوینت وضعیت:** `GET /api/map/status` — وجود فایل، حجم، نسخه اسکیما و پینگ تایل نمونه (کش ۶۰ ثانیه).
- **فعال‌سازی روی Railway:** ۱) یک Volume حدود ۱ گیگابایتی (~$0.15/GB در ماه) به سرویس api وصل کنید با مونت‌پوینت `/data`؛ ۲) فایل mbtiles را یک‌بار داخل Volume بگذارید (Railway CLI یا کانتینر آپلود موقت)؛ ۳) متغیر محیطی `MBTILES_PATH=/data/iran-shortbread-1.0.mbtiles` را تنظیم کنید.
- **اگر فایل نباشد:** تایل‌ها ۴۰۴ می‌دهند و `mbtiles_present=false` برمی‌گردد → فرانت‌اند خودکار به پروکسی رستری لاراول سقوط می‌کند و نقشه بدون وقفه کار می‌کند.
- ⚠️ فایل ۶۵۰ مگابایتی **هرگز نباید در گیت کامیت شود** (در `.gitignore` ثبت شده) و روی Vercel هم قابل استقرار نیست (سقف ۲۵۰ مگابایت) — به همین دلیل تایل‌سرور حتماً سمت Railway است.

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
| `CACHE_STORE` / `SESSION_DRIVER` / `QUEUE_CONNECTION` | `redis` | سرویس Redis جدای Render (`golestani-redis` در Blueprint) + کلاینت PHP خالص predis؛ بدون Redis محلی به‌طور خودکار به `database` برمی‌گردد |
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

---

## ۴. انقضای خودکار اشتراک روی محیط مستقر (Phase 5)

Render در پلن **free** هیچ پردازشی برای اجرای scheduler لاراول ندارد و Cron Job سرویس Render از **۱ دلار در ماه** شروع می‌شود (`render.com/docs/cronjobs`)، بنابراین پلن فعلی نمی‌تواند فقط به `bootstrap/app.php` تکیه کند. سه مکانیزم مکمل و **رایگان** پیاده‌سازی شده است:

1. **در زمان بوت**: `api/docker/start.sh` پس از مایگریشن، `php artisan subscriptions:expire` را (به‌صورت غیرمخرب و idempotent) اجرا می‌کند؛ یعنی هر دیپلوی/ری‌استارت باقیمانده‌های منقضی را تسویه می‌کند. خطای این دستور بوت را متوقف نمی‌کند.
2. **به‌صورت Lazy روی هر خواندن**: `FeatureGate::settleLifecycle()` هنگام خواندن entitlement، ردیف‌های سررسیدشده‌ی همان کسب‌وکار را با قفل ردیف به `expired` می‌برد و اعلان `subscription_expired` را دقیقاً **یک‌بار** می‌سازد. پس حتی اگر هیچ زمان‌بندی بیرونی اجرا نشود، دسترسی پلنی بعد از مرز انقضا قطع می‌شود.
3. **زمان‌بندی بیرونی (اختیاری ولی توصیه‌شده)**: endpoint توکن‌محافظ
   `POST /api/internal/cron/expire-subscriptions` همین sweep را اجرا می‌کند. دو تریگر آماده است:

   - **Vercel Cron** — `web/vercel.json` (روزانه ۰۰:۱۰ UTC) + هندلر `web/src/app/api/cron/expire-subscriptions/route.ts`.
     متغیرهای لازم در پروژه‌ی Vercel: `CRON_SECRET` (خود Vercel هدر `Authorization: Bearer` را می‌فرستد) و `CRON_TOKEN` (همان راز مشترک سمت API).
   - **GitHub Actions** — `.github/workflows/subscription-expiry.yml` (روزانه ۰۰:۱۰ UTC + اجرای دستی).
     Secrets لازم: `CRON_TOKEN` (اجباری) و `RENDER_API_BASE_URL` (اختیاری؛ پیش‌فرض `https://one-ns2s.onrender.com`).

### فعال‌سازی (۲ دقیقه)

```bash
# ۱) ساخت راز مشترک
openssl rand -hex 32        # مقدار را در سه جا با نام CRON_TOKEN یکسان بگذارید
```

1. Render → سرویس `golestani-api` → Environment → `CRON_TOKEN` = مقدار بالا.
2. GitHub → Settings → Secrets and variables → Actions → `CRON_TOKEN` = همان مقدار (و در صورت نیاز `RENDER_API_BASE_URL`).
3. (اختیاری) Vercel → Project → Settings → Environment Variables → `CRON_TOKEN` = همان مقدار و `CRON_SECRET` = یک راز تازه (این یکی فقط برای خود Vercel است).

بدون تنظیم `CRON_TOKEN`، endpoint عمداً **۴۰۴** برمی‌گرداند (fail-closed) و مسیرهای ۱ و ۲ همچنان انقضا را تضمین می‌کنند.

### بررسی دستی

```bash
curl -sS -X POST "$API_BASE/api/internal/cron/expire-subscriptions" \
     -H "X-Cron-Token: $CRON_TOKEN" -H 'Accept: application/json'
# → {"ok":true,"expired":0}
```

اجرای دوباره باید همان `expired` را تغییر ندهد یا عدد کوچک‌تری برگرداند؛ اعلان تکراری ساخته نمی‌شود (قفل ردیف + `firstOrCreate`).
