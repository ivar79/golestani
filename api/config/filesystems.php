<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same filesystem drivers.
    | Examples for most supported storage drivers are configured here for
    | reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        /*
        |----------------------------------------------------------------------
        | Card Private Files (Phase 4)
        |----------------------------------------------------------------------
        |
        | Print files (print-ready card designs, PDFs) are confidential
        | business assets. They live OUTSIDE the public disk and are served
        | ONLY through the authorized download endpoint
        | (BusinessCardController@download) after per-request ownership
        | checks. This disk intentionally omits "serve" so the framework's
        | local file-serving route never exposes it, and no storage:link
        | points at it. Production (Liara Object Storage): swap the driver
        | to "s3" with private visibility via env — no code change needed.
        |
        */

        'card_files' => [
            'driver' => 'local',
            'root' => env('CARD_FILES_DISK_ROOT', storage_path('app/private/card_files')),
            'throw' => false,
            'report' => false,
        ],

        /*
        |----------------------------------------------------------------------
        | Subscription Receipts (Phase 5 — private)
        |----------------------------------------------------------------------
        |
        | Payment receipts are confidential financial documents. Like print
        | files they live OUTSIDE the public disk (no "serve", no storage:link
        | pointer) and are served ONLY through the authorized download endpoint
        | (SubscriptionController@receipt) after owner/admin checks. Legacy
        | public copies are migrated by the idempotent command
        | `php artisan receipts:move-to-private` — deliberately NOT inside a
        | schema migration (filesystem ops must not block deployments).
        |
        */

        'receipts' => [
            'driver' => 'local',
            'root' => env('RECEIPTS_DISK_ROOT', storage_path('app/private/receipts')),
            'throw' => false,
            'report' => false,
        ],

        /*
        |----------------------------------------------------------------------
        | Template Assets (private — personal + submission scopes)
        |----------------------------------------------------------------------
        |
        | Personal templates and review-stage designer submissions are PRIVATE
        | artwork (audit finding `private-template-asset-public-disk`). They
        | live on a disk that is NOT linked into public/ and has no `serve`
        | route, so no static URL can reach them — the web server can never
        | bypass application authorization.
        |
        |   personal    → read ONLY through the ownership-checked endpoint
        |                 (/api/assets/private/{path}).
        |   submission  → published to the public disk by an explicit,
        |                 idempotent step AFTER admin approval
        |                 (TemplateAssetService::publishSubmissionAssets).
        |
        | Legacy public copies are migrated by the idempotent command
        | `php artisan template-assets:move-to-private` — deliberately NOT
        | inside a schema migration (filesystem ops must not block deploys).
        | Production (Liara Object Storage): swap the driver to "s3" with
        | private visibility via env — no code change needed.
        |
        */

        'template_assets' => [
            'driver' => 'local',
            'root' => env('TEMPLATE_ASSETS_DISK_ROOT', storage_path('app/private/template_assets')),
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
