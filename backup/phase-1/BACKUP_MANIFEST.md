# Phase 1 Backup — Golestani (اینکارت)

**تاریخ ساخت:** 2026-09-03
**دامنه:** فقط Phase 1 (Authentication) — بدون هیچ فایل یا وابستگی از Phase 2 و بعد.

## محدوده Phase 1 در این بکاپ

- **Backend (Laravel 12):** احراز هویت OTP (send/verify)، Sanctum token، logout، `/me`، RBAC (Role/CheckRole/HasRoles)، سرویس SMS با driver abstraction (Log/Http)، seeders و migrationهای مربوط به users/roles/tokens/cache/jobs، tests کامل Auth/RBAC/Security.
- **Frontend (Next.js 16):** صفحات ورود/OTP، AuthContext، API client، صفحه اصلی و کامپوننت‌های home/landing، layout عمومی، صفحات about/contact/privacy، فونت Vazirmatn (self-hosted).
- **Infra:** `docker-compose.yml`، `docker/php/Dockerfile`.

## نسخه مبنا

فایل‌های کد Phase 1 بر اساس وضعیت تاریخی Phase 1 پروژه هستند (برابر با `backup/phase-1-stable` به‌عنوان مرجع تاریخی). فایل‌های اشتراکی که بعداً در فازهای ۲+ تغییر کرده‌اند، عمداً نسخه قدیمی (Phase-1-era) خود را نگه داشته‌اند.

## Self-contained بودن

این بکاپ برای restore مستقل طراحی شده است:

- تمام importهای PHP و TypeScript داخل خود بکاپ resolve می‌شوند (بررسی‌شده).
- `web/package-lock.json` با `web/package.json` هماهنگ است (بدون leaflet/html-to-image که به Phase 3/4 تعلق دارند).
- `api/routes/api.php` فقط routeهای Phase 1 را تعریف می‌کند.
- Migrationهای Business/Designers/Cards/Plans/etc. (فازهای ۲+) عمداً **موجود نیستند**.

## Restore

1. **Backend:**
   ```bash
   cp api/.env.example api/.env   # سپس مقادیر DB/Redis را تنظیم کنید
   cd api && composer install && php artisan key:generate
   php artisan migrate --seed
   php artisan test
   ```
2. **Frontend:**
   ```bash
   cd web && npm install && npm run build
   ```

## موارد عمداً حذف‌شده

- `.env` واقعی، credential، API key — این بکاپ هیچ secret ندارد.
- `node_modules`، `vendor`، `.next`
- فایل‌های تولیدشده (`bootstrap/cache/packages.php`, `services.php`) — Laravel خودش می‌سازد.
- هر فایل یا migration متعلق به Phase 2 (Business)، Phase 3 (Search/Location)، Phase 4 (Card/Designer)، Phase 5 (Revenue)، Phase 6 (Admin)، Phase 6.1 (CMS)، Phase 7.

## نکته شناخته‌شده (غیرمسدودکننده)

- پکیج `endroid/qr-code` در `composer.json`/`composer.lock` باقی مانده است. هیچ کدی در این بکاپ به آن ارجاع نمی‌دهد؛ فقط برای حفظ هماهنگی composer.lock با نسخه تاریخی Phase 1 دست‌نخورده ماند و در `composer install` نصب می‌شود ولی استفاده‌ای ندارد.
