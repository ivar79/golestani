<?php

/*
|--------------------------------------------------------------------------
| Public search — response bounding + rate limits
|--------------------------------------------------------------------------
| The public search endpoint answers unauthenticated requests, so both its
| RESPONSE SIZE and its REQUEST VOLUME have to be bounded server-side
| (audit finding `search-unclaimed-set-uncapped`).
|
|   max_map_pins            Map-only (unclaimed cold-start) pins returned per
|                           request. Applied AFTER the spatial/promoted
|                           ordering, so the nearest pins always survive and
|                           the claimed result page is never truncated (it
|                           has its own validated `limit`, max 50).
|
|   rate_limit_per_minute   Requests per IP per minute for the public browse
|                           endpoints. /search/businesses and /search/facets
|                           share ONE bucket (limiter `public-search`,
|                           AppServiceProvider) so alternating between them
|                           cannot reset the quota.
|
| Override per environment with SEARCH_MAX_MAP_PINS / SEARCH_RATE_LIMIT.
| Throttling is defense in depth: it never replaces validation.
*/

return [
    'max_map_pins' => (int) env('SEARCH_MAX_MAP_PINS', 200),
    'rate_limit_per_minute' => (int) env('SEARCH_RATE_LIMIT', 60),
];
