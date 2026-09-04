<?php

/*
|--------------------------------------------------------------------------
| Cross-Origin Resource Sharing (CORS)
|--------------------------------------------------------------------------
|
| The app authenticates with Bearer tokens (Authorization header), not
| stateful Sanctum cookies. Therefore `supports_credentials` stays false and
| there is no CSRF/cookie concern. Allowed origins are driven by environment
| so Preview can stay permissive and Production can be locked to the Vercel
| domain without code changes.
|
|   CORS_ALLOWED_ORIGINS=https://your-app.vercel.app          (comma-separated)
|   Unset / empty  ->  *  (Preview: allow any origin)
|
*/

$raw = (string) env('CORS_ALLOWED_ORIGINS', '');
$origins = $raw === ''
    ? ['*']
    : array_values(array_filter(array_map('trim', explode(',', $raw)), static fn (string $p): bool => $p !== ''));

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    // If CORS_ALLOWED_ORIGINS is set, use it; otherwise fall back to '*'
    // (preview). A single '*' is typed explicitly so fruitcake treats it as
    // "allow all origins" rather than a literal host.

    'allowed_origins' => $origins,

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,

];
