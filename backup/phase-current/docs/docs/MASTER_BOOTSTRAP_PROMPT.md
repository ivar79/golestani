# GOLESTANI PROJECT — MASTER BOOTSTRAP PROMPT
## برای دادن به هر AI Agent یا مدل جدید

---

## 🔴 اول این را بخوان — قبل از هر کاری

تو در حال کار روی یک پروژه نرم‌افزاری واقعی هستی که نیمه‌تمام است.
پروژه یک فایل‌سیستم واقعی دارد. **همه کدها باید روی همین فایل‌ها نوشته شوند.**
هیچ چیزی در حافظه یا session نگه نمی‌داری — همه چیز باید فایل شود.

---

## ۱. اول این فایل‌ها را به ترتیب بخوان (قبل از هر کد نوشتن)

```
مسیر پروژه: [هرجایی که این workspace mount شده]/
```

**ترتیب خواندن اجباری:**

```
1. docs/PROJECT_OVERVIEW.md          ← درک کلی پروژه
2. docs/DEVELOPMENT_ROADMAP.md       ← ۷ فاز و timeline
3. docs/SYSTEM_ARCHITECTURE.md       ← معماری کلی
4. docs/PHASE_1_TECHNICAL_DECISIONS.md ← تمام تصمیمات فنی قفل‌شده
5. docs/PHASE_1_EXECUTION_CHECKLIST.md ← چک‌لیست اجرایی فاز ۱
6. docs/PHASE_1_READINESS_REPORT.md  ← وضعیت آمادگی و سوالات باز
7. docs/DECISION_LOG.md              ← اگر وجود دارد، تصمیمات قبلی را بخوان
8. docker-compose.yml                ← ببین چه سرویس‌هایی تعریف شده
9. api/composer.json                 ← وضعیت backend
10. web/package.json                 ← وضعیت frontend
```

پس از خواندن همه این فایل‌ها، یک خلاصه ۵ خطی از آنچه فهمیدی بنویس، سپس ادامه بده.

---

## ۲. معرفی پروژه (خلاصه)

**نام:** سامانه معرفی و جست‌وجوی کسب‌وکارها (گلستانی)
**نوع:** پلتفرم وب برای معرفی کسب‌وکارهای محلی در ایران
**مدل کار:** قرارداد ۴۵ روز کاری، ۷ فاز، تحویل به کارفرما

**کاربران سیستم:**
- `user` → کاربر عادی (جست‌وجو و مشاهده)
- `business_owner` → صاحب کسب‌وکار (مدیریت پروفایل)
- `designer` → طراح (کارت‌ویزیت، پروفایل طراح)
- `admin` → مدیر کل سیستم

**ویژگی‌های کلیدی:**
- ثبت‌نام/ورود با OTP پیامکی
- پروفایل کسب‌وکار با موقعیت GPS
- جست‌وجوی شعاعی با PostGIS
- کارت‌ویزیت‌ساز (حداقل ۳ قالب)
- سیستم اشتراک و پلن
- پنل مدیریت مرکزی (Filament)

---

## ۳. پشته فنی (تغییرناپذیر — هرگز تغییر نده)

```
Frontend  : Next.js 16 + TypeScript + Tailwind CSS + App Router
Backend   : Laravel 12 + PHP 8.3 (API-Only, بدون Blade)
Auth      : Laravel Sanctum — Bearer Token (نه Cookie، نه SPA Session)
Database  : PostgreSQL 16 + PostGIS 3.4
Cache/Queue: Redis 7
Admin Panel: Laravel Filament (فاز ۶)
ساختار   : Monorepo → /api + /web + /docker + /docs
```

---

## ۴. تمام سوالات فنی باز — پاسخ داده شده‌اند (نیاز به توقف نداری)

### ۴.۱ سرویس پیامک OTP
```
وضعیت فعلی: SMS API key از کارفرما دریافت نشده
راه‌حل: Mock/Log Driver — OTP را در storage/logs/laravel.log چاپ کن

پیاده‌سازی الزامی (Interface-based برای تعویض آسان بعداً):
- app/Services/Sms/Contracts/SmsServiceInterface.php
  متد: public function send(string $phone, string $message): bool;
- app/Services/Sms/Drivers/LogSmsDriver.php
  پیاده‌سازی: فقط Log::info("OTP for {$phone}: {$code}") + return true;
- config/sms.php
  return ['driver' => env('SMS_DRIVER', 'log')];
- App\Providers\SmsServiceProvider → bind SmsServiceInterface به driver انتخابی

بعداً: فقط یک Driver جدید (KavenegarDriver) اضافه می‌شود + SMS_DRIVER=kavenegar در .env
```

### ۴.۲ مکانیزم Auth
```
تصمیم: Sanctum Bearer Token — stateless
دلیل: جلوگیری از مشکلات CORS بین ports مختلف (3000 و 8000)
هرگز: cookie-based SPA session نساز
```

### ۴.۳ ماتریس نقش‌ها (RBAC)
```
۴ نقش ثابت — seed شوند:
┌─────────────────┬────────────────────────────────────────────┐
│ نام نقش         │ دسترسی                                     │
├─────────────────┼────────────────────────────────────────────┤
│ admin           │ همه Endpointها                              │
│ business_owner  │ CRUD پروفایل کسب‌وکار خودش                 │
│ designer        │ پروفایل طراح + نمونه‌کار                   │
│ user            │ جست‌وجو + مشاهده (نقش پیش‌فرض)             │
└─────────────────┴────────────────────────────────────────────┘

پیاده‌سازی:
- جدول roles: id, name, display_name, timestamps
- جدول role_user: user_id, role_id (pivot)
- User Model: رابطه roles() BelongsToMany
- متد کمکی: user->hasRole('admin')
- Middleware: CheckRole('admin') → 403 اگر نقش نداشت
```

### ۴.۴ Redis — موارد استفاده در فاز ۱
```
- OTP Cache: key="otp:{phone}", value=hashed_code, TTL=120s
- OTP Attempts: key="otp_attempts:{phone}", value=count, TTL=900s (15 دقیقه)
- OTP Send Count: key="otp_send:{phone}", value=count, TTL=600s (10 دقیقه)
- CACHE_DRIVER=redis
- QUEUE_CONNECTION=redis (آماده برای فازهای بعد)
- SESSION_DRIVER=redis (اگرچه stateless هستیم، برای Queue worker لازم است)
```

### ۴.۵ PostGIS در فاز ۱
```
فقط فعال‌سازی Extension — بدون geometry column:
Migration: DB::statement('CREATE EXTENSION IF NOT EXISTS postgis;');
Geometry columnها در فاز ۳ اضافه می‌شوند.
```

### ۴.۶ ذخیره‌سازی فایل (فاز ۲ به بعد)
```
پیش‌فرض: Local Storage (storage/app/public/)
ساختار باید Interface-based باشد تا بعداً به S3-compatible سوئیچ شود.
```

### ۴.۷ Admin Panel (فاز ۶)
```
تأیید شده: Laravel Filament
دلیل: تنها راه ارائه ۱۶+ صفحه CRUD در ۷ روز
در فاز ۱: فقط User و Role model را طوری بساز که با Filament سازگار باشد.
```

### ۴.۸ کارت‌ساز (فاز ۴)
```
خروجی: Digital (PNG/JPG) — نه PDF چاپی با CMYK
فناوری: html-to-image یا html2canvas (client-side)
محدودیت customization: dropdown از پیش‌تعریف‌شده (نه free-form color picker)
```

### ۴.۹ نقشه (فاز ۳)
```
پیش‌فرض: Leaflet.js با OpenStreetMap tiles (رایگان، بدون API key)
قابل تغییر: اگر کارفرما Map.ir یا نشان را تأیید کرد، فقط tile URL تغییر می‌کند.
```

### ۴.۱۰ پرداخت (فاز ۵)
```
MVP: فقط رسید دستی (شماره پیگیری + تأیید admin)
درگاه آنلاین: خارج از Scope MVP — هرگز در این پروژه پیاده نکن مگر دستور صریح.
```

---

## ۵. قوانین کار (Approval Gate)

**فقط در این ۴ حالت متوقف شو و منتظر تأیید بمان:**

| وضعیت | اقدام |
|--------|-------|
| Git commit/push/merge/tag | diff و پیام commit را آماده کن، متوقف شو |
| Dependency جدید (composer/npm) | پیشنهاد بده، متوقف شو |
| Drop table / حذف گسترده فایل | متوقف شو، گزارش بده |
| تغییر پشته فنی یا معماری | متوقف شو، هرگز تغییر نده |

**در همه موارد دیگر: بدون توقف ادامه بده.**
نوشتن کد، ساخت فایل، رفع باگ، نوشتن تست — همه بدون توقف.

---

## ۶. قوانین امنیتی (هم‌زمان با کدنویسی — نه بعداً)

```
- OTP Rate Limit:
  ارسال: حداکثر ۳ بار در ۱۰ دقیقه (per phone)
  تأیید: حداکثر ۵ تلاش در ۱۵ دقیقه (per phone) → بعد قفل

- SQL: فقط Eloquent ORM — هیچ raw query بدون binding

- File Upload (فاز ۲+):
  MIME بررسی واقعی (نه پسوند)
  ذخیره خارج از public web root
  نام فایل sanitize شود

- Authorization:
  هر endpoint از همان ابتدا middleware داشته باشد
  هیچ endpoint بدون auth guard نباشد (مگر public route های صریح)

- XSS: همه ورودی کاربر escape شود قبل از نمایش
```

---

## ۷. ساختار فایل‌های کد که باید بسازی (فاز ۱)

### Backend (api/)
```
app/
├── Services/
│   ├── Sms/
│   │   ├── Contracts/SmsServiceInterface.php
│   │   └── Drivers/LogSmsDriver.php
│   └── Auth/
│       └── OtpService.php
├── Http/
│   ├── Controllers/Api/Auth/
│   │   └── AuthController.php
│   ├── Requests/Auth/
│   │   ├── SendOtpRequest.php
│   │   └── VerifyOtpRequest.php
│   └── Middleware/
│       └── CheckRole.php
├── Models/
│   ├── User.php         (بروزرسانی)
│   └── Role.php         (جدید)
└── Providers/
    └── SmsServiceProvider.php

config/
└── sms.php

database/
├── migrations/
│   ├── xxxx_add_phone_to_users_table.php
│   ├── xxxx_create_roles_table.php
│   ├── xxxx_create_role_user_table.php
│   └── xxxx_enable_postgis_extension.php
└── seeders/
    ├── RoleSeeder.php
    └── AdminUserSeeder.php    (شماره: 09000000000)

routes/
└── api.php   (routes را اینجا تعریف کن)
```

### Frontend (web/src/)
```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── otp/page.tsx
├── (dashboard)/
│   └── layout.tsx        (Route Guard)
└── layout.tsx

components/
├── auth/
│   ├── PhoneInput.tsx
│   └── OtpInput.tsx
└── ui/                   (shared components)

lib/
├── api.ts                (axios instance)
└── auth.ts               (sendOtp, verifyOtp, logout, getMe)

types/
└── auth.ts               (TypeScript types)

contexts/
└── AuthContext.tsx

middleware.ts             (Next.js Route Guard)
```

---

## ۸. API Endpoints فاز ۱

```
POST   /api/auth/send-otp
       body: { phone: "09123456789" }
       response: { message: "کد ارسال شد", expires_in: 120 }
       rate_limit: 3 per 10 minutes

POST   /api/auth/verify-otp
       body: { phone: "09123456789", code: "12345" }
       response: { token: "...", token_type: "Bearer", user: {id, phone, roles} }
       rate_limit: 5 per 15 minutes

POST   /api/auth/logout           [auth:sanctum]
       response: { message: "خروج موفق" }

GET    /api/auth/me               [auth:sanctum]
       response: { id, phone, roles: [...], created_at }
```

---

## ۹. Acceptance Criteria — فاز ۱ کامل است وقتی:

```
✓ docker-compose up -d اجرا می‌شود بدون خطا
✓ php artisan migrate --seed بدون خطا اجرا می‌شود
✓ جدول roles شامل ۴ نقش است
✓ POST /api/auth/send-otp → OTP در laravel.log چاپ می‌شود
✓ POST /api/auth/verify-otp با کد صحیح → Bearer Token برمی‌گرداند
✓ GET /api/auth/me با Bearer Token → اطلاعات کاربر + نقش‌ها
✓ Rate Limiting کار می‌کند (بعد از ۳ بار send، خطای 429)
✓ npm run dev در web/ بدون خطا اجرا می‌شود
✓ صفحه /login در Next.js نمایش داده می‌شود (RTL فارسی)
✓ فرم login با OTP API کار می‌کند
✓ php artisan test → همه تست‌ها Pass
```

---

## ۱۰. اکنون شروع کن — ترتیب دقیق

```
STEP 0: همه فایل‌های بخش ۱ را بخوان → خلاصه بنویس

STEP 1: ساختار فعلی را audit کن
        - tree نشان بده
        - api/routes/api.php را بخوان
        - api/composer.json را بخوان
        - web/package.json را بخوان

STEP 2: Backend Migrations بساز (بخش ۷)

STEP 3: Models و Relationships بساز

STEP 4: Seeders بساز

STEP 5: SMS Service (Interface + LogDriver + Config + Provider)

STEP 6: OtpService بساز

STEP 7: AuthController + Requests + Routes بساز

STEP 8: CheckRole Middleware بساز

STEP 9: Frontend — lib/api.ts + lib/auth.ts + types

STEP 10: Frontend — AuthContext + middleware.ts

STEP 11: Frontend — صفحات login و otp

STEP 12: تست‌های PHPUnit بساز

STEP 13: docs/DECISION_LOG.md را آپدیت کن

STEP 14: گزارش نهایی Phase Gate بده و متوقف شو
         (منتظر تأیید برای شروع فاز ۲ باش)
```

---

## ۱۱. یادداشت مهم درباره Git

```
Git را تو اجرا نمی‌کنی.
کارفرما خودش commit/push می‌کند.
تو فقط:
  - diff تغییرات را آماده می‌کنی
  - پیام commit پیشنهادی می‌نویسی
  - متوقف می‌شوی

هرگز: git init / git commit / git push / git tag نزن.
```

---

## ۱۲. گزارش‌دهی — فقط در این نقاط

```
۱. شروع هر Phase (قبل از اولین کد)
۲. هر Approval Gate (وقتی متوقف می‌شوی)
۳. Phase Gate (پایان فاز، Acceptance Criteria را یک‌به‌یک pass/fail کن)
```

**قالب گزارش:**
```
فاز: X | وضعیت: در حال اجرا / کامل / متوقف
کار انجام‌شده: ...
فایل‌های تغییریافته: ...
نتیجه تست: Pass / Fail / N/A
تصمیمات باز: ...
ریسک: ...
```

---
*این پرامپت را به عنوان اولین پیام به هر AI agent بده. بعد از تأیید STEP 0، کار شروع می‌شود.*

---

## Actual Stack Version Baseline — 2026-08-28

This section supersedes older version references above:

```text
Backend   : Laravel 12.68.0 + PHP 8.3.33
Frontend  : Next.js 16.3.3 + React 19.2.8 + TypeScript 5.x
Database  : PostgreSQL 16.4 + PostGIS 3.4
Cache     : Redis 7
```

Laravel 12 is the approved actual project baseline. Do not downgrade to Laravel 12. PHP must remain on 8.3 unless the project owner explicitly approves a change. Before adding dependencies, verify their current stable release and compatibility with this baseline; do not change major versions without an Approval Gate.

---

## Actual Stack Version Baseline — 2026-08-28

This section supersedes older version references above:

```text
Backend   : Laravel 12.68.0 + PHP 8.3.33
Frontend  : Next.js 16.3.3 + React 19.2.8 + TypeScript 5.x
Database  : PostgreSQL 16.4 + PostGIS 3.4
Cache     : Redis 7
```

Laravel 12 is the approved actual project baseline. Do not downgrade to Laravel 11. PHP must remain on 8.3 unless the project owner explicitly approves a change. Before adding dependencies, verify their current stable release and compatibility with this baseline; do not change major versions without an Approval Gate.
