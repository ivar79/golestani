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
- navigation_url در response از مختصات تولید می‌شود و منطق provider در database ذخیره نمی‌شود.
- `SearchRankingService` امتیازدهی پایه exact match، verified و کامل بودن پروفایل را جدا می‌کند؛ distance همچنان با مرتب‌سازی spatial مقدم است.

## API

`GET /api/search/businesses`

پارامترها: `q`, `category`, `city`, `neighborhood`, `verified`, `rating`, `open`, `subscription_level`, `showcase`, `latitude`, `longitude`, `radius`, `page`, `limit`.

Response شامل business fields استاندارد، coordinates، distance، verification_badge، badges، rating، phone، services، description و navigation_url است.

## Frontend

- `/search` با search bar، فیلتر شهر، result cards، تماس و لینک پروفایل ساخته شد.
- مسیرهای SEO-friendly `/category/[slug]` و `/[city]/[category]` با metadata و canonical اضافه شدند.
- HomeSearch به search واقعی و انتخاب شهر متصل شد.
- بخش map provider-agnostic است؛ بدون SDK اجباری، مختصات و توضیح مکانی همیشه قابل استفاده‌اند.

## Cache و schema

Geometry migration و index موجود حفظ شدند. برای taxonomy مستقل Category/Province/City/Neighborhood و cache فهرست‌ها، schema رسمی فعلی وجود نداشت؛ این بخش بدون حدس‌زدن مدل جدید وارد قرارداد فعلی نشد.

## تست و وضعیت

- PHP syntax: PASS.
- Frontend lint/typecheck/build: PASS پس از اجرای نهایی لازم است.
- PHPUnit: pending Docker/PostgreSQL verification؛ محیط host فاقد SQLite PDO است و تست backend Pass محسوب نمی‌شود.

## Backup

Snapshot نهایی در `backup/phase-3-final/` ایجاد می‌شود و `.env`، vendor، node_modules، build output و cache را شامل نمی‌کند.
