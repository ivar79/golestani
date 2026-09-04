# اینکارت — Phase 1 (Authentication) — Client Review Package

**English guide is below the Persian section.**

---

## راهنمای فارسی

### پیش‌نیازها

| ابزار | نسخه |
|---|---|
| Docker Desktop | هر نسخه جدید |
| Node.js + npm | Node 18 یا جدیدتر |

نیازی به PHP، Composer یا PostgreSQL نصب‌شده روی سیستم ندارید — همه داخل Docker اجرا می‌شوند.

### راه‌اندازی (مرحله‌به‌مرحله)

```bash
# 1) از حالت فشرده خارج کنید و وارد پوشه شوید
cd phase-1

# 2) فایل تنظیمات backend را بسازید
cp api/.env.example api/.env
#    در ویندوز: copy api\.env.example api\.env

# 3) سرویس‌ها را اجرا کنید (بار اول چند دقیقه طول می‌کشد)
docker compose up -d --build

# 4) وابستگی‌ها و آماده‌سازی دیتابیس
docker exec golestani-api composer install
docker exec golestani-api php artisan key:generate
docker exec golestani-api php artisan migrate --seed

# 5) فرانت‌اند
cd web
npm install
npm run dev
```

سپس در مرورگر باز کنید: **http://localhost:3000**

### تست OTP (ورود)

1. در صفحه اصلی روی «ورود» کلیک کنید.
2. شماره موبایل را به شکل `09xxxxxxxxx` وارد کنید و ارسال کد را بزنید.
3. کد تأیید به شماره واقعی ارسال نمی‌شود (SMS در حالت تستی است). در محیط **local/development** (که همین بکاپ در آن اجرا می‌شود) کد در **لاگ Docker** نوشته می‌شود:
   ```bash
   docker logs golestani-api --tail 30
   ```
   خطی شبیه `OTP code (development only): کد تأیید شما: 12345` را پیدا کنید. عدد کنار `کد تأیید شما: ` همان OTP است.
   ⚠️ در production این کد هرگز در لاگ نوشته نمی‌شود.
4. کد را در صفحه OTP وارد کنید؛ توکن صادر می‌شود و وارد حساب می‌شوید.
5. خروج (Logout) را هم می‌توانید تست کنید.

### محدوده Phase 1 (چه چیزی هست و چه چیزی عمداً نیست)

**شامل:**
- احراز هویت با OTP (ارسال و تأیید کد)
- مدیریت توکن (Sanctum) و خروج
- نقش‌ها و دسترسی‌ها (RBAC) با middleware
- سرویس SMS با قابلیت تعویض درایور (در حال حاضر درایور «لاگ» برای تست)
- صفحه اصلی لندینگ (طراحی نهایی)
- تست‌های خودکار بک‌اند (Auth، RBAC، Security)

**عمداً شامل نیست (فازهای بعدی):**
- ثبت و مدیریت کسب‌وکارها (Phase 2)
- جست‌وجو و نقشه (Phase 3)
- کارت ویزیت دیجیتال و طراح (Phase 4)
- اشتراک و پرداخت (Phase 5)
- پنل مدیریت (Phase 6)
- CMS و وبلاگ (Phase 6.1)

---

## English Guide

### Prerequisites

| Tool | Version |
|---|---|
| Docker Desktop | any recent |
| Node.js + npm | Node 18+ |

No local PHP, Composer, or PostgreSQL installation required — everything runs in Docker.

### Setup (step by step)

```bash
# 1) Extract and enter the folder
cd phase-1

# 2) Create the backend env file
cp api/.env.example api/.env
#    On Windows: copy api\.env.example api\.env

# 3) Start the services (first run takes a few minutes)
docker compose up -d --build

# 4) Dependencies + database
docker exec golestani-api composer install
docker exec golestani-api php artisan key:generate
docker exec golestani-api php artisan migrate --seed

# 5) Frontend
cd web
npm install
npm run dev
```

Then open: **http://localhost:3000**

### Testing OTP (login)

1. Click "ورود" (Login) on the homepage.
2. Enter a mobile number in the form `09xxxxxxxxx` and request a code.
3. The code is **not** sent by real SMS (the driver is in test mode). In the **local/development** environment this backup runs in, the code is written to the **Docker logs**:
   ```bash
   docker logs golestani-api --tail 30
   ```
   Look for a line like `OTP code (development only): کد تأیید شما: 12345`. The digits after `کد تأیید شما: ` are your OTP.
   ⚠️ In production this value is never written to any log.
4. Enter the code on the OTP page; a token is issued and you are logged in.
5. Logout can be tested from the same session.

### Phase 1 scope

**Included:** OTP authentication (send/verify), Sanctum token management & logout, roles & permissions (RBAC), swappable SMS driver (currently "log" driver for review), the final landing-page design, and the full backend test suite (Auth, RBAC, Security).

**Intentionally not included (later phases):** business listings (Phase 2), search & maps (Phase 3), digital business cards & designers (Phase 4), subscriptions & payments (Phase 5), admin panel (Phase 6), CMS/blog (Phase 6.1).
