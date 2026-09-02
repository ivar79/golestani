# راهنمای استقرار Inkart

## پیش‌نیازها

- PHP 8.3 و Composer
- Laravel 12
- PostgreSQL 16 به همراه PostGIS 3.4
- Redis 7
- Node.js سازگار با Next.js 16 و npm
- وب‌سرور معکوس با HTTPS در محیط واقعی

## تنظیمات Backend

فایل `api/.env` را فقط روی سرور ایجاد کنید و هرگز commit نکنید. متغیرهای اصلی:

- `APP_ENV=production`
- `APP_DEBUG=false`
- `APP_KEY` مقدار تولیدشده با `php artisan key:generate`
- `APP_URL` آدرس HTTPS API
- `DB_CONNECTION=pgsql`
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
- `DB_SSLMODE` در صورت نیاز زیرساخت
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `CACHE_STORE=redis`
- `QUEUE_CONNECTION=redis`
- `SESSION_DRIVER=redis`
- `FILESYSTEM_DISK=local` یا دیسک S3-compatible با دسترسی محدود
- `SMS_DRIVER` و تنظیمات درگاه پیامک؛ در توسعه `log` مجاز است، در تولید باید driver واقعی تنظیم شود.

در تولید مقدارهای توسعه‌ای مانند `APP_DEBUG=true`، رمزهای نمونه و `MAIL_*` آزمایشی استفاده نشود.

## تنظیمات Frontend

متغیر `NEXT_PUBLIC_API_URL` باید به آدرس عمومی API با HTTPS اشاره کند. سپس:

```bash
cd web
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm start
```

## راه‌اندازی Backend

```bash
cd api
composer install --no-dev --optimize-autoloader
php artisan config:cache
php artisan route:cache
php artisan migrate --force
php artisan storage:link
php artisan queue:work redis --sleep=3 --tries=3
```

قبل از migration اتصال PostgreSQL و فعال بودن PostGIS را بررسی کنید. سرویس Queue باید با supervisor/systemd یا معادل کانتینری پایدار اجرا شود.

## ذخیره‌سازی و فایل‌ها

فایل‌های آپلودی باید روی دیسک محدود و با validation واقعی MIME ذخیره شوند. برای production ترجیحاً S3-compatible با bucket خصوصی، محدودیت اندازه، اسکن بدافزار و URL موقت استفاده شود. فایل `.env` و tokenها هرگز در backup یا repository قرار نگیرند.

## Backup و Restore

- از PostgreSQL به‌صورت روزانه backup رمزگذاری‌شده بگیرید و چند نسخه خارج از سرور اصلی نگه دارید.
- از volumeهای storage و تنظیمات deployment جداگانه backup بگیرید.
- نمونه backup:

```bash
pg_dump --format=custom --no-owner --file=backup.dump "$DATABASE_URL"
```

- نمونه restore:

```bash
createdb golestani_restore
pg_restore --clean --if-exists --no-owner --dbname=golestani_restore backup.dump
```

پس از restore، وجود extension PostGIS، اجرای migrationهای باقی‌مانده و دسترسی سرویس‌ها را بررسی کنید.

## استقرار ایمن

1. از نسخه فعلی و database backup تهیه کنید.
2. release جدید را جداگانه build کنید.
3. `php artisan migrate --force` را اجرا کنید.
4. cache/config/route را refresh کنید.
5. workerها را restart کنید.
6. health endpoint و login با OTP را بررسی کنید.
7. rollback را با release قبلی و backup آزمایش کنید.

## وضعیت تست

تست‌های frontend قابل اجرا هستند. PHPUnit در محیط فعلی به‌دلیل نبود SQLite PDO کامل اجرا نشده و باید در Docker/PostgreSQL پروژه اجرا شود؛ این تست‌ها Pass محسوب نمی‌شوند.


## عیب‌یابی مرحله‌ای فازها

### فاز ۱ — احراز هویت
- `DB_CONNECTION=pgsql`، Redis و `APP_KEY` معتبر را بررسی کنید.
- `POST /api/auth/send-otp` باید 200 یا rate-limit 429 برگرداند و driver پیامک مطابق `SMS_DRIVER` فعال باشد.
- `POST /api/auth/verify-otp` باید Bearer token بدهد؛ token را در log یا URL قرار ندهید.
- نقش‌های `user`، `business_owner` و `admin` و middleware `role` را بررسی کنید.

### فاز ۲ — کسب‌وکار و پروفایل عمومی
- migrationها را به‌ترتیب اجرا کنید.
- ایجاد/ویرایش باید فقط برای مالک یا admin مجاز باشد.
- پروفایل عمومی فقط برای status برابر `approved` قابل مشاهده است.

### فاز ۳ — جست‌وجو و مکان
- وجود PostGIS و ستون `geom geometry(Point,4326)` و index نوع GIST را بررسی کنید.
- جست‌وجوی بدون مختصات باید بدون PostGIS function کار کند.
- جست‌وجوی radius باید روی PostgreSQL/PostGIS اجرا و distance را برگرداند.
- فقط کسب‌وکارهای approved در نتایج عمومی باشند.

### فاز ۴ — کارت و طراح
- دسترسی card فقط برای مالک/admin باشد.
- upload با MIME واقعی و محدودیت حجم بررسی شود.
- export کارت در browser انجام می‌شود و فایل اجرایی روی سرور ذخیره نمی‌شود.

### فاز ۵ — درآمد MVP
- پلن فعال، receipt reference و moderation دستی را بررسی کنید.
- هیچ IPG یا webhook فعالی وجود ندارد.
- FeatureGate باید subscription منقضی‌شده را غیرفعال بداند.

### فاز ۶ و ۶.۱ — Admin و CMS
- `/admin` در frontend نقش admin را بررسی می‌کند و API نیز middleware سروری دارد.
- تنظیمات homepage از `SiteSetting` خوانده می‌شوند.
- مقاله، صفحه، SEO و media باید با validation و upload محدود مدیریت شوند.

### فاز ۷ — استقرار و امنیت
- `APP_DEBUG=false`، HTTPS، secret manager، backup رمزگذاری‌شده و worker پایدار را بررسی کنید.
- تست کامل را در Docker اجرا کنید، نه با SQLite host.
- قبل از release از database و storage snapshot بگیرید و rollback را آزمایش کنید.

## وضعیت تأیید فعلی

Frontend lint/typecheck/build موفق است. تست Feature backend در Docker/PostgreSQL معیار اصلی است؛ در صورت نبود Docker، PHPUnit host به‌دلیل SQLite PDO قابل تأیید کامل نیست.
