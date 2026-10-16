<?php

/*
|--------------------------------------------------------------------------
| Wallet & designer commission — business knobs
|--------------------------------------------------------------------------
| Money in this subsystem is ALWAYS an integer number of RIAL, and the
| display unit in the UI is TOMAN (1 toman = 10 rial) — see
| web/src/lib/money.ts and Plan::priceRial() for the single ×10 conversion.
|
| NOTHING here connects to a payment gateway or a bank: payouts are made
| MANUALLY by an admin outside the system (پایا / اینترنت‌بانک) and the
| tracking number is recorded by hand.
*/

return [

    'commission' => [
        /* Accrue a commission for EVERY paid purchase (renewals, upgrades and
         * scheduled starts included), not only for the first activation of a
         * subscription. Set to false to pay only the first purchase of each
         * subscription — the accrual keys already make each purchase
         * exactly-once, so flipping this never double-pays. */
        'on_renewal' => (bool) env('WALLET_COMMISSION_ON_RENEWAL', true),

        /* How the percentage multiplication is rounded to a whole rial.
         * 'round_half_up' keeps the designer's share fair on odd amounts;
         * change to 'floor' if the business prefers to never round up. */
        'rounding' => env('WALLET_COMMISSION_ROUNDING', 'round_half_up'),
    ],

    /* Settlement wording + wait window.
     *
     * BOTH VALUES ARE ONLY THE INITIAL DEFAULT: an admin edits the effective
     * values in the admin panel (tab «کیف پول و تسویه»), which stores them in
     * the project's `site_settings` key/value table. Everything reads them
     * through App\Services\Wallet\WalletSettings — never from config directly. */
    'settlement' => [
        /* Shown to the designer on their wallet page and next to every payout
         * request: what "تسویه" means in this product, in plain Persian. */
        'note' => env(
            'WALLET_SETTLEMENT_NOTE',
            'تسویه‌ها به‌صورت دستی و در بازه‌های کاری انجام می‌شود؛ پس از تأیید درخواست، مبلغ به شماره شبای ثبت‌شدهٔ شما واریز می‌گردد.',
        ),

        /* Calendar days from approval to the estimated bank transfer. Used as
         * the default «تاریخ پیش‌بینی‌شدهٔ واریز» when the admin approves a
         * request without naming an explicit date. */
        'days' => (int) env('WALLET_SETTLEMENT_DAYS', 7),
    ],

    'withdrawals' => [
        /* Master switch for SUBMITTING a payout request. The admin panel can
         * flip it (e.g. while a bank problem is investigated); open requests
         * keep moving through the admin workflow untouched. */
        'enabled' => (bool) env('WALLET_WITHDRAWALS_ENABLED', true),

        /* Minimum single request, in RIAL (default 1,000,000 ریال = ۱۰۰٬۰۰۰ تومان).
         * Below this the manual bank transfer costs more than it moves. */
        'min_amount_rial' => (int) env('WALLET_MIN_WITHDRAWAL_RIAL', 1_000_000),

        /* Open (pending/approved) requests allowed per designer at once. */
        'max_open_requests' => (int) env('WALLET_MAX_OPEN_REQUESTS', 1),

        /* Freeze withdrawals for this many hours after the payout bank account
         * CHANGES (a fresh OTP is required for that change too). This is the
         * counter-measure against a hijacked session redirecting a payout: an
         * attacker would need the victim's phone AND 24 hours of silence.
         * The FIRST registration does not start the cooldown. 0 disables it. */
        'bank_change_cooldown_hours' => (int) env('WALLET_BANK_CHANGE_COOLDOWN_HOURS', 24),
    ],

    /* OTP delivered to the account's own phone before a bank account is
     * registered or changed. `send_per_window` mirrors the login OTP budget. */
    'bank_account_otp' => [
        'send_per_window' => (int) env('WALLET_BANK_OTP_SENDS', 3),
    ],

    /* Rate limits for the designer write path. Defense in depth only — the
     * authoritative checks are the balance/ownership rules in
     * App\Services\Wallet\WithdrawalService. */
    'rate_limits' => [
        'withdrawal_request' => (int) env('WALLET_WITHDRAWAL_RATE_LIMIT', 5),
    ],
];
