# نقشه فایل‌های فاز ۲

**42 فایل کد/تست/تنظیمات: 22 فایل جدید و 20 فایل ویرایش‌شده.** هیچ فایل قبلی حذف نشده است. راهنمای تحویل و همین گزارش جداگانه افزوده شده‌اند.

ساختار ریشه هر دو ZIP همان `golestani (13)/` است. `api/` و `web/` باید روی پوشه‌های هم‌نام پروژه شما قرار بگیرند، نه داخل یک پوشه api یا web دیگر.

## تفاوت دو بسته

- `golestani-phase2-full.zip`: کل پروژه، شامل فایل‌های قبلی بدون تغییر و نسخه‌های جایگزین.
- `golestani-phase2-changes.zip`: فقط فایل‌های جدید/ویرایش‌شده به همراه راهنمای تحویل و این نقشه؛ برای پروژه‌ای که دقیقاً با ZIP مبنا مطابقت دارد.
- `docs/PHASE_2_FILE_MANIFEST.json`: مسیر، وضعیت و SHA-256 نسخه مبنا/جدید، برای بررسی تداخل تغییرات.

قبل از نصب، `docs/PHASE_2_HANDOVER_FA.md` را بخوانید؛ به‌خصوص تنظیم `FRONTEND_URL`، migration و چرخش رمز مدیر قدیمی.

## نتیجه بررسی انجام‌شده

۲۲ تست مستقل URL موفق بودند؛ تبدیل نحوی ۶۱ فایل TS/TSX و bundle محدود سه صفحه موفق بود. تست PHP، type-check با تمام وابستگی‌های واقعی و Next build اجرا نشده‌اند. این گزارش به معنی تأیید production نیست.

| وضعیت | مسیر دقیق فایل | کاربرد |
|---|---|---|
| ویرایش‌شده | `api/.env.example` | نمونه متغیرهای دامنه فرانت و CORS |
| جدید | `api/app/Console/Commands/ProvisionAdmin.php` | ساخت/چرخش تعاملی رمز مدیر، لغو توکن‌ها و ثبت رخداد |
| جدید | `api/app/Http/Controllers/Api/AdminBusinessController.php` | فهرست صفحه‌بندی‌شده همه وضعیت‌ها و خواندن تاریخچه |
| ویرایش‌شده | `api/app/Http/Controllers/Api/BusinessController.php` | ثبت، ویرایش، انتشار، رسانه، نشان‌ها، جستجوی پارامتری و audit |
| جدید | `api/app/Http/Controllers/Api/BusinessImageController.php` | گالری پنج‌تصویری مستقل از اشتراک، مالکیت و پاکسازی فایل |
| ویرایش‌شده | `api/app/Http/Controllers/Api/PublicBusinessController.php` | اطلاعات عمومی محدود، گالری و QR با مقصد فرانت |
| جدید | `api/app/Http/Middleware/ApiRequestSafety.php` | Origin مجاز و جلوگیری از mutation با فرم ساده |
| جدید | `api/app/Http/Middleware/ApiSecurityLog.php` | لاگ درخواست‌های ورود و خطاها بدون اطلاعات حساس |
| ویرایش‌شده | `api/app/Http/Middleware/CheckRole.php` | منع حساب غیرفعال در مسیرهای نقش‌محور |
| جدید | `api/app/Http/Middleware/RequireApiToken.php` | قطع fallback احراز API به session وب |
| ویرایش‌شده | `api/app/Http/Requests/Business/BusinessRequest.php` | اعتبارسنجی فیلدها، لینک‌ها، مختصات و کنترل مسیر رسانه |
| ویرایش‌شده | `api/app/Models/Business.php` | روابط قبلی به همراه رابطه گالری جدید |
| جدید | `api/app/Models/BusinessImage.php` | مدل تصویر اختصاصی کسب‌وکار |
| جدید | `api/app/Services/BusinessAudit.php` | ثبت transactional رخداد موفق بدون محتوای خصوصی |
| جدید | `api/app/Services/BusinessMedia.php` | قواعد تصویر، ذخیره و پاکسازی ایمن |
| جدید | `api/app/Services/BusinessPublication.php` | بازبینی تغییرات و جلوگیری از رفع تعلیق توسط مالک |
| جدید | `api/app/Support/BusinessUrl.php` | تولید لینک canonical از FRONTEND_URL |
| ویرایش‌شده | `api/bootstrap/app.php` | اتصال middleware امنیتی جدید به API |
| جدید | `api/config/business.php` | دامنه عمومی، سقف گالری و نشان‌های مجاز |
| ویرایش‌شده | `api/config/cors.php` | allowlist دقیق به جای wildcard و هدرهای مجاز |
| ویرایش‌شده | `api/database/migrations/2026_09_07_000001_ensure_admin_password_and_email.php` | حذف provisioning رمز ثابت در نصب جدید؛ دیتابیس قبلی خودکار تغییر نمی‌کند |
| جدید | `api/database/migrations/2026_09_08_000001_create_phase2_images_and_audit_events.php` | افزودن business_images و audit_events بدون حذف داده قبلی |
| ویرایش‌شده | `api/database/seeders/AdminUserSeeder.php` | جلوگیری از seeding رمز پیش‌فرض و ارجاع به دستور تعاملی |
| ویرایش‌شده | `api/docker/nginx.conf` | عدم اجرای فایل‌های کسب‌وکار توسط PHP و هدرهای امن |
| ویرایش‌شده | `api/docker/start.sh` | ساخت مسیر storage، لینک عمومی و توقف روشن روی خطای migration |
| ویرایش‌شده | `api/routes/api.php` | حفظ مسیرهای قبلی، افزودن routes فاز ۲ و throttle تصمیم مدیر |
| جدید | `api/routes/phase2.php` | مسیرهای گالری، مدیریت فهرست و audit |
| جدید | `api/tests/Feature/PhaseTwoAcceptanceTest.php` | آزمون چرخه پروفایل، رسانه، نشان‌ها، QR و audit |
| جدید | `api/tests/Security/PhaseTwoSecurityTest.php` | آزمون XSS/URL، SQL Injection، CSRF، IDOR و نوع تصویر |
| ویرایش‌شده | `api/tests/TestCase.php` | تطبیق actingAs تست‌های قبلی با guard واقعی Sanctum |
| جدید | `web/.env.example` | نمونه URL بک‌اند برای build فرانت |
| ویرایش‌شده | `web/next.config.ts` | هدرهای امنیتی بدون شکستن اسکریپت‌های Next.js |
| جدید | `web/src/app/admin/businesses/page.tsx` | پنل کامل تأیید، رد، تعلیق، نشان‌ها و تاریخچه |
| ویرایش‌شده | `web/src/app/admin/page.tsx` | لینک مسیر مدیریت کامل و حفظ سایر تب‌های قبلی |
| ویرایش‌شده | `web/src/app/b/[slug]/page.tsx` | نمایش امن اطلاعات عمومی، تصاویر، نشان‌ها، ویترین و QR |
| ویرایش‌شده | `web/src/app/dashboard/page.tsx` | فرم کامل مالک، مختصات نقشه، شبکه‌ها، رسانه و وضعیت |
| جدید | `web/src/components/business/phase2.module.css` | استایل مشترک responsive صفحات فاز ۲ |
| ویرایش‌شده | `web/src/contexts/AuthContext.tsx` | cookie صرفاً نشانگر مسیر، عدم تکرار bearer و بارگذاری صحیح |
| ویرایش‌شده | `web/src/lib/api.ts` | هدر درخواست غیرساده، مدیریت multipart و پیام خطای قابل‌استفاده |
| جدید | `web/src/lib/businessSafety.ts` | توابع خالص دفاع URL، مسیر تصویر و واتساپ با تست مستقل |
| جدید | `web/src/lib/phase2.ts` | انواع داده و توابع API اختصاصی فاز ۲ |
| جدید | `web/tests/phase2-safety.test.cjs` | ۲۲ تست مستقل اجرایی توابع امنیت لینک |

## مستندات جدید

- `docs/PHASE_2_HANDOVER_FA.md`: نصب، تنظیمات، قواعد انتشار، کنترل‌های امنیتی، محدودیت‌ها و چک‌لیست پذیرش.
- `docs/PHASE_2_FILES.md`: همین نقشه فایل‌ها.
- `docs/PHASE_2_FILE_MANIFEST.json`: هش فایل‌های تغییریافته؛ برای جلوگیری از self-reference، خود manifest و این نقشه در فهرست هش نیستند.

## اولویت اجرای شما

1. نصب در محیط staging و backup کد/DB/storage.
2. تنظیم دامنه‌ها و اجرای migration و storage:link.
3. ساخت مدیر بدون رمز ثابت یا چرخش رمز مدیر موجود.
4. اجرای تست‌های آماده Laravel و npm build.
5. آزمون واقعی چرخه مالک/مدیر، نمایش عمومی و اسکن QR.
