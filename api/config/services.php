<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // PMTiles archive (Phase 1 of the PMTiles migration) — served by
    // PmtilesController at /api/map/basemap.pmtiles with byte ranges (206) so
    // protomaps-leaflet can read header/directory/tile chunks directly over HTTP.
    'pmtiles_path' => env('PMTILES_PATH'),

    // Legacy MBTiles key: kept only until the PMTiles rollout is fully
    // verified, then remove together with MbtilesServer/MapTileController::tile.
    'mbtiles_path' => env('MBTILES_PATH'),

];
