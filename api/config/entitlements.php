<?php

/*
|--------------------------------------------------------------------------
| InKart Entitlement Catalog — تک منبع حقیقت امکانات
|--------------------------------------------------------------------------
| The catalog defines EVERY keyed capability the subscription system can
| grant. Plans reference these keys inside their `features` JSON column;
| the resolver normalizes plan JSON against this catalog so unknown keys,
| wrong types, or missing keys can never leak into authorization decisions.
|
| Adding a new capability = add ONE entry here. No migration, no resolver
| change, no admin-frontend change (the admin entitlement editor renders
| itself from GET /admin/entitlements/catalog).
|
| Types:
|   bool — feature is on/off                    (e.g. showcase)
|   list — allowed values for a choice field    (e.g. card_templates)
|   int  — numeric limit; null means unlimited  (e.g. max_cards)
|
| NOTE: this catalog is ENGINEERING configuration. The BUSINESS values
| (which plan gets what, at which price) are set by the site admin from
| the Admin Panel — see docs/SUBSCRIPTION_ARCHITECTURE.md section N.
*/

return [

    // ---- Entitlement catalog -------------------------------------------
    // key => [type, fa label, group, free value]
    'catalog' => [
        'card_editor' => ['bool', 'کارت‌ساز دیجیتال', 'کارت ویزیت', true],

        'card_templates' => ['list', 'قالب‌های کارت', 'کارت ویزیت', ['classic', 'local']],
        'card_themes' => ['list', 'پالت‌های رنگی', 'کارت ویزیت', ['navy', 'emerald']],
        'card_fonts' => ['list', 'قلم‌ها', 'کارت ویزیت', ['sans', 'vazir']],
        'card_exports' => ['list', 'فرمت‌های خروجی', 'کارت ویزیت', ['png']],
        'print_file' => ['bool', 'نگهداری فایل طرح چاپی', 'کارت ویزیت', false],

        'max_cards' => ['int', 'حداکثر کارت ویزیت', 'محدودیت‌ها', 1],
        'max_showcases' => ['int', 'حداکثر آیتم ویترین', 'محدودیت‌ها', 0],
        'max_ads' => ['int', 'حداکثر آگهی', 'محدودیت‌ها', 0],

        'showcase' => ['bool', 'ویترین محصولات و خدمات', 'بازاریابی', false],
        'ads' => ['bool', 'تبلیغات ویژه در جایگاه‌ها', 'بازاریابی', false],
    ],

    // ---- Free tier (default entitlement state) --------------------------
    // Free is NOT a fake plan row and NOT "subscription = null": it is the
    // baseline every business resolves to before any plan JSON is applied.
    'free_tier' => [
        'name' => 'Free',
        'label' => 'پلن رایگان',
        'description' => 'شروع رایگان با امکانات پایه برای هر کسب‌وکار.',
        'capabilities' => [
            'card_editor' => true,
            'card_templates' => ['classic', 'local'],
            'card_themes' => ['navy', 'emerald'],
            'card_fonts' => ['sans', 'vazir'],
            'card_exports' => ['png'],
            'print_file' => false,
            'max_cards' => 1,
            'max_showcases' => 0,
            'max_ads' => 0,
            'showcase' => false,
            'ads' => false,
        ],
    ],

    // ---- Subscription lifecycle policies --------------------------------
    // Each knob carries its business question as a TODO comment. The DEFAULT
    // is the conservative engineering choice; the final call belongs to the
    // business owner (docs/SUBSCRIPTION_ARCHITECTURE.md § N).
    'policies' => [

        // POLICY [decided]: snapshot_entitlements.
        // A subscription keeps the entitlements its plan had AT ACTIVATION
        // TIME. Later admin edits to the plan apply only to NEW purchases.
        // (Alternative rejected as default: live_plan_entitlements.)
        // TODO(business): confirm that future plan changes must NOT apply to
        // existing active subscribers.
        'entitlements' => 'snapshot',

        // POLICY [TODO(business)]: upgrade/downgrade timing. Current manual
        // flow: a new request replaces the old subscription at admin
        // approval → effective immediately. Options for a future payment
        // era: immediate | next_billing_cycle | prorated | end_of_period.
        'plan_change' => 'immediate',

        // POLICY [TODO(business)]: grace days after end_date. 0 = current
        // behaviour (expired means expired). >0 would extend access after
        // expiry without payment — needs an explicit business decision.
        'grace_days' => 0,

        // POLICY [TODO(business)]: what an expired/locked owner may do with
        // an EXISTING saved premium card design. Values:
        //   'readonly'          — view and re-save identical values, no new premium features, no export of premium designs
        //   'allow_export'      — also allow exporting an already-premium design
        // 'readonly' never deletes or mutates stored data on expiry.
        'expired_card_access' => 'readonly',

        // POLICY [TODO(business)]: may the owner of an expired premium
        // design still download the stored private print file? true keeps
        // the file accessible read-only; false locks it behind renewal.
        'expired_print_file_download' => false,

        // Single-active-subscription invariant. When admin approves a new
        // subscription while another is active, the old one is marked
        // expired with this note (supersede). Keep true — two concurrent
        // active subscriptions for one business make entitlement resolution
        // ambiguous.
        'supersede_on_activation' => true,
    ],
];
