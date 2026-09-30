# گزارش Phase 3 — Professional Card Studio + Save Integrity

> **تاریخ:** 2026-09-30 · **شاخه:** `main` · **baseline:** `6726ab2` (Phase 1–2)
> **Commitهای این فاز:**
> - `8c7eac0` fix(card-studio): enforce tier-aware save budget and close luxury-effect partial save
> - `1c1762d` feat(entitlements): grant professional full studio access via seeder values
> - `3b6d14b` refactor(card-studio): redesign studio shell (tool rail, compact header, canvas-first workspace)

---

## ۱. ریشهٔ واقعی «بخشی از طرح ذخیره نشد» (۴ عامل قطعی)

| # | ریشه | مکانیزم خرابی | فیکس |
|---|---|---|---|
| ۱ | **`effect` (متریال لوکس) در whitelist سرور نبود** | `CardDesignValidator::validateLayer` هر لایه را از صفر بازسازی می‌کند؛ فیلد ناموجود = drop بی‌صدا → Gold/Glass/Neon بعد از save+reload محو می‌شد ولی روی بوم دیده می‌شد | whitelist += `effect` با enum بسته + قرارداد «فقط وقتی present باشد emit شود» (سندهای قدیمی byte-identical می‌مانند) |
| ۲ | **`MAX_RAW_D = 20KB` سرور بدون هیچ گارد فرانت** | خروجی `outlineToD` هر نقطهٔ perfect-freehand را ~۲۰ بایت می‌نویسد؛ قلم‌مو کشیده = 422 خام | سقف ساختاری ۶۰KB (ظرفیت فرم Q→C-expanded) + آینهٔ دقیق در `domain/saveLimits.ts` + نردبان optimize بدون truncate |
| ۳ | **زاویهٔ چرخش گروهی از ±360 عبور می‌کرد** | `transientGroupRotate` زاویه را تجمعی می‌نوشت؛ validator بی‌صدا clamp می‌کند → کارت بعد از reload در ژست متفاوت بود | `wrapAngle` به (−180,180] در موتور |
| ۴ | **هیچ کدام از سقف‌ها در فرانت آینه نداشتند** (۱۰۰KB سند، ۵۰۰ نقطه، لایه) | سند بد → 422 کور بدون توضیح | پیش‌بودجهٔ صادقانه: سندِ نامعتبر هرگز روی wire نمی‌رود؛ کاربر پیام فارسی دقیق می‌بیند (تعداد لایه/حجم/نقطه) |

**تست زندهٔ نهایی:** ذخیرهٔ ribbon با rawD=۲۴,۹۹۵ بایت → `PUT 200` (قبلاً 422)؛ `effect:"gold"` → reload → `gold`.

## ۲. سیاست Tier-محور (بازخورد محصولی اعمال شد)

`budgetForTier(maxLayers)` — unlimited از **خود entitlement** می‌آید (`max_layers === null`)، هرگز از نام پلن:

| Tier | rawD | رفتار خارج از بودجه |
|---|---|---|
| **Professional** (`max_layers: null`) | سقف ساختاری ۶۰KB | **بدون simplify خودکار** — فقط warning؛ هندسه byte-for-byte |
| **Starter** (`30`) | ۲۰KB | اول نردبان optimize (Q→C → گرد کردن ۱ رقم → ۰ رقم) → فقط اگر باز جا نشد warning؛ هرگز truncate |
| **Free** (کاتالوگ، ۶۰) | ۲۰KB | همان Starter |

- Professional اول بودجه را بالا می‌برد، بعد هشدار، بعد optimize اختیاری — دقیقاً همان ترتیب درخواستی.
- `documentBudget` هر سند را قبل از هر save audit می‌کند و violations فارسی نام‌بردار برمی‌گرداند.

## ۳. ممیزی Entitlement (قبل از اجرا انجام شد)

- **معماری سالم بود:** `FeatureGate::limit()` با قرارداد `null = unlimited`، فرانت فقط `capabilities` را مصرف می‌کند، enforcement دو لایه‌ای (validator ساختاری + `entitlementGuard` کنترلر). هیچ bypass و هیچ hardcode لازم نبود.
- **مشکل فقط داده‌ای بود:** `EditorPlanSeeder` پلن‌های پرداختی را **بدون کلیدهای layered-editor** می‌ساخت → مشترک Professional عملاً به free-tier (۶۰ لایه، export بدون SVG/PDF) سقوط می‌کرد.
- **فیکس:** seeder اکنون قرارداد کامل ادیتور را صریح می‌نویسد — Professional: `max_layers/max_cards: null`، exports `png/jpg/svg/pdf`؛ Starter: ‏۳۰ لایه، `png/jpg`. سقف ساختاری validator (حالا ۱۲۰ لایه) فقط سقف امنیتی است، نه سهمیهٔ پلن.
- `useEntitlements` در CardStudio وصل شد: `engine.setSavePolicy(limitOf(caps,"max_layers"))` — تغییر snapshot پلن خودکار policy موتور را به‌روز می‌کند.

## ۴. تغییرات UI (Shell Redesign)

- **Tool Rail عمودی** (`role=toolbar`, 9 ابزار): جایگزین تب افقی «ابزارها»؛ gating کامل entitlement + shape picker popover سمت چپ rail + آپلود تصویر حفظ شد. هیچ کنترل تقلبی اضافه نشد.
- **Header باریک sticky:** undo/redo + نام سند + وضعیت ذخیرهٔ زنده (ذخیره شد / در حال ذخیره… / تغییرات ذخیره‌نشده / خطا + تلاش دوباره) — از `SaveQueue` واقعی می‌آید نه timer تزئینی. Traffic-lightهای تزئینی حذف شدند.
- **Workspace بوم‌محور:** `min-w-0 flex-1` برای Stage ( دیگر overflow نمی‌کند)، rail + inspector در سمت راست (RTL-first).
- **رفع اشکال مرتبط:** `persistRef` نوشتن در render → effect (`react-hooks/refs`)؛ ۲ directive منقضی eslint حذف شد.
- **Preview mode:** بدون هیچ chrome ویرایشی (سر جایش).

## ۵. تست‌ها و شواهد

| سطح | تست | نتیجه |
|---|---|---|
| domain | `saveLimits.test.ts` (NEW — ۹ تست: نردبان fit بدون truncate، سیاست tier، wrapAngle، audit) | ✅ |
| domain | `saveChain.test.ts` +۳ (effect round-trip، ribbon عظیم ≤ MAX_RAW_D، wrap زاویهٔ گروه) → ۱۱۲ | ✅ |
| API | `CardDesignJsonTest` +۲ (effect round-trip + drop مقدار hostیل، ribbon ۲۵KB) و به‌روزرسانی `oversized_raw_d` برای سقف ۶۰KB → ۱۹ | ✅ |
| **API کل** | `php artisan test` | **442 passed / 7 skipped / 2218 assertions** |
| **وب کل** | `npx vitest run` | **532 passed / 29 فایل** |
| `tsc --noEmit` | | exit 0 |
| `eslint src` | | 0 error (9 warning — همهٔ جدیدها صفر؛ 6 از قبل + 3 warning مجاز دیگر) |
| `node --test` | | 121 pass / 0 fail |
| `npm run build` | | exit 0 |

**شواهد مرورگری (localhost:3000 + docker API):**
1. افزودن لایهٔ متن → autosave → وضعیت «ذخیره شد» → GET سرور: ۶ لایه، آخرین `text` ✅
2. Reload → ۶/۶ لایه روی بوم، هم‌ترتیب (reload exact) ✅
3. `effect:"gold"` روی API زنده → PUT 200 → reload → `gold` ✅ (نیازمند restart کانتینر به‌خاطر opcache — مستند شد)
4. ribbon ۲۴,۹۹۵ بایتی → PUT 200 (قبلاً 422) ✅

## ۶. نکات عملیاتی و محدودیت‌های شناخته‌شده

- **Docker opcache:** تغییرات PHP تا restart کانتینر `golestani-api` اعمال نمی‌شوند (dev). در deploy، `php artisan config:clear` + restart در pipeline باشد.
- اندپوینت `/api/businesses/my/card` وجود ندارد (رفتار قدیمی فرانت)؛ فرانت همیشه id واقعی می‌زند — ولی یک `500` pg روی wildcard بهتر است در فاز بعد به 404 تمیز تبدیل شود (خارج از scope این فاز).
- نردبان optimize در capped tierها کسری از pixels را گرد می‌کند (۱ رقم اعشار) — از نظر بصری نامرئی، ولی دقیقاً مستند است.
- الگوی ورود تستی (کاربر + نقش `business_owner` + business/card) برای بازبینی بصری ساخته شد؛ داده‌های dev است و در prod اثری ندارد.

## ۷. معیار نهایی پذیرش

> اگر کاربر روی کارت تغییر ایجاد کند، بعد از Save و Reload همان طراحی را می‌بیند — اکنون برای هر چهار ریشهٔ خرابی، تست اتومات + شواهد زنده وجود دارد و هیچ «بخشی از طرح ذخیره نشد» بدون Root Cause باقی نمی‌ماند.
