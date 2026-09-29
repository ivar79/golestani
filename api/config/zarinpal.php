<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Online payment gateway (ZarinPal)
    |--------------------------------------------------------------------------
    | SECURITY:
    |  - The merchant ID (credential) lives ONLY in the environment. Nothing
    |    here hardcodes a secret, and nothing is exposed to the frontend.
    |  - `env` switches sandbox vs production: URLs, and the v4 request
    |    currency field, are chosen from it. Moving to production requires a
    |    .env change ONLY — never a code change.
    |  - `sandbox` uses the well-known public sandbox merchant
    |    (00000000-0000-0000-0000-000000000000) that ZarinPal's sandbox
    |    accepts without a real account; production reads
    |    ZARINPAL_MERCHANT_ID from env and REFUSES to boot without it.
    |--------------------------------------------------------------------------
    */

    'env' => env('ZARINPAL_ENV', 'sandbox'), // sandbox | production

    // Public, documented SANDBOX-only merchant. NEVER valid in production
    // (production resolves through the guarded merchantId() accessor).
    'sandbox_merchant_id' => '00000000-0000-0000-0000-000000000000',
    'merchant_id' => env('ZARINPAL_MERCHANT_ID', ''),

    'request_timeout' => (int) env('ZARINPAL_TIMEOUT', 15),

    // OPTIONAL absolute path to a PEM CA bundle for machines whose system
    // trust store is broken (some Windows dev boxes: cURL error 60 on every
    // https call). TLS verification itself is NEVER disabled; production
    // servers leave this empty and use the normal system verification.
    // Example: C:\\tools\\cacert.pem  (downloaded from curl.se/ca/cacert.pem)
    'cacert' => env('ZARINPAL_CACERT', ''),

    'urls' => [
        'sandbox' => [
            'request' => 'https://sandbox.zarinpal.com/pg/v4/payment/request.json',
            'verify' => 'https://sandbox.zarinpal.com/pg/v4/payment/verify.json',
            'start_pay' => 'https://sandbox.zarinpal.com/pg/StartPay/',
        ],
        'production' => [
            'request' => 'https://payment.zarinpal.com/pg/v4/payment/request.json',
            'verify' => 'https://payment.zarinpal.com/pg/v4/payment/verify.json',
            'start_pay' => 'https://payment.zarinpal.com/pg/StartPay/',
        ],
    ],

    // Pending transactions older than this are pruned to `expired` by the
    // payment:prune-pending command (recovery path for abandoned checkouts).
    'pending_ttl_hours' => (int) env('PAYMENT_PENDING_TTL_HOURS', 24),
];
