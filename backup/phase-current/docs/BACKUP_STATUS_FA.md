# گزارش وضعیت Backup پروژه

**تاریخ به‌روزرسانی:** 2026-09-01

## وضعیت فازها

| Backup | وضعیت | توضیح |
|---|---|---|
| `backup/phase-1/` | آماده | شامل source، migration، seed، تست، تنظیمات و مستندات اصلی Phase 1 است. |
| `backup/phase-2/` | بازسازی شد | قبلاً موجود نبود؛ از implementation واقعی Phase 2 شامل Business، public profile، routes، migration، tests و مستندات بازسازی شد. |
| `backup/phase-3/` | آماده‌سازی مجدد | snapshot با فایل‌های مرتبط جست‌وجو، PostGIS، frontend و tests تهیه شد. |
| `backup/phase-4/` | آماده‌سازی مجدد | snapshot با card maker، designer، portfolio و migrations تهیه شد. |
| `backup/phase-5/` | آماده‌سازی مجدد | snapshot با plans، subscriptions، showcases، advertisements و migrations تهیه شد. |
| `backup/phase-6/` | آماده‌سازی مجدد | snapshot با admin API، admin UI، moderation و tests تهیه شد. |
| `backup/phase-6.1/` | آماده‌سازی مجدد | snapshot با CMS، blog، settings، SEO، media و migration تهیه شد. |
| `backup/phase-7/` | آماده‌سازی مجدد | snapshot hardening، تنظیمات deployment، documentation و migrationها تهیه شد. |
| `backup/phase-current/` | به‌روزرسانی شد | از source فعلی پروژه با allowlist و بدون secret ساخته شد. |
| `backup/revenue-mvp/` | به‌روزرسانی شد | از source فعلی Revenue MVP با allowlist و بدون secret ساخته شد. |

## فایل‌های بازیابی‌شده Phase 2

- `api/app/Models/Business.php`
- `api/app/Http/Controllers/Api/BusinessController.php`
- `api/app/Http/Controllers/Api/PublicBusinessController.php`
- `api/app/Http/Requests/Business/BusinessRequest.php`
- `api/database/migrations/2026_08_29_000001_create_businesses_table.php`
- `api/routes/api.php`
- `api/tests/Feature/BusinessTest.php`
- `web/src/lib/businesses.ts`
- `web/src/app/b/[slug]/page.tsx`

## سیاست حذف فایل‌های ممنوع

Backupهای بازسازی‌شده فقط فایل‌های مرتبط source، migration، tests، configuration غیرحساس و documentation را شامل می‌شوند. موارد زیر حذف یا مستثنی شده‌اند:

- `.env` و credentialها
- API key و token
- `node_modules`
- `vendor`
- `.next` و build output
- cacheها و فایل‌های موقت

## نکته

Backup قدیمی `backup/phase-1-stable/` همچنان برای مرجع تاریخی باقی مانده است؛ snapshotهای canonical فازها از این پس `backup/phase-1/` تا `backup/phase-7/` هستند.
