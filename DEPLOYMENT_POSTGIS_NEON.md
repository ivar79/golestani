# راهنمای دیتابیس PostGIS روی Neon (استیجینگ و پروداکشن)

> **چرا Neon؟** مایگریشن‌های این پروژه اکستنشن `postgis` را فعال می‌کنند و ستون
> `geometry(Point,4326)` با ایندکس GiST می‌سازند (فایل‌های
> `2026_08_28_000004_enable_postgis_extension.php` و
> `2026_09_01_000001_add_geom_to_businesses_table.php`).
> PostgreSQL استاندارد Render این اکستنشن را ندارد؛ Neon به‌صورت پیش‌فرض PostGIS دارد.

---

## ۱. ساخت دیتابیس در Neon

### استیجینگ
1. در [neon.tech](https://neon.tech) پروژه‌ای بسازید (مثلاً `golestani`).
2. در قسمت **Branches** شاخه‌ی پیش‌فرض `main` را برای **پروداکشن** نگه دارید.
3. یک برنچ جدید بسازید: **`staging`** (هر برنچ Neon یک دیتابیس کاملاً مستقل با کپی schema است — ایزوله از پروداکشن).
4. برای هر برنچ، از دکمه‌ی **Connect**، **Connection String** (فرمت پولد `postgresql://...neon.tech/neondb?sslmode=require`) را کپی کنید.
   - حتماً `?sslmode=require` در URL باشد.

### پروداکشن
- همان برنچ `main` — از **پروژه و برنچ جداگانه** برای پروداکشن استفاده نکنید مگر اینکه پلنپولی دارید؛ حداقلِ لازم: دو برنچ `main` (پروداکشن) و `staging`.

### نکته‌ی مهم درباره‌ی نقش‌ها (Roles)
کاربر پیش‌فرض Neon مالک دیتابیس است، پس `CREATE EXTENSION postgis` برایش مجاز است ✅.
اگر کاربر محدود ساخته‌اید، باید نقش آن کاربر عضو نقش مالک باشد:
```sql
GRANT neon_superuser TO your_app_user;  -- یا مالک‌بودن دیتابیس
```

---

## ۲. اتصال Render به Neon

در داشبورد Render، سرویس `golestani-api` (که از `render.yaml` ساخته شده) →

**Environment → DATABASE_URL** برای هر محیط:

| محیط | مقدار `DATABASE_URL` |
|------|----------------------|
| استیجینگ | Connection String برنچ `staging` از Neon |
| پروداکشن | Connection String برنچ `main` از Neon |

فرمت لازم برای Laravel 12 (به‌صورت خودکار parse می‌شود):
```
postgresql://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
```

نکته‌ها:
- **Pooler vs Direct:** برای اپلیکیشن (تعداد زیاد کانکشن کوتاه) آدرس **پولد** (`-pooler`) را بدهید. برای مایگریشن بهتر است آدرس **direct** (بدون `-pooler`) باشد تا قفل‌های DDL درست عمل کنند — در Render می‌توانید در Build Command موقتاً `DATABASE_URL` را با آدرس direct جایگزین کنید یا هر دو را به‌صورت دو متغیر نگه دارید.
- **DB_SSLMODE=require** در Blueprint از قبل تنظیم شده ✅ (Neon اتصال غیر SSL را نمی‌پذیرد).
- متغیرهای `DB_HOST` و غیره لازم نیست — وقتی `DATABASE_URL` ست باشد Laravel از آن استفاده می‌کند (`config/database.php` → `url` روی کانکشن `pgsql` ✅).

---

## ۳. چرخه‌ی مایگریشن استیجینگ ↔ پروداکشن

1. **استیجینگ جلوتر است:** مایگریشن‌های جدید اول روی برنچ `staging` اعمال می‌شوند (هر دیپلای Render استیجینگ خودش `migrate --force` را در Build Command اجرا می‌کند ✅).
2. **تأیید استیجینگ** → merge به `main` → دیپلای پروداکشن → `migrate --force` روی برنچ `main` اجرا می‌شود.
3. **بازگردانی:** برنچ‌های Neon point-in-time restore دارند؛ در صورت خرابی مایگریشن، برنچ `staging` را به نقطه‌ی قبل از دیپلای برگردانید (Neon Console → Branch → Restore).

⚠️ **هرگز** روی دیتابیس پروداکشن از پنل Neon `CREATE EXTENSION` دستی نزنید و ستون `geom` را دستی نسازید — مایگریشن‌ها خودشان این کار را می‌کنند (`CREATE EXTENSION IF NOT EXISTS postgis` idempotent است).

---

## ۴. اعتبارسنجی خودکار پس از هر دیپلای ✅

یک فرمان Artisan اختصاصی برای این کار ساخته شده و **در Build Command فایل `render.yaml` سیم‌کشی شده است** — بعد از مایگریشنِ هر دیپلای به‌طور خودکار اجرا می‌شود و اگر مشکل جدی باشد، **دیپلای را fail می‌کند**:

```bash
php artisan db:validate-postgis        # خروجی متنی رنگی
php artisan db:validate-postgis --json # خروجی JSON برای CI
```

چه چیزهایی چک می‌شود:

| چک | نتیجه‌ی خرابی |
|----|----------------|
| اتصال دیتابیس | fail → توقف دیپلای |
| درایور pgsql | skip (برای sqlite محلی) |
| اکستنشن `postgis` نصب باشد (ترجیحاً 3.x) | fail (نسخه‌ی قدیمی = هشدار) |
| ستون `businesses.geom` از نوع `geometry(Point,4326)` | fail |
| ایندکس GiST `businesses_geom_gist` | fail |
| بک‌فیل: هر ردیف دارای lat/lng مقدار `geom` داشته باشد | هشدار |

اجرای دستی (از Render Shell یا لوکال با `DATABASE_URL` همان محیط):

```bash
php artisan migrate:status            # همه‌ی مایگریشن‌ها Ran باشند
php artisan db:validate-postgis       # ✔ یا ✘ برای هر چک
```

اگر همه سبز بود و خواستید در داشبورد Neon هم چشم‌انداز بگیرید → **Tables**: جدول‌های `users`، `businesses` (با ستون `geom`)، `cache`، `jobs` و… ساخته شده باشند.

---

## ۵. هشدارهای امنیتی

- Connection String شامل پسورد است — در ریپو commit نکنید؛ فقط در Environment Variables داشبورد Render.
- برای پروداکشن در Neon IP Allow را خالی بگذارید (Render خروجی static ندارد) ولی پسورد قوی بگیرید و از برنچ جداگانه برای استیجینگ استفاده کنید.
- `OTP_DEMO_MODE` روی هر دو محیط = `false` (در `render.yaml` پیش‌فرض شده ✅) — دیتابیس‌های استیجینگ و پروداکشن هر دو داده‌ی واقعی کاربران را نگه می‌دارند.
