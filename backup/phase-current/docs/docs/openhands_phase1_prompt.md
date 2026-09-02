# پرامپت آماده برای OpenHands — فاز ۱ گلستانی
## (همه سوالات باز پاسخ داده شده — بدون توقف برای تصمیم‌گیری)

---

```
نقش تو: AI Developer مسئول ساخت واقعی فاز ۱ از ۷ فاز پروژهٔ «سامانهٔ معرفی و جست‌وجوی کسب‌وکارها» (پروژه گلستانی).

تو روی Workspace واقعی کاربر کار می‌کنی. مسیر پروژه دقیقاً همانجا که این فایل‌ها وجود دارند است.
تمام تصمیمات فنی باز پیش از شروع پاسخ داده شده‌اند — هیچ سوالی متوقفت نخواهد کرد.

===========================================================
۰. Workspace — اولین اقدام اجباری
===========================================================
مسیر Workspace: /workspace/golestani/ (یا مسیری که OpenHands پروژه را mount کرده)
۱) Tree کامل را چاپ کن.
۲) بررسی کن هیچ workspace موازی نیست.
۳) اگر docs/DECISION_LOG.md وجود دارد، وضعیت فعلی را از آن بخوان.
۴) هرگز خارج از این مسیر فایل نساز.

===========================================================
۱. پشته فنی ثابت (تغییرناپذیر)
===========================================================
Frontend : Next.js 16 + TypeScript + Tailwind CSS + App Router
Backend  : Laravel 12 + PHP 8.3 + Laravel Sanctum (Bearer Token)
Database : PostgreSQL 16 + PostGIS 3.4
Cache    : Redis 7
Auth     : OTP پیامکی → Sanctum Bearer Token

===========================================================
۲. تصمیمات فنی باز — همه پاسخ داده شده‌اند (نیاز به توقف نداری)
===========================================================

▸ سرویس پیامک OTP:
  پیش‌فرض: Mock/Log Driver (OTP در log فایل چاپ می‌شود)
  کلاس Interface بساز: SmsServiceInterface با متد sendOtp(string $phone, string $code): void
  پیاده‌سازی: LogSmsDriver (implements SmsServiceInterface) — فقط Log::info می‌کند
  ساختار باید طوری باشد که بعداً فقط یک Driver جدید (مثل KavenegarDriver) اضافه شود
  و در config/sms.php تنظیم شود — بدون تغییر در کد اصلی.

▸ Session/Auth مکانیزم:
  تصمیم: Laravel Sanctum — Token-based (Bearer Token) — نه Cookie، نه SPA Session
  دلیل: جلوگیری از مشکلات CORS بین localhost:3000 و localhost:8000

▸ نقش‌های کاربر (RBAC):
  ۴ نقش ثابت (seed شوند):
  - admin         → دسترسی کامل به همه Endpointها
  - business_owner → مدیریت پروفایل کسب‌وکار خودش
  - designer       → پروفایل طراح، ثبت نمونه‌کار
  - user           → نقش پیش‌فرض — جست‌وجو و مشاهده

  پیاده‌سازی: جدول roles + جدول role_user (Many-to-Many)
  هر کاربر می‌تواند یک نقش اصلی داشته باشد.
  Middleware: CheckRole که role name را بررسی می‌کند.

▸ Redis — موارد استفاده در فاز ۱:
  - ذخیره OTP (کلید: otp:{phone}, مقدار: hash کد, TTL: 120 ثانیه)
  - Cache Driver پیش‌فرض Laravel
  - Queue Driver (برای Job های آینده آماده شود)

▸ PostGIS:
  فعال‌سازی با migration: DB::statement('CREATE EXTENSION IF NOT EXISTS postgis;')
  در این فاز فقط Extension فعال شود — geometry column ها در فاز ۳ اضافه می‌شوند.

===========================================================
۳. چک‌لیست امنیتی فاز ۱ (هم‌زمان با کدنویسی)
===========================================================
- OTP: محدودیت ۵ تلاش نادرست → قفل ۱۵ دقیقه‌ای (Redis key: otp_attempts:{phone})
- OTP: حداکثر ۳ درخواست ارسال مجدد در ۱۰ دقیقه (Redis key: otp_send_count:{phone})
- Rate Limiting: روی /api/auth/send-otp → throttle:3,10 (3 بار در 10 دقیقه)
- Rate Limiting: روی /api/auth/verify-otp → throttle:5,15
- Session Fixation: چون Stateless Bearer Token داریم، این مشکل وجود ندارد
- SQL Injection: فقط Eloquent ORM — هیچ raw query بدون binding نداشته باشیم
- Authorization: Middleware CheckRole روی تمام Route های حساس از همان ابتدا

===========================================================
۴. Step Breakdown دقیق — ترتیب اجباری
===========================================================

STEP 1: بررسی ساختار موجود
  - Tree کامل پروژه را چاپ کن
  - محتوای api/routes/api.php را بخوان
  - محتوای api/app/Models/User.php را بخوان
  - وضعیت docker-compose.yml را بررسی کن

STEP 2: ساختار دایرکتوری‌های Backend
  ساختار زیر را در api/app/ ایجاد کن:
  - Services/Sms/SmsServiceInterface.php
  - Services/Sms/LogSmsDriver.php
  - Services/Auth/OtpService.php
  - Http/Controllers/Api/Auth/AuthController.php
  - Http/Requests/Auth/SendOtpRequest.php
  - Http/Requests/Auth/VerifyOtpRequest.php
  - Http/Middleware/CheckRole.php

STEP 3: Migration های اساسی
  بساز:
  a) Migration برای اضافه کردن فیلدهای لازم به users table:
     - phone (string, unique, nullable) — جایگزین یا کنار email
     - is_active (boolean, default: true)
  b) Migration برای جدول roles:
     - id, name (string, unique), display_name (string), created_at, updated_at
  c) Migration برای جدول role_user (pivot):
     - user_id, role_id
  d) Migration فعال‌سازی PostGIS:
     DB::statement('CREATE EXTENSION IF NOT EXISTS postgis;');

STEP 4: Models و Relationships
  - User.php را آپدیت کن: اضافه کردن رابطه roles(), متد hasRole(string $role): bool
  - Role.php بساز با رابطه users()
  - HasRoles trait بساز برای User

STEP 5: Database Seeder
  RoleSeeder بساز که ۴ نقش را ایجاد کند: admin, business_owner, designer, user
  AdminSeeder بساز که یک کاربر admin با شماره موبایل 09000000000 ایجاد کند (برای تست)

STEP 6: Config و ServiceProvider
  - config/sms.php بساز:
    return ['driver' => env('SMS_DRIVER', 'log'), 'drivers' => ['log' => LogSmsDriver::class]];
  - SmsServiceProvider.php بساز که SmsServiceInterface را bind کند
  - در config/app.php providers آن را ثبت کن

STEP 7: OtpService
  پیاده‌سازی در Services/Auth/OtpService.php:
  - generateCode(): string → کد ۵ رقمی تصادفی
  - store(string $phone, string $code): void → Redis با TTL 120
  - verify(string $phone, string $code): bool → مقایسه + حذف پس از تأیید
  - checkRateLimit(string $phone): bool → بررسی تعداد تلاش

STEP 8: AuthController و Routes
  POST /api/auth/send-otp:
    - Validate: phone (required, regex Iran: /^09[0-9]{9}$/)
    - بررسی Rate Limit ارسال
    - تولید کد، ذخیره در Redis، ارسال با SmsServiceInterface
    - Response: { message: "کد ارسال شد", expires_in: 120 }

  POST /api/auth/verify-otp:
    - Validate: phone, code (5 digits)
    - بررسی Rate Limit تلاش‌های نادرست
    - تأیید OTP از Redis
    - اگر کاربر جدید بود: ایجاد + assign نقش 'user'
    - صدور Sanctum Bearer Token
    - Response: { token: "...", token_type: "Bearer", user: { id, phone, roles } }

  POST /api/auth/logout (نیاز به Auth middleware):
    - Revoke token جاری
    - Response: { message: "خروج موفق" }

  GET /api/auth/me (نیاز به Auth middleware):
    - اطلاعات کاربر جاری + نقش‌ها

STEP 9: Middleware CheckRole
  ایجاد CheckRole middleware که پارامتر role name بگیرد:
  Route::middleware(['auth:sanctum', 'role:admin'])->group(...)

STEP 10: ساختار اولیه Next.js Frontend
  در web/src/ ایجاد کن:
  - lib/api.ts → axios instance با baseURL از env
  - lib/auth.ts → توابع sendOtp, verifyOtp, logout, getMe
  - types/auth.ts → TypeScript types
  - app/(auth)/login/page.tsx → صفحه ورود با شماره موبایل (RTL فارسی)
  - app/(auth)/otp/page.tsx → صفحه وارد کردن کد OTP
  - contexts/AuthContext.tsx → global auth state
  - components/auth/PhoneInput.tsx → input شماره موبایل ایرانی
  - components/auth/OtpInput.tsx → input ۵ خانه جدا برای کد OTP
  - middleware.ts → Route Guard: redirect به /login اگر token نباشد

STEP 11: تست‌های PHPUnit/Pest
  بساز در tests/Feature/Auth/:
  - SendOtpTest.php: تست ارسال OTP، Rate Limit، فرمت شماره غیرمعتبر
  - VerifyOtpTest.php: تست تأیید صحیح، تأیید نادرست، انقضا، تولید token

STEP 12: آپدیت DECISION_LOG.md
  فایل docs/DECISION_LOG.md را با تمام تصمیمات این فاز آپدیت کن.

===========================================================
۵. قوانین Approval Gate — فقط در این موارد متوقف شو
===========================================================
۱) عملیات Git واقعی (commit/push/tag) → توقف، فقط diff را آماده کن
۲) افزودن Dependency جدید (composer/npm) → توقف، پیشنهاد بده
۳) عملیات مخرب (drop table، حذف گسترده فایل) → توقف کامل
۴) تغییر معماری یا پشته فنی → توقف کامل

در غیر این موارد: پیوسته کار کن، متوقف نشو.

===========================================================
۶. خروجی موردنظر پایان فاز ۱
===========================================================
✓ docker-compose up کار می‌کند
✓ php artisan migrate --seed بدون خطا اجرا می‌شود
✓ POST /api/auth/send-otp → OTP در log.laravel.log چاپ می‌شود
✓ POST /api/auth/verify-otp → Bearer Token برمی‌گردد
✓ GET /api/auth/me با Token → اطلاعات کاربر + نقش برمی‌گردد
✓ صفحه /login در Next.js نمایش داده می‌شود و با API ارتباط برقرار می‌کند
✓ همه تست‌های PHPUnit pass می‌شوند

===========================================================
اکنون شروع کن: ابتدا STEP 1 را اجرا کن و گزارش بده، سپس بدون توقف STEP به STEP پیش برو.
===========================================================
```
