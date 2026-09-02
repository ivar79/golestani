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
