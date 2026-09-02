# گزارش پیاده‌سازی طراحی Homepage

**تاریخ:** ۱۴۰۵/۰۶/۱۰ (2026-09-01)
**منبع طراحی:** `docs/design/homepage/` — تصاویر `1.jpg` (پس‌زمینهٔ نورانی) و `2.jpg` (ماکاپ موبایل) به‌عنوان Design Source of Truth؛ `code.html` و `DESIGN.md` به‌عنوان مرجع
**وضعیت:** پیاده‌سازی شد — تمام تست‌ها پاس

## ۱. فایل‌های تغییر یافته

| فایل | نوع تغییر |
|---|---|
| `web/src/components/home/HomeHero.tsx` | بازنویسی کامل — ماکاپ موبایل (`2.jpg`) به‌عنوان تصویر اصلی، نور aurora (`1.jpg`) در پس‌زمینه، و کلمهٔ برجستهٔ عنوان (مثل «دیجیتال») از CMS با رنگ emerald |
| `web/src/components/home/HomeHeader.tsx` | **بازنویسی** — تسک‌بار هوشمند (مثل LeadFresh): هدر پیل در اسکرول محو می‌شود و نوار پیشرفت گرادیانی emerald ظاهر می‌شود؛ لوگوی تصویری از CMS؛ همبرگر فقط برای موبایل/تبلت (< xl)، منوی مرکزی برای دسکتاپ |
| `web/src/components/home/HomeFooter.tsx` | ستون چهارم «شبکه‌های اجتماعی» از CMS؛ گرید ۴ ستونه |
| `api/database/seeders/HomepageSeeder.php` | **جدید** — تمام متن‌های پیش‌فرض homepage را در جدول CMS `site_settings` می‌نشاند (متن‌ها از `code.html` مرجع) |
| `api/database/seeders/DatabaseSeeder.php` | ثبت `HomepageSeeder` |
| `web/public/assets/hero-1.jpg` | نور aurora (از `1.jpg`) |
| `web/public/assets/hero-2.jpg` | ماکاپ موبایل کارت دیجیتال (از `2.jpg`) |
| `api/app/Http/Controllers/Api/AdminController.php` | کلیدهای additive در whitelist |
| `web/src/lib/homepage.ts` | hook مشترک `useHomepageContent` (یک fetch کش‌شده) |

## ۲. علتِ مشکل قبلی (و رفع آن)

در نسخهٔ اول، تصویر اشتباهی در Hero استفاده شد:

- `1.jpg` یک **نور انتزاعی aurora** است (پس‌زمینهٔ اتمسفری).
- `2.jpg` **ماکاپ واقعی موبایل کارت دیجیتال** است که طراحی مرجع نشان می‌دهد.

بنابراین Hero به‌جای موبایل، نور بزرگ را تمام‌قد نمایش می‌داد. علاوه بر آن، **کش CMS هیچ محتوایی نداشت**، پس عنوان/زیرعنوان/دکمه‌ها خالی بودند و صفحه فرو ریخته به‌نظر می‌رسید.

**رفع:** (۱) `2.jpg` به‌عنوان تصویر اصلی Hero؛ (۲) `HomepageSeeder` تمام متن‌های مرجع را در CMS می‌نشاند تا کامپوننت‌ها از دیتابیس بخوانند (نه hardcode).

## ۳. معماری UI

```
web/src/app/page.tsx (composition)
  ├── HomeHeader
  ├── HomeHero        (visual=2.jpg, background=1.jpg, کلمهٔ برجسته از CMS)
  ├── HomeFeatures
  ├── HomeSearch
  ├── DigitalCardShowcase + HowItWorks
  ├── HomeCta
  └── HomeFooter
```

## ۴. ارتباط UI با CMS (کلیدهای seed شده)

- `homepage.hero.image` → `/assets/hero-2.jpg` (ماکاپ موبایل)
- `homepage.hero.background` → `/assets/hero-1.jpg` (نور aurora)
- `homepage.hero.title_accent` → کلمهٔ سبز داخل عنوان
- `homepage.brand` / `homepage.nav.*` / `homepage.header.login` → هدر
- `homepage.feature.{1..3}.{icon,title,description}` → ویژگی‌ها
- `homepage.showcase.cards` / `homepage.howitworks.steps` → JSON list
- `homepage.cta.*`, `homepage.footer.*` → CTA و فوتر

## ۵. نحوهٔ تغییر در آینده

- **تغییر متن/تصویر:** Admin → Homepage → همان کلید؛ نیاز به deploy نیست.
- **تغییر لوگو:** `homepage.logo`.
- **تغییر نقشهٔ تصاویر:** `homepage.hero.image` / `homepage.hero.background`.

## ۶. تست‌ها

- `npm run lint`: **PASS** (۰ خطا، ۰ هشدار)
- `npx tsc --noEmit`: **PASS**
- `npm run build`: **PASS**
- `php -l` روی فایل‌های بک‌اند: **PASS**
- واقعی‌سازی با `docker exec golestani-api php artisan db:seed --class=HomepageSeeder`: **انجام شد**

## ۷. تسک‌بار هوشمند (Smart Scroll Taskbar)

مطابق الگوی پروژهٔ LeadFresh پیاده‌سازی شد تا با اسکرول، هدر هوشمندانه واکنش نشان دهد:

- **هدر پیل** با اسکرول از `opacity 1 → 0` در ۱۵۰px اول محو می‌شود (`pointer-events: none` در انتهای محو).
- **نوار پیشرفت گرادیانی emerald** (۳px، بالا) هم‌زمان ظاهر می‌شود و پهنایش با درصد پیشرفت صفحه تغییر می‌کند.
- **موبایل/تبلت (< xl):** دکمهٔ همبرگر همیشه در دسترس است و دکمهٔ شبکیه (drawer) را باز می‌کند؛ فقط در این عرض‌ها نمایش داده می‌شود.
- **دسکتاپ (≥ xl):** منوی داخل هدر (inline)`+` یک دکمهٔ مرکزی شناور که بعد از اسکرول ظاهر می‌شود تا ناوبری در هر عمقی در دسترس بماند.
- ناوبری/برند/متن‌ها همچنان از CMS خوانده می‌شوند (بدون hardcode).

**نحوهٔ کار:** موقعیت اسکرول در state (`scrollY`) نگهداری می‌شود؛ همهٔ مقادیر با `style` به DOM می‌رسند و با `rAF` throttle می‌شوند (بدون re-render در هر فریم). همین کار باعث شد هدر به‌صورت pure-React پیاده شود و `eslint react-hooks/refs` خطا ندهد.

## ۸. عرض صفحه (Container)

عرض محتوای اصلی روی `max-w-[1280px]` (متناظر `container-max`) قفل شد و هدر نیز `max-w-[1280px]` دارد، تا در مانیتورهای عریض محتوا تمام‌عرض نشود. ستون Hero هم به نسبت text ۶۰٪ / image ۴۰٪ متعادل شد.

## ۹. تسک‌بار سراسری (Site-wide Smart Taskbar)

با این تغییر، تسک‌بار هوشمند از صفحهٔ اصلی به **همهٔ صفحات عمومی** گسترش یافت.

### فایل‌های جدید
- `web/src/components/layout/AppTaskbar.tsx` — کامپوننت مشترک تسک‌بار (جایگزین `HomeHeader`/`SiteHeader`)
- `web/src/lib/ads.ts` — تایپ‌ها + fetch آگهی‌های عمومی از `/public/advertisements/{slot}`

### قابلیت‌ها
- **دسکتاپ (≥ xl):** منوی inline + کلید **فلش رو به پایین (chevron)** با استایل بولد در مرکز که بعد از اسکرول ظاهر می‌شود.
- **موبایل/تبلت (< xl):** همبرگر شناور که هنگام اسکرول از **سمت چپ** ظاهر می‌شود و دراور (با ناوبری + جست‌وجو + ورود) را باز می‌کند.
- **جست‌وجو به تسک‌بار منتقل شد:** یک آیکون شیک جست‌وجو کنار «ورود / ثبت‌نام» که زیرمنوی جست‌وجو (نام/خدمت + شهر) را باز می‌کند. بخش `HomeSearch` از میانهٔ صفحهٔ اصلی حذف شد.
- **نوار پیشرفت اسکرول** (گرادیان emerald) همچنان در بالای صفحه.
- **نوار تبلیغات زیر تسک‌بار** از جدول آگهی‌های CMS (slot از `NEXT_PUBLIC_AD_SLOT`)؛ وقتی خالی باشد چیزی نمایش نمی‌دهد.

### صفحات عمومی تحت پوشش
`/`, `/about`, `/contact`, `/privacy`, `/search`, `/category/*`, `/[city]/[category]`, `/b/*`

### فایل‌های حذف/اصلاح شده
- `web/src/components/home/HomeHeader.tsx` — **حذف** (جایگزین با AppTaskbar)
- `web/src/components/home/HomeSearch.tsx` — **حذف** (جست‌وجو به تسک‌بار منتقل شد)
- `web/src/components/layout/SiteHeader.tsx` — فقط `BrandMark` باقی ماند
- `web/src/app/about|contact|privacy/page.tsx`, `web/src/app/b/[slug]/page.tsx`, `web/src/app/search/page.tsx`, `web/src/app/page.tsx` — استفاده از `AppTaskbar`

### رفع «خلأ دسکتاپ» Hero
پس‌زمینهٔ aurora (`hero-1.jpg`) که قبلاً به `max-w-7xl` کلیپ می‌شد، حالا **تمام‌عرض (full-bleed)** است: بخش `w-full` + پس‌زمینهٔ `absolute inset-0`. محتوا در کانتینر مرکزی `max-w-[1280px]` می‌ماند. در مانیتورهای پهن، نور جانبی کل عرض را پر می‌کند و دیگر دو طرف خالی نمی‌ماند.

### امنیت و پیکربندی (env)
- `web/.env.example` ساخته شد: `NEXT_PUBLIC_API_URL` و `NEXT_PUBLIC_AD_SLOT`.
- `web/src/lib/api.ts` آدرس API را از `NEXT_PUBLIC_API_URL` می‌خواند (با fallback توسعه).
- در بک‌اند، دیتابیس/ذخیره‌سازی (S3/AWS) و SMS همه از `.env` خوانده می‌شوند؛ هیچ مقدار سخت‌کد شده‌ای برای اتصال به سرویس‌ها وجود ندارد.

## ۱۰. فونت وزیر و راست‌چین (RTL)

**در تاریخ 2026-09-02 اضافه شد.**

### مشکل
- فونت `Vazirmatn` در CSS به‌عنوان `--font-sans` تعریف شده بود ولی **هرگز بارگذاری نمی‌شد** (هیچ فایل فونت و بارگذاری `next/font` وجود نداشت) → همهٔ حروف فارسی به `Segoe UI`/`Tahoma` فالبک می‌شدند که رندر فارسی ضعیفی داشت.
- عنوان هیرو (`H1`) در `HomeHero.tsx` کلاس `text-left` داشت که در صفحهٔ RTL متن را چپ‌چین می‌کرد → به‌هم‌ریختگی عنوان نسبت به بج/زیرعنوان/دکمه‌ها.

### تغییرات
- **فونت وزیر (Vazirmatn) self-hosted** شد: ۶ وزن (Thin/Regular/Medium/SemiBold/Bold/Black) به‌صورت `woff2` در `web/public/fonts/` دانلود و با `next/font/local` در `web/src/app/layout.tsx` بارگذاری شد و به متغیر `--font-vazirmatn` متصل شد. `--font-sans` در `globals.css` به `var(--font-vazirmatn)` اولویت داده شد.
- `HomeHero.tsx` : کلاس `<h1>` از `text-left` به `text-right` تغییر کرد.
- پویش کل صفحهٔ اصلی: هیچ `text-left` یا `dir="ltr"` روی محتوای فارسی باقی نماند.

### تأیید
- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS (۰ خطا)
- `npm run build`: PASS
- در مرورگر: `dir="rtl"`، `h1 text-align: right`، `font-family` با `vazirmatn` شروع می‌شود و `document.fonts.status = loaded`.

## ۱۱. سیستم دکمه پروژه (Button Design System) — قانون الزامی

**در تاریخ 2026-09-02 اضافه شد.** این قانون برای **همه دکمه‌های آینده** پروژه الزامی است.

### هدف
دکمه‌هایی «دست‌ساز» و مدرن؛ نه تولیدشده و شبیه قالب آماده. شاخصه‌های ممنوع: هالهٔ شناور اطراف دکمه، پر شدن تخت بدون عمق، فقط تغییر رنگ در hover.

### توکن‌های تعریف‌شده در `src/app/globals.css`

| کلاس | کاربرد | پس‌زمینهٔ مناسب |
|------|--------|----------------|
| `.btn` | پایه (چیدمان، ease، focus-visible) | همیشه لازم است |
| `.btn-primary` | دکمهٔ اصلی/CTA — گرادیان سبز (secondary)، سایهٔ چندلایه، هایلایت داخلی | تیره و روشن (خوانا روی هر دو) |
| `.btn-secondary` | دکمهٔ فرعی شیشه‌ای (glassy) | تیره (homepage) |
| `.btn-ghost` | دکمهٔ متنی با آیکون | تیره/روشن |
| `.btn-outline` | دکمهٔ لبه‌دار سرمه‌ای | روشن (auth/dashboard/admin) |

اندازه‌ها: `.btn-sm` (0.875rem)، `.btn-md` (0.9375rem)، `.btn-lg` (1.125rem).

### میکرو-اینترکشن‌ها (خودکار با کلاس‌ها)
- hover: بلندشدن `-1px` + سایهٔ قوی‌تر (ease `cubic-bezier(0.22,1,0.36,1)`)
- active: فشرده‌شدن + سایهٔ کاهش‌یافته (حس لمسی)
- آیکون `.btn-arrow`: در hover به جلو حرکت می‌کند
- `focus-visible`: حلقهٔ `rgba(0,108,74,0.35)`
- `:disabled`: 55% opacity، بدون transform/shadow

### قوانین ساخت دکمهٔ جدید
1. همیشه از ترکیب `.btn` + یک واریانت (`btn-primary` / `btn-secondary` / `btn-ghost` / `btn-outline`) + یک اندازه استفاده کن. از کلاس‌های خام مثل `bg-emerald-600`, `bg-secondary`, `bg-navy-800`, `shadow-[...]` برای دکمه استفاده نکن.
2. **هماهنگی با پس‌زمینه را رعایت کن:**
   - پس‌زمینهٔ تیره → `.btn-primary` یا `.btn-secondary` یا `.btn-ghost`
   - پس‌زمینهٔ روشن → `.btn-primary` یا `.btn-outline`
3. اگر آیکون جهت‌دار (فلش) داری، به آن `.btn-arrow` بده تا در hover حرکت کند.
4. دکمهٔ غیرفعال را با `disabled` نشان بده (خودکار به‌درستی استایل می‌گیرد).
5. اگر دکمه فقط تابعیت جدید (variant) لازم دارد، اول در `globals.css` توکن اضافه کن، بعد در کامپوننت استفاده کن — هرگز استایل inline/Klass خام ننویس.

### فایل‌های به‌روز شده در این مرحله
`HomeHero.tsx`، `HomeCta.tsx`، `AppTaskbar.tsx`، `(auth)/login/page.tsx`، `(auth)/otp/page.tsx`، `dashboard/page.tsx`، `admin/page.tsx`، `AdminBlogTab.tsx`، `AdminPagesTab.tsx`، `card-maker/page.tsx`، `designer/page.tsx`، `search/page.tsx`.

### تأیید
- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS (۰ خطا)
- `npm run build`: PASS
- بررسی مرورگر: دکمه‌های خانه (تیره) و ورود (روشن) هر دو هماهنگ با پس‌زمینه، با گرادیان و سایهٔ چندلایه.
