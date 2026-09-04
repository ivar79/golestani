<?php

return [
    'driver' => env('SMS_DRIVER', 'log'),

    /*
    |--------------------------------------------------------------------------
    | OTP Demo Mode (Preview only)
    |--------------------------------------------------------------------------
    |
    | When true, the LogSmsDriver makes the generated OTP observable so a client
    | can complete login without a real SMS gateway. It is ONLY honoured for
    | non-production environments — production never exposes the code, even if
    | this flag is accidentally set to true.
    |
    | Preview:  OTP_DEMO_MODE=true
    | Production: OTP_DEMO_MODE=false (default)
    |
    */

    'otp_demo_mode' => env('OTP_DEMO_MODE', true),

    'drivers' => [
        'log' => \App\Services\Sms\Drivers\LogSmsDriver::class,
        'http' => \App\Services\Sms\Drivers\HttpSmsDriver::class,
    ],

    'http' => [
        'url' => env('SMS_GATEWAY_URL'),
        'api_key' => env('SMS_GATEWAY_API_KEY'),
        'api_key_header' => env('SMS_GATEWAY_API_KEY_HEADER', 'Authorization'),
        'headers' => [],
        'phone_field' => env('SMS_GATEWAY_PHONE_FIELD', 'phone'),
        'message_field' => env('SMS_GATEWAY_MESSAGE_FIELD', 'message'),
        'timeout' => (int) env('SMS_GATEWAY_TIMEOUT', 10),
        'retries' => (int) env('SMS_GATEWAY_RETRIES', 2),
        'retry_sleep' => (int) env('SMS_GATEWAY_RETRY_SLEEP', 200),
    ],
];
