# معماری Subscription / Plan / Entitlement — گزارش پیاده‌سازی InKart

> **تاریخ:** 2026-09-23
> **محدوده:** سیستم اشتراک واقعی B2B/SaaS برای کارت‌ساز و قابلیت‌های کسب‌وکار
> **وضعیت:** پیاده‌سازی کامل + تست (۳۱۳ بک‌اند / ۱۰۳ فرانت‌اند — همه سبز) + وریفای مرورگر

---

## A. ممیزی معماری فعلی (پیش از تغییر)

**سالم و حفظ‌شده:** `Plan` (features JSON) + `Subscription` (جریان دستی رسید → تأیید ادمین → فعال با تاریخ) + `FeatureGate` + `subscriptions:expire` + نوتیفیکیشن‌ها + `GET /plans` بدون قیمت هاردکد.

**شکاف‌های شناسایی‌شده:**
1. plans فاقد identity (slug)، display (sort_order/featured/public)، توضیحات، currency
2. Features فقط boolean — بدون numeric limits و بدون کاتالوگ سمت سرور
3. بدون pricing snapshot — تغییر قیمت پلن، گزارش درآمد را retroactive تغییر می‌داد
4. **بدون entitlement snapshot** — تغییر Plan روی اشتراک‌های فعالِ موجود ناخواسته اعمال می‌شد
5. AdminPlansTab هنگام ساخت پلن features هاردکد می‌فرستاد (`{showcase:true, ads:true}`) — entitlement را فرانت تعیین می‌کرد
6. بدون مسیر upgrade/downgrade (store با اشتراک فعال 422 می‌داد)
7. duplicate activation ممکن بود (دو اشتراک active همزمان برای یک business)
8. ادیتور کارت هیچ awareness‌ای به entitlement نداشت؛ Free فقط «null بودن subscription» بود

## B. تصمیم معماری کلیدی: Entitlement Snapshot Policy

| | live_plan_entitlements | **snapshot_entitlements ✅ (انتخابی)** |
|---|---|---|
| تغییر Plan | روی اشتراک‌های فعال هم فوراً اعمال | فقط خریداران جدید؛ مشتری فعلی امکانات زمان خرید را نگه می‌دارد |
| پیاده‌سازی | وضعیت قبلی (ساده اما خطرناک) | `entitlements` JSON روی subscription، نوشته‌شده در لحظه activation |
| versioning جدول plan_versions | — | رد شد: برای این مقیاس over-engineering است؛ JSON per-row self-contained و audit-friendly است |
| تمدید | — | تمدید = activation جدید → snapshot تازه از پلن فعلی (عادلانه و طبیعی) |

**قوانین اعمال‌شده:**
- `moderate(status=active)` → features **فعلی** پلن نرمالایز و در `subscriptions.entitlements` ثبت می‌شود
- `FeatureGate` همیشه از snapshot می‌خواند، هرگز از `plan->features` زنده
- **سازگاری با رکوردهای قدیمی:** `entitlements=null` → fallback به resolve زنده (self-healing؛ رفتار legacy حفظ شد)
- تغییر Plan: خریداران جدید config فعلی می‌گیرند؛ activeها دست‌نخورده

**ثبت در تصمیمات تجاری (بخش N):** اینکه تغییرات آینده Plan روی مشتریان فعلی اعمال شود یا نه، تصمیم کسب‌وکاری است — پیش‌فرض فنی snapshot است و باید توسط گلستانی تأیید شود.

## C. Data Model

**Migration 1 — `2026_09_23_000001_enrich_plans_for_product_configuration`:**
`slug` (unique، تغییرناپذیر پس از ساخت)، `description`، `currency` (default IRR)، `sort_order`، `is_featured`، `is_public`

**Migration 2 — `2026_09_23_000002_add_snapshots_to_subscriptions`:**
- پولی (در store): `plan_name`, `price_amount`, `price_currency`, `duration_days`
- entitlements (در activation): `entitlements` JSON nullable

**بدون جدول جدید** — کاتالوگ typed سمت سرور اعتبارسنجی می‌کند (قانون: جدول جدید فقط وقتی domain واقعاً بخواهد).

## D. کاتالوگ Entitlement ها (`config/entitlements.php`)

تک منبع حقیقت؛ هر کلید: `[type, label فارسی, group, free_value]`:

| کلید | نوع | Free |
|---|---|---|
| card_editor | bool | true |
| card_templates | list | classic, local |
| card_themes | list | navy, emerald |
| card_fonts | list | sans, vazir |
| card_exports | list | png |
| print_file | bool | false |
| max_cards | int | 1 |
| max_showcases | int | 0 |
| max_ads | int | 0 |
| showcase | bool | false |
| ads | bool | false |

افزودن قابلیت جدید = **یک خط در config** — بدون migration، بدون تغییر resolver، بدون تغییر فرانت admin (ادیتور admin از `GET /admin/entitlements/catalog` خودش را می‌سازد).

## E. FeatureGate Evolution (تک سرویس مرجع)

```
activeSubscription()  [موجود — حفظ شد]
allows()              [امضا همان؛ حالا از snapshot با fallback]
allowsValue()         [جدید: membership در list capabilities]
limit()               [جدید: int|null — null = نامحدود]
capabilities()        [جدید: Free defaults ⊕ snapshot]
payload()             [جدید: قرارداد کامل برای فرانت]
normalize()           [جدید: نرمالایز plan JSON با کاتالوگ — کلید ناشناخته/نوع غلط هرگز leak نمی‌کند]
```

Resolution: snapshot (یا legacy live) ⊕ free tier. کلید ناشناخته **هرگز** grant نمی‌شود. `grace_days` knob موجود (default 0).

## F. Backend Authoritative — نقاط اعمال

- `BusinessCardController`: save با **value-level entitlement check** per-field + grandfathering مقادیر ذخیره‌شده + `max_cards` limit + قفل export/print پس از انقضا — 403 با `entitlement_errors` ماشین‌خوان + `entitlements` (برای re-sync فرانت)
- `ShowcaseController::store`: gate + `max_showcases` limit
- `AdvertisementController::store`: gate + `max_ads` limit
- `SubscriptionController::store`: قیمت فقط از DB (ورودی کلاینت نادیده) + snapshot پولی + خرید فقط از پلن active
- `SubscriptionController::moderate`: invariant تک‌اشتراک فعال (supersede) + نوشتن snapshot + backfill رکوردهای قدیمی
- Admin plan CRUD: اعتبارسنجی features با کاتالوگ (کلید ناشناخته/نوع غلط = 422)، slug تغییرناپذیر (`prohibited`)
- `reports()`: درآمد از `price_amount` snapshot

## G. Admin Panel (بدون دخالت Developer)

`AdminPlansTab` بازنویسی شد: CRUD کامل (نام، slug auto، توضیحات، قیمت، مدت، ترتیب ↑↓، featured، public، active) + **ویرایشگر features/limits رندرشده از کاتالوگ سرور** — bool → checkbox، int → number (خالی = ∞)، list → comma-separated. هشدار UI به اپراتور: «تغییرات فقط برای خریداران جدید اعمال می‌شود؛ اشتراک‌های فعال snapshot خود را نگه می‌دارند.» هاردکد `{showcase:true, ads:true}` حذف شد.

## H. Public API و Pricing

`GET /plans` → `{ free_tier, labels (از کاتالوگ), plans (فقط active+public، مرتب با sort_order) }`. صفحه قیمت‌گذاری: کارت Free از config، لیست امکانات داینامیک (`planFeatureLines`)، badge «پیشنهاد ویژه» از `is_featured`، قیمت فقط از API.

## I. Frontend (`lib/entitlements.ts` + `components/cards/FeatureGate.tsx`)

- **تفکیک مسئولیت‌ها:** Authentication → AuthContext • Authorization → Laravel (authoritative) • Subscription state → backend snapshot • Entitlement → این provider (mirror فقط برای UX) • Editor UI state → card-maker local
- `EntitlementProvider` + `useEntitlements()` / `useCardEntitlements()` + `<LockedOverlay>` / `<PremiumBadge>` / `<UsageMeter>` — badge «ویژه»، disabled، توضیح فارسی، CTA ارتقا
- card-maker: قالب‌های قفل visible با overlay، پالت‌های قفل با badge، فونت‌های قفل disabled در select، دکمه‌های export با badge، پنل فایل چاپی با پیام ارتقا، usage meter کارت‌ها
- **stale-cap safety:** 403 با `entitlement_errors` → بنر + re-sync قرارداد از سرور
- فرانت **هرگز** security boundary نیست؛ تست‌ها هاردکد-بن را enforcement می‌کنند

## J. Limits

Boolean + numeric + unlimited (`null`) — هر دو نوع پشتیبانی می‌شوند. تست: limit=2 → دو مورد اول Created، سومی 403 `limit_reached`. `max_cards=null` → نامحدود.

## K. Expiration & Grandfathering (طرح‌های ذخیره‌شده)

| سناریو | رفتار |
|---|---|
| subscription expires | status=expired توسط command؛ entitlement → Free |
| باز کردن طرح premium موجود | خواندن verbatim؛ قالب ذخیره‌شده با برچسب «ذخیره‌شده — قابل نگهداری» |
| ویرایش طرح premium پس از انقضا | همان value قبلی مجاز (grandfathering)؛ سوئیچ به قالب premium دیگر = 403 |
| export طرح premium پس از انقضا | 403 — POLICY `expired_card_access=readonly` |
| دانلود فایل چاپی پس از انقضا | 403 — POLICY `expired_print_file_download=false`؛ فایل destroy نمی‌شود |
| downgrade | هیچ داده‌ای حذف/تغییر نمی‌کند؛ فقط قفل‌ها |
| upgrade دوباره | activation جدید → snapshot تازه → دسترسی کامل؛ طرح‌های قبلی دست‌نخورده |

همه policyها در `config/entitlements.php` با TODO(business) مستند شده‌اند — هیچ قاعده تجاری silently هاردکد نشده.

## L. Upgrade/Downgrade

فعلاً: درخواست جدید حتی با اشتراک فعال مجاز → با تأیید ادمین، قبلی supersede (expired با یادداشت). POLICY `plan_change=immediate` مستند؛ برای دوران payment: `next_billing_cycle | prorated | end_of_period` به‌عنوان گزینه‌ها ثبت شده‌اند.

## M. Payment (نقطه اتصال)

```
Plan → Order → Payment → Verified → Subscription(+snapshots) → Entitlement
```
Gateway قفل نشده؛ جریان دستی فعلی دقیقاً از مرز `store()`/`moderate()` عبور می‌کند. IPG آینده فقط باید `moderate(status=active)` را پس از verification صدا بزند — هیچ تغییر معماری لازم نمی‌شود.

## N. Security

- **IDOR:** ownership scoping همه endpointها (تست: کاربر پرداخت‌کرده به کارت business دیگران 403)
- **mass assignment:** `plan_name/price_*/duration_days/entitlements` غیر-fillable؛ store از DB کپی می‌کند؛ کلاینت `price_amount:1, currency:USD, entitlements:{...}` می‌فرستد → نادیده (تست شده)
- **plan manipulation:** `plan_id` فقط id؛ پلن باید active باشد؛ قیمت/مدت از DB
- **entitlement manipulation:** snapshot فقط server-side نوشته می‌شود؛ کلید ناشناخته در plan-save = 422
- **direct API bypass:** free user با fetch مستقیم قالب premium → 403 `entitlement_errors` (تست بک‌اند + وریفای مرورگر)
- **expired access:** همه premium paths دوباره entitlement می‌گیرند
- **duplicate activation:** supersede invariant؛ همیشه دقیقاً یک active
- **admin-only plan management:** `role:admin` روی همه مسیرهای admin/plans + catalog

## O. Tests

**Backend (۳۱۳ passed / ۷ skipped، ۱۴۵۸ assertions):**
- `SubscriptionArchitectureTest` (۲۱): free defaults، paid unlock، limits، unlimited، snapshot freeze، plan edit ≠ active subscribers، legacy fallback، renewal re-snapshot، supersede، activation نیاز به پلن فعال، money snapshot، price manipulation، revenue از snapshot، deactivation (خرید بلاک/اشتراک معتبر)، public/hidden plans، slug immutability، unknown key 422، wrong type 422، catalog admin-only، expiry → free
- `CardEntitlementTest` (۱۶): free OK/locked، show contract، bypass قالب/export/print-file، print-file download، max_cards، paid unlock کامل، expired: switch 403 / re-save identical 200 / export 403 / download locked / re-upgrade بدون data loss، IDOR، show از snapshot نه live plan
- سازگاری: `PhaseFourCardTest` (attach paid plan در مسیرهای print-file)، `PhaseFiveTest` بدون تغییر

**Frontend (۱۰۳ passed — ۸۲ موجود + ۲۱ جدید `entitlements.test.cjs`):** کاتالوگ‌محوری، limit helpers، 403 parsing، هاردکد-بن (بدون `plan.features?.showcase`، بدون `price = 5000000`، بدون `plan === 'gold'`، بدون `is_premium`)، UX-only documentation، grandfathering visibility، stale-403 sync، provider wrapping، admin catalog-driven + snapshot warning

**Typecheck:** `tsc --noEmit` پاک • **Build:** `next build` موفق

## P. Browser Verification (واقعی — Chrome، سرورهای محلی up)

- `/pricing`: Free tier (۱۱ آیتم از کاتالوگ) + استارتر ۹۹٬۰۰۰ (بدون print-file) + حرفه‌ای ۲۴۹٬۰۰۰ با badge «پیشنهاد ویژه» — همه از API
- **Free user:** ۳ overlay قفل روی قالب‌ها (midnight/emerald/creative)، ۷ badge «ویژه»، فونت serif و JPG disabled — پیام فارسی + CTA ارتقا
- **Bypass مستقیم:** `fetch` با قالب premium → `403 {entitlement_errors:{template:"locked"}}`
- **Paid user (حرفه‌ای):** صفر overlay/بadge/disabled؛ save قالب creative + export jpg → 200؛ `source=snapshot`
- **Snapshot behavior:** ادمین پلن را محدود کرد → مشتری فعال همان ۵ قالب را دارد و save premium 200 می‌گیرد؛ **خریدار جدید** همان لحظه فقط `["classic"]` و `print_file=false` گرفت — بدون deploy، بدون تغییر کد
- پلن پس از آزمایش restore شد؛ رکوردهای تست پاک شدند

## Q. Business Decisions Required from Golestani

> این موارد عمداً در config با TODO(business) گذاشته شده‌اند و مقدار پیش‌فرض محافظه‌کارانه دارند. **Developer هیچ قیمت یا ساختار تجاری‌ای در کد تعیین نکرده است.**

1. **تأیید snapshot policy:** تغییرات آینده Plan روی مشتریان فعلی اعمال نشود؟ (پیش‌فرض: خیر)
2. **نام/تعداد پلن‌ها:** فعلاً استارتر/حرفه‌ای seed شده‌اند — placeholder؛ نام واقعی را ادمین تعیین کند
3. **قیمت‌ها و مدت:** seed فقط نمونه است (۹۹/۲۴۹ هزار تومان) — ادمین از پنل تغییر دهد
4. **امکانات و limits هر پلن:** مقادیر seed نمونه‌اند (max_cards=3/10 و …)
5. **پلن featured/نمایش:** کدام پلن «پیشنهاد ویژه» باشد
6. **expired_card_access:** طرح premium پس از انقضا export شود؟ (پیش‌فرض: خیر)
7. **expired_print_file_download:** فایل چاپی پس از انقضا دانلود شود؟ (پیش‌فرض: خیر)
8. **grace_days:** دوره مهلت پس از انقضا؟ (پیش‌فرض: ۰)
9. **upgrade policy:** immediate / next cycle / prorated؟ (پیش‌فرض فعلی: immediate در تأیید ادمین)
10. **refund policy** و **Currency** (پیش‌فرض IRR)

## R. Files Changed

**Backend:** `config/entitlements.php` • `app/Services/FeatureGate.php` • `app/Models/Plan.php` • `app/Models/Subscription.php` • `app/Http/Controllers/Api/SubscriptionController.php` • `app/Http/Controllers/Api/BusinessCardController.php` • `app/Http/Controllers/Api/ShowcaseController.php` • `app/Http/Controllers/Api/AdvertisementController.php` • `routes/api.php` • `database/migrations/2026_09_23_000001_*` • `database/migrations/2026_09_23_000002_*` • `database/seeders/EditorPlanSeeder.php` • `database/seeders/DatabaseSeeder.php` • `tests/Feature/SubscriptionArchitectureTest.php` • `tests/Feature/CardEntitlementTest.php` • `tests/Feature/PhaseFourCardTest.php`

**Frontend:** `src/lib/entitlements.ts` • `src/lib/subscriptions.ts` • `src/lib/admin.ts` • `src/components/cards/FeatureGate.tsx` • `src/app/card-maker/page.tsx` • `src/components/ui/pricing-section.tsx` • `src/components/admin/AdminPlansTab.tsx` • `tests/entitlements.test.cjs`

## S. Final Definition of Done

- [x] Plan = product configuration؛ ادمین همه‌چیز را بدون کد مدیریت می‌کند
- [x] قیمت/entitlement صفر هاردکد در فرانت (تست-اجرا شده)
- [x] Backend authoritative در همه نقاط (بایپس = 403 ساختاریافته)
- [x] snapshot_entitlements + money snapshot + legacy fallback
- [x] Free = default state قابل نمایش در pricing
- [x] Boolean + numeric + unlimited limits
- [x] طرح‌های ذخیره‌شده هرگز با تغییر پلن/انقضا از بین نمی‌روند (grandfathering)
- [x] upgrade/downgrade با invariant تک‌اشتراک فعال
- [x] نقطه اتصال Payment بدون قفل‌شدن
- [x] Security: IDOR / mass-assignment / manipulation / bypass — همگی تست
- [x] ۳۱۳ بک‌اند + ۱۰۳ فرانت‌اند سبز، typecheck پاک، build موفق
- [x] وریفای مرورگر واقعی: free / paid / bypass / snapshot behavior / pricing
- [x] گزارش + تصمیمات تجاری تفکیک‌شده برای گلستانی

## T. Template System (فاز ۵ — داده‌محور)

سیستم قالب‌ها از کاتالوگ استاتیک فرانت به معماری داده‌محور با «یک قرارداد سروری» تبدیل شد.

### T.1 سه نوع قالب و منبع حقیقت
| نوع | منبع | مدیریت | گیت |
|---|---|---|---|
| Builtin | `templatesCatalog.ts` → فایل کاننیکال `api/resources/card-templates/builtin-catalog.json` (تولید با `node scripts/export-builtin-catalog.mjs`) | توسعه‌دهنده | لیست `card_templates` پلن |
| DB (ادمین/طراح) | جدول `card_templates` (`origin: admin\|designer`) | پنل ادمین + moderation | pivot `card_template_plans` با `plan_id` پایدار |
| شخصی | جدول `user_card_templates` — private | فقط owner | entitlement `custom_templates` |

- `design_json` تنها Source of Truth است؛ هیچ ستون background وجود ندارد و گالری/apply پس‌زمینه را از داخل سند استخراج می‌کنند.
- `knownValues('card_templates')` = کلیدهای legacy (کارت‌ساز کلاسیک) ∪ آی‌دی‌های کاتالوگ کاننیکال — دیگر دستی نیست.

### T.2 قرارداد Apply (سروری، برای همه انواع)
`POST /card-templates/builtin/{id}/apply` • `POST /card-templates/{id}/apply` • `POST /my/templates/{id}/apply`:

```
authorize (entitlement/pivot/ownership) → deserialize → clone
  → تولید ID جدید برای تک‌تک لایه‌ها → پر کردن {{name}} {{category}} {{phone}}
  {{website}} {{address}} → برگرداندن سند + سقف‌های مصرف‌کننده (max_layers …)
```
`entitled` در گالری فقط UX است؛ دور زدن UI هرگز entitlement را دور نمی‌زند. ذخیره نهایی هم همیشه از `CardDesignValidator` (سقف‌های ساختاری 120 لایه/100KB/60KB) عبور می‌کند.

### T.3 Asset Registry — مرز امنیتی canonical
- جدول `template_assets` (`path unique, scope: system|submission|personal, owner_id, mime, …`) — رکوردها immutable و هرگز حذف نمی‌شوند؛ حذف قالب (soft) هرگز asset را پاک نمی‌کند.
- هر `src` تصویری در نوشتن قالب/شخصی/submit باید به رکورد registry resolve شود: system برای قالب سیستمی، assetهای ثبت‌شدهِ همان user برای submit/شخصی. prefix check فقط دفاع در عمق است.
- چرخه asset: `storage/templates/{master|optimized|thumbnails}` (سیستمی، با `templates:optimize-art` + `templates:import`) و `storage/templates/users/{user_id}` (خصوصی). masterها هرگز overwrite نمی‌شوند؛ derivativeها versioned هستند (`-v1`, `-v2`, …).
- حریم خصوصی: پروکسی `/api/media` مسیر `templates/users/**` را کلاً رد می‌کند (403)؛ asset شخصی فقط از `GET /assets/private/{path}` با چک ownership سرو می‌شود.

### T.4 Lifecycle
- `status: pending|approved|rejected|archived` = حالت moderation (ادمین؛ reject با reason اجباری).
- `deleted_at` = فقط soft-delete سطل زباله؛ رکورد trashed در گالری/apply/مدیریت هیچ‌جا ظاهر نمی‌شود.
- قابل‌استفاده = scope `approved()`: `deleted_at IS NULL AND status='approved'`. archive کردن قالب، کارت‌های اعمال‌شده را خراب نمی‌کند (assetهای immutable).

### T.5 برنامه طراحان
- `users.designer_status: none|pending|approved|rejected|suspended` — جدا از role و جدا از entitlement.
- دو گیت مستقل برای submit به گالری: `designer_status=approved` ∧ `custom_templates` ∧ پرچم `designer_program_enabled` (SiteSetting با whitelist در `saveSetting`؛ کلید ناشناخته/غیر-boolean ⇒ 422). خاموش‌کردن پرچم وضعیت‌های قبلی را پاک نمی‌کند.
- پلن‌های کسب‌وکار `card_editor=true` را برای ویرایش عادی حفظ می‌کنند، اما `designer_studio=false` و `custom_templates=false` دارند. سه پلن نمونهٔ طراح (`designer-starter`, `designer-pro`, `designer-studio`) به‌ترتیب سقف ۲۰/۵۰/۱۰۰ لایه و ۱/۳/۱۰ کارت دارند؛ این‌ها مقدار آغازین Seeder هستند و قیمت/محدودیت تجاری نهایی از پنل ادمین تنظیم می‌شود.
- پلن دارای `designer_studio` فقط توسط حساب با `designer_status=approved` قابل خرید است؛ این شرط پیش از ثبت درخواست اشتراک یا آغاز پرداخت بررسی می‌شود. جریان و callback زرین‌پال همان مسیر موجود را نگه می‌دارند. مجوز استفاده همچنان جداگانه، سمت سرور و برای کسب‌وکار مالک همان اشتراک اعمال می‌شود.
- انتساب قالب↔پلن در تب «قالب‌های کارت» ادمین با multi-select pivot روی `plan_id`؛ تغییر نام پلن انتساب‌ها را نمی‌شکند (تست اجرا شده).

### T.6 تست‌ها و وضعیت
- `tests/Feature/TemplateSystemTest.php` — ۱۶ تست: apply سروری builtin (403 بدون entitlement، idهای regenerated، placeholder fill)، lifecycle (pending/rejected/archived/deleted هیچ‌جا)، pivot plan_id، حریم خصوصی قالب شخصی، مرز registry (src ثبت‌نشده/متعلق به غیر ⇒ 422)، برنامه طراحان، whitelist تنظیمات، گالری merge.
- رگرسیون کامل سبز: **465 تست PHP / 2299 assertion** • 532 Vitest • tsc پاک • build موفق.
- ۳ فایل «پشت کارت» (معماری ×۲، VIP ×۱) این فاز استفاده نشدند (ادیتور فقط رو‌کارت دارد)؛ masterها در `storage/templates/master` حفظ شده‌اند.
