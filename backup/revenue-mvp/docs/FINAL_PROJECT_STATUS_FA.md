# وضعیت نهایی پروژه Inkart

## فازهای تکمیل‌شده

- فاز ۱: زیرساخت، OTP، Sanctum و RBAC
- فاز ۲: ثبت و مدیریت کسب‌وکار و پروفایل عمومی
- فاز ۳: PostGIS، جست‌وجوی مکانی، فیلتر و فاصله؛ مستقل از provider نقشه
- فاز ۴: کارت‌ساز محدود، قالب‌ها، export و workflow طراح
- فاز ۵: پلن، اشتراک دستی، ویترین و تبلیغات محدود
- فاز ۶: پنل عملیاتی مدیر و moderation
- فاز ۶.۱: پایه CMS، مقاله، تنظیمات، SEO و media API
- فاز ۷: hardening، استقرار، backup و handover documentation

## موارد ناقص یا نیازمند تکمیل

- اجرای کامل PHPUnit در Docker/PostgreSQL هنوز انجام نشده است.
- UI کامل فرم‌های CMS برای همه endpointهای فاز ۶.۱ هنوز نیازمند توسعه تکمیلی است.
- audit log، 2FA مدیر و اسکن بدافزار فایل‌ها برای production hardening بعدی پیشنهاد می‌شود.
- provider نقشه خارجی عمداً در هسته سیستم وارد نشده است.

## تست‌ها

- Frontend lint: Pass
- TypeScript: Pass
- Next.js build: Pass
- PHP syntax: Pass
- PHPUnit: Pending Docker/PostgreSQL verification، نه Pass

## نکات استقرار

Backend باید با PHP 8.3، Laravel 12، PostgreSQL/PostGIS و Redis اجرا شود. `APP_DEBUG=false`، HTTPS، secret management، backup رمزگذاری‌شده، worker پایدار و محدودسازی دسترسی فایل‌ها الزامی است. جزئیات در `docs/DEPLOYMENT_GUIDE_FA.md` آمده است.
