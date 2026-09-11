<?php
// Exact browser origins; fail closed rather than silently allowing '*'.
$raw = (string) env('CORS_ALLOWED_ORIGINS', env('FRONTEND_URL', 'http://localhost:3000'));
$origins = array_values(array_filter(
    array_map(static fn(string $x): string => rtrim(trim($x), '/'), explode(',', $raw)),
    static fn(string $x): bool => $x !== '' && $x !== '*'
));
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => $origins, 'allowed_origins_patterns' => [],
    // Range must be allowed: PMTiles clients (protomaps-leaflet) send it on
    // cross-origin byte-range requests, which triggers a CORS preflight.
    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With', 'Range'],
    'exposed_headers' => [], 'max_age' => 600, 'supports_credentials' => false,
];
