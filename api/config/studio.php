<?php

/*
|--------------------------------------------------------------------------
| Card Studio — rate limits
|--------------------------------------------------------------------------
| Request throttling is DEFENSE IN DEPTH only: it is never a substitute for
| authorization or document validation. Two independent buckets keep the
| editor usable while bounding abusive write bursts:
|
|   card_write       — card save (PUT/POST .../card) + template apply, one
|                      shared per-USER bucket so hopping between endpoints
|                      cannot reset the quota. Sized well above the editor's
|                      debounced autosave (~40/min) with generous headroom.
|
|   studio_authoring — personal/gallery template authoring, a separate,
|                      heavier and less frequent workflow that must NOT
|                      consume the card-write quota.
|
| Override per environment with CARD_WRITE_RATE_LIMIT / STUDIO_AUTHORING_RATE_LIMIT.
*/

return [
    'rate_limits' => [
        'card_write' => (int) env('CARD_WRITE_RATE_LIMIT', 120),
        'studio_authoring' => (int) env('STUDIO_AUTHORING_RATE_LIMIT', 30),
    ],
];
