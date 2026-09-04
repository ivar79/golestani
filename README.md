# اینکارت (Inkart) — Phase 1 Preview / Client Review

**نسخه Phase 1 (Authentication)** — آماده برای تست کارفرما روی Preview.

> ⚠️ این Preview **بدون SMS واقعی** است. در حال حاضر هیچ پیامک‌رسان ایرانی یا خارجی
> متصل نشده؛ این عمداً انجام شده تا بعداً از طریق همان `SmsServiceInterface` موجود
> یک Provider واقعی (و فقط با یک driver جدید) اضافه شود. برای تست Login در این
> Preview از **OTP Demo** استفاده کنید.

---

## CLIENT PREVIEW TEST

**جریان کامل تست برای کارفرما:**

1. **لینک Vercel را باز کنید** (URL عمومی Preview).
2. روی **«ورود / ثبت‌نام»** در هدر کلیک کنید.
3. یک **شماره موبایل معتبر** وارد کنید (مثلاً `09123456789`).
4. روی **«دریافت کد تأیید»** بزنید.
5. **کد Demo را دریافت کنید** — طبق روشِ مستند در بخش «دریافت کد OTP (Preview)» پایین.
6. کد ۵ رقمی را در صفحه OTP وارد کنید و **«تأیید و ورود»** را بزنید.
7. **ورود موفق** را ببینید (به پنل `/dashboard` هدایت می‌شوید).
8. **خروج (Logout)** را از پنل تست کنید و به حالت مهمان برگردید.

> ✅ **هیچ ترمینال، PHP، Laravel، Docker، Redis یا Database محلی لازم نیست.**
> همه زیرساخت روی Vercel / Render / PostgreSQL است.

### دریافت کد OTP (Preview)

**OTP Demo** در این Preview به این شکل کار می‌کند:

- چون هنوز SMS واقعی نداریم، کد تولیدشده **در لاگ Backend** نوشته می‌شود و از آنجا قابل خواندن است.
- در محیط Preview (غیر-production) با `OTP_DEMO_MODE=true`، بعد از درخواست کد، یک خط مانند زیر در لاگ Render ظاهر می‌شود:

```
OTP code (demo/preview only): کد تأیید شما: 12345
```

- **۵ رقم بعد از `کد تأیید شما: `** همان OTP است و تا **۲ دقیقه** اعتبار دارد.

> ⚠️ **در Production واقعی هرگز این کد در لاگ یا پاسخ API نوشته نمی‌شود.**
> حتی اگر `OTP_DEMO_MODE=true` باشد، چون Production از گیت امنیتی عبور نمی‌کند.

---

## Developer Setup (راه‌اندازی توسعه)

### Backend (Laravel 12)

```bash
cd api
cp .env.example .env            # سپس مقادیر DB را تنظیم کنید
composer install
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

**نکته‌ها:**
- **PostGIS الزامی است.** migration های Phase 1، extension `postgis` و ستون `geom`
  را می‌سازند (برای جست‌وجوی مکانی فازهای بعدی). دیتابیس باید **PostGIS-capable** باشد
  (مثلاً Neon PostGIS یا پلن PostGIS در Render). PostgreSQL معمولی Render این
  extension را ندارد و `migrate` خطا می‌دهد.
- **بدون Redis:** `CACHE_STORE=database`, `SESSION_DRIVER=database`, `QUEUE_CONNECTION=database`
  (پیش‌فرض `.env.example`). OTP در جدول `cache` ذخیره می‌شود و بدون Redis کار می‌کند.
- **OTP Demo:** برای مشاهده کد در توسعه، `OTP_DEMO_MODE=true` و `APP_ENV` غیر از `production`.

### Frontend (Next.js)

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

**متغیر ضروری:** `NEXT_PUBLIC_API_URL` — آدرس عمومی API (در توسعه
`http://localhost:8000/api`؛ در Preview آدرس HTTPS روی Render).

---

## Environment Variables

### Vercel (Frontend)

| متغیر | وضعیت |
|---|---|
| `NEXT_PUBLIC_API_URL` | **ضروری** — آدرس HTTPS بک‌اند + `/api` |
| `NEXT_PUBLIC_AD_SLOT` | اختیاری (پیش‌فرض `taskbar`) |
| `NEXT_PUBLIC_MAP_TILE_URL` | اختیاری |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | اختیاری |

### Render (Backend)

| متغیر | Preview | Production | توضیح |
|---|---|---|---|
| `APP_ENV` | `preview`/`local` | `production` | جداکننده Preview از Production |
| `APP_KEY` | تولیدشده | تولیدشده | ضروری |
| `APP_DEBUG` | `false` | `false` | ❌ در Production هرگز `true` |
| `APP_URL` | `https://…` | `https://…` | آدرس HTTPS API |
| `DB_*` | PostGIS-دار | PostGIS-دار | دیتابیس با PostGIS |
| `CACHE_STORE` | `database` | `redis`(اختیاری) | بدون Redis کار می‌کند |
| `SESSION_DRIVER` | `database` | `redis`(اختیاری) | |
| `QUEUE_CONNECTION` | `database` | `redis`(اختیاری) | |
| `SMS_DRIVER` | `log` | `log` یا واقعی | |
| `OTP_DEMO_MODE` | `true` | `false` | **فقط Preview** |
| `CORS_ALLOWED_ORIGINS` | خالی | `https://your-app.vercel.app` | |

---

## معماری

- **Frontend:** Next.js / React → **Vercel** (HTTPS خودکار)
- **Backend:** Laravel 12 → **Render** (HTTPS خودکار)
- **Database:** PostgreSQL **+ PostGIS** → Render / Neon
- **Authentication:** **Bearer Token** (Santum) — بدون stateful cookie
- **SMS:** abstraction `SmsServiceInterface` با driver های `log` (فعلاً) و `http` (آینده)
