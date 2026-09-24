# Phase 3 Checkpoint — Search, Location & Discovery

## وضعیت

پیاده‌سازی تکمیلی Phase 3 انجام شد. قراردادهای Phase 1 و 2 و احراز هویت، dashboard و قابلیت‌های فازهای بعدی تغییر داده نشدند.

## معماری نهایی

- جست‌وجوی عمومی فقط `Business`های `approved` را برمی‌گرداند.
- جست‌وجوی متن در name، category، description، services و social_links انجام می‌شود.
- فیلترهای city، neighborhood، category، verified، rating، open، subscription_level و showcase پذیرفته و validate می‌شوند؛ فیلدهای rating/open/subscription/showcase تا زمان وجود ستون‌های رسمی مرتبط، برای حفظ قرارداد به‌صورت nullable نگه داشته شده‌اند.
- pagination استاندارد شامل data، page، limit، total، last_page و next_page است.
- PostGIS با SRID 4326 و GIST index برای radius، nearest sorting و distance calculation استفاده می‌شود.
- درایور غیر PostgreSQL از توابع PostGIS استفاده نمی‌کند و جست‌وجوی متنی/فیلتر عادی بدون crash ادامه پیدا می‌کند؛ محاسبه فاصله در fallback غیرفعال است.
- navigation_url و rating از payload حذف شدند (2026-09-23): صفر مصرف‌کننده در فرانت و تست — نقشه از مختصات مستقیم استفاده می‌کند (Neshan SDK) و مسیریابی سمت کلاینت ساخته نمی‌شود.
- رتبه‌بندی جستجو: `is_promoted DESC → distance ASC → id` (شاخه spatial) و `is_promoted DESC → created DESC → id` (fallback) — سرویس جداگانه SearchRankingService حذف شد (dead code، صفر مصرف‌کننده).
- «نردبان کسب‌وکار» (درخواست گلستانی): `PATCH /admin/businesses/{id}/promote` با `is_promoted` بولین — تنها مسیر تغییر این فیلد، فقط ادمین، ضد mass-assignment، با audit log (`business.promoted`). دکمه/سوییچ در میزکار ادمین کسب‌وکارها.

## API

`GET /api/search/businesses`

پارامترها: `q`, `category`, `city`, `neighborhood`, `verified`, `rating`, `open`, `subscription_level`, `showcase`, `latitude`, `longitude`, `radius`, `page`, `limit`.

Response شامل business fields استاندارد، coordinates، distance، verification_badge، badges، is_promoted، is_claimed، license_verified، license_tracking_code، logo، phone، services و description است (rating و navigation_url در 2026-09-23 حذف شدند — صفر مصرف‌کننده).

## Frontend

- `/search` با search bar، فیلتر شهر، result cards، تماس و لینک پروفایل ساخته شد.
- مسیرهای SEO-friendly `/category/[slug]` و `/[city]/[category]` با metadata و canonical اضافه شدند.
- HomeSearch به search واقعی و انتخاب شهر متصل شد.
- بخش map provider-agnostic است؛ بدون SDK اجباری، مختصات و توضیح مکانی همیشه قابل استفاده‌اند.

## Cache و schema

Geometry migration و index موجود حفظ شدند. برای taxonomy مستقل Category/Province/City/Neighborhood و cache فهرست‌ها، schema رسمی فعلی وجود نداشت؛ این بخش بدون حدس‌زدن مدل جدید وارد قرارداد فعلی نشد.

## تست و وضعیت (به‌روزشده 2026-09-23)

- PHPUnit: PASS — 320 tests (شامل 7 تست جدید BusinessPromotionTest: authz ادمین/کاربر/مهمان، ضد mass-assignment، ترتیب نردبان).
- Frontend node --test: PASS — 103 tests. tsc --noEmit: PASS.
- Browser verification: PASS — promote از میزکار ادمین → DB/audit/جستجوی عمومی → ترتیب is_promoted DESC سپس distance ASC در عمل اثبات شد (promoted 488m قبل از 0m غیر-promoted)؛ خاموش‌کردن → بازگشت ترتیب فاصله‌ای؛ bypass کاربر عادی 403، مهمان 401؛ بدون refetch/regression.

## Backup

Snapshot نهایی در `backup/phase-3-final/` ایجاد می‌شود و `.env`، vendor، node_modules، build output و cache را شامل نمی‌کند.
