# گزارش ممیزی واقعی پروژه — REAL PROJECT AUDIT

**تاریخ ممیزی:** ۱۴۰۵/۰۶/۱۰

این گزارش بر اساس کد جاری، routeها، migrationها، مدل‌ها، درخواست‌های validation، frontend و checkpointهای موجود تهیه شده است. checkpointهای canonical فازهای ۱، ۲ و ۷ قبلاً در docs موجود نبودند و وضعیت آن‌ها با صراحت ثبت شد.

## Phase 1 — Authentication

**پیاده‌سازی‌شده:** OTP با rate limit سرویس و route، نرمال‌سازی ارقام فارسی، ایجاد کاربر و role پیش‌فرض، Sanctum token، logout، `auth:sanctum`، `role` middleware و abstractionهای `SmsProviderInterface`/`SmsService`.

**ناقص و ریسک:** مسیر emergency admin مستقل وجود ندارد؛ `LogSmsDriver` کد را لاگ نمی‌کند؛ expiration توکن به تنظیمات Sanctum وابسته است.

## Phase 2 — Business/Profile

**پیاده‌سازی‌شده:** CRUD مالک‌محور، slug، lifecycle moderation، public approved profile و QR.

**اصلاح این ممیزی:** `GET /businesses/{business}` اکنون owner/admin scoped است و IDOR قبلی رفع شد.

## Phase 3 — Search/Location

**پیاده‌سازی‌شده:** approved-only search، جست‌وجوی متن، city/neighborhood/category، PostGIS geometry با SRID 4326 و GIST، radius، distance، nearest و pagination.

**ناقص:** taxonomy مستقل، rating/open رسمی و map provider واقعی در schema وجود ندارد؛ fallback غیر PostgreSQL فاصله را محاسبه نمی‌کند.

## Phase 4 — Card/Designer

Template محدود، export سمت کلاینت، designer و portfolio موجود است. حذف portfolio فایل storage را حذف نمی‌کند و media serializer عمومی کامل نیست.

## Phase 5 — Revenue

Plan، subscription دستی receipt، feature gate، showcase و تبلیغات محدود وجود دارد. درگاه واقعی، webhook، reconciliation و expiry job وجود ندارد.

## Phase 6 — Admin

Overview، users و صف‌های moderation وجود دارند. audit log، rejection workflow کامل و role assignment UI ناقص‌اند.

## Phase 6.1 — CMS

Settings، pages، articles، SEO/OG و media upload API موجود است. UI کامل blog/page/media و public article delivery محدود است.

## Phase 7 — Hardening/Deployment

Revocation توکن هنگام login، deployment/handover docs و backupها موجودند. 2FA ادمین، audit logging و malware scanning باقی مانده‌اند.

## یافته‌ها و اصلاحات بحرانی

- owner/admin authorization برای business show اضافه شد.
- `verified=false` در search اکنون واقعاً فیلتر می‌شود.
- کلید CMS و slug مقاله validate می‌شوند و slug تکراری رد می‌شود.
- public profile فقط approved و فیلدهای عمومی را برمی‌گرداند.
- uploadها MIME/size validation و storage path دارند؛ malware scanning باقی است.

## تست واقعی

- Frontend lint/typecheck/build: PASS.
- Docker PostgreSQL/PostGIS PHPUnit: **103 passed, 239 assertions**.
- Host PHPUnit به دلیل نبود SQLite PDO معیار قابل اتکا نیست.

## نتیجه

MVP برای staging آماده است، اما production-ready کامل محسوب نمی‌شود تا محدودیت‌های payment، taxonomy، map، 2FA، audit، malware scanning، browser/load tests و CMS عمومی تعیین تکلیف شوند.
