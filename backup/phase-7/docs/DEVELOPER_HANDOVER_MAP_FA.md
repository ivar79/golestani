# نقشه تحویل توسعه‌دهنده

## معماری

پروژه monorepo است: `api/` یک Laravel API-only و `web/` یک Next.js App Router است. ارتباط frontend با API از `web/src/lib/api.ts` و Bearer token انجام می‌شود. داده اصلی در PostgreSQL/PostGIS و cache/queue در Redis است.

## نقشه قابلیت به فایل‌ها

- احراز هویت: `api/app/Http/Controllers/Api/Auth/AuthController.php`, `api/app/Services/Auth/OtpService.php`, `web/src/lib/auth.ts`, `web/src/contexts/AuthContext.tsx`
- نقش‌ها: `api/app/Traits/HasRoles.php`, `api/app/Http/Middleware/CheckRole.php`, `api/routes/api.php`
- کسب‌وکار: `api/app/Models/Business.php`, `api/app/Http/Controllers/Api/BusinessController.php`, `web/src/lib/businesses.ts`, `web/src/app/dashboard/page.tsx`
- جست‌وجوی مکانی: `api/app/Http/Controllers/Api/BusinessController.php`, `api/app/Http/Requests/Business/SearchBusinessRequest.php`, migration geometry، `web/src/components/search/`
- پروفایل عمومی: `api/app/Http/Controllers/Api/PublicBusinessController.php`, `web/src/app/b/[slug]/page.tsx`
- کارت‌ساز: `api/app/Models/BusinessCard.php`, `api/app/Http/Controllers/Api/BusinessCardController.php`, `web/src/app/card-maker/page.tsx`, `web/src/components/cards/CardCanvas.tsx`
- پلن/اشتراک/ویترین/تبلیغ: مدل‌ها و controllerهای هم‌نام در `api/app/`, `api/routes/api.php`
- مدیریت: `api/app/Http/Controllers/Api/AdminController.php`, `web/src/app/admin/page.tsx`, `web/src/lib/admin.ts`
- CMS: `SiteSetting`, `PageContent`, `Article`, `Media`, migration CMS و متدهای CMS در `AdminController.php`

## سناریوهای رایج تغییر

برای تغییر endpoint، route، request validation و controller همان feature را بررسی کنید و contract موجود را حفظ کنید. برای تغییر UI فقط page/component مربوط و `web/src/lib` مرتبط را ارسال کنید. برای تغییر schema migration جدید بسازید و migration قبلی را بازنویسی نکنید.

## فایل‌های حساس و مرکزی

- `api/routes/api.php`
- `api/app/Http/Controllers/Api/Auth/AuthController.php`
- `api/app/Http/Middleware/CheckRole.php`
- `api/app/Traits/HasRoles.php`
- `web/src/lib/api.ts`
- `web/src/contexts/AuthContext.tsx`
- migrationها
- `.env` و tokenها؛ هرگز ارسال یا commit نشوند.

## بسته فایل برای تغییرات متداول

- تغییر login: AuthController، OTP service/requests، `web/src/lib/auth.ts`، auth pages و tests
- تغییر moderation: AdminController، controller قبلی resource، routes، admin client/page و test
- تغییر public profile: PublicBusinessController، `web/src/app/b/[slug]/page.tsx` و client types
- تغییر CMS: مدل/migration مربوط، AdminController، route و admin client/UI
- تغییر deployment: `docker-compose.yml`، `.env.example`، deployment guide؛ بدون تغییر feature logic

## راهنمای همکاری AI

1. ابتدا checkpoint مرتبط و master document را بخوانید.
2. فقط فایل‌های لازم برای سناریو را inspect کنید.
3. contractهای API و نقش‌ها را حفظ کنید.
4. dependency جدید،
