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
        'melipayamak' => \App\Services\Sms\Drivers\MeliPayamakSmsDriver::class,
    ],

    /*
    |--------------------------------------------------------------------------
    | MeliPayamak (ملی‌پیامک)
    |--------------------------------------------------------------------------
    |
    | Activate by setting SMS_DRIVER=melipayamak once the client provides the
    | account credentials. Until then the default 'log' driver keeps working
    | unchanged. Credentials live ONLY in .env — never commit real values.
    |
    | SMS_MELIPAYAMAK_AUTH=password  -> SMS_MELIPAYAMAK_USERNAME + SMS_MELIPAYAMAK_PASSWORD
    | SMS_MELIPAYAMAK_AUTH=token     -> SMS_MELIPAYAMAK_TOKEN (REST console)
    |
    | OTP path uses the shared service line pattern: SMS_MELIPAYAMAK_BODY_ID is
    | the approved template id whose single variable is the code itself. Without
    | a bodyId the driver falls back to plain send via SMS_MELIPAYAMAK_FROM.
    |
    | The panel usually requires this server's IP in its allowed-IP list
    | (documented error -109) before production API calls are accepted.
    |
    */

    'melipayamak' => [
        'endpoint' => env('SMS_MELIPAYAMAK_ENDPOINT', 'https://rest.payamak-panel.com/api/SendSMS'),
        'auth' => env('SMS_MELIPAYAMAK_AUTH', 'password'),
        'username' => env('SMS_MELIPAYAMAK_USERNAME'),
        'password' => env('SMS_MELIPAYAMAK_PASSWORD'),
        'token' => env('SMS_MELIPAYAMAK_TOKEN'),
        'body_id' => env('SMS_MELIPAYAMAK_BODY_ID'),
        'from' => env('SMS_MELIPAYAMAK_FROM'),
        'timeout' => (int) env('SMS_MELIPAYAMAK_TIMEOUT', 10),
        'retries' => (int) env('SMS_MELIPAYAMAK_RETRIES', 2),
        'retry_sleep' => (int) env('SMS_MELIPAYAMAK_RETRY_SLEEP', 200),
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
