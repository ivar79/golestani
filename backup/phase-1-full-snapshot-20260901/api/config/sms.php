<?php

return [
    'driver' => env('SMS_DRIVER', 'log'),

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
