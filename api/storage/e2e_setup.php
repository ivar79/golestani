<?php

/**
 * E2E fixture loader — run via: php artisan tinker storage/e2e_setup.php
 *
 * Creates/refreshes the dedicated E2E owner + test business. NO real payments,
 * NO administrator account, NO production data.
 *
 * SECURITY RULES (Phase 5 admin-identity hardening, CWE-798):
 *  1. NOTHING about the identity is stored in this file. The owner phone and
 *     password MUST come from the environment:
 *         E2E_OWNER_PHONE     09xxxxxxxxx
 *         E2E_OWNER_PASSWORD  at least 16 characters
 *         E2E_BUSINESS_PHONE  optional contact number for the fixture business
 *     A fixed, reusable credential in source is exactly the weakness this file
 *     used to carry; there is none left (a regression test enforces it).
 *  2. ENVIRONMENT GUARD: refuses to touch anything unless app.env is one of
 *     local / testing / staging. Production is refused outright, so a stray
 *     `tinker storage/e2e_setup.php` on a production box cannot create or
 *     overwrite accounts.
 *  3. FAIL CLOSED: missing or invalid configuration throws BEFORE any write.
 *     (Throwing — rather than terminating the PHP process — keeps the script
 *     callable from tests.)
 *  4. The created account is a business_owner — never an administrator. The
 *     admin role is provisioned only out of band (php artisan admin:provision).
 */

$environment = (string) config('app.env', 'production');

if (! in_array($environment, ['local', 'testing', 'staging'], true)) {
    throw new RuntimeException(
        'e2e_setup refuses to run in "'.$environment.'". Allowed environments: local, testing, staging.'
    );
}

$phone = trim((string) getenv('E2E_OWNER_PHONE'));
$password = (string) getenv('E2E_OWNER_PASSWORD');
$businessPhone = trim((string) getenv('E2E_BUSINESS_PHONE'));

if (preg_match('/^09[0-9]{9}$/', $phone) !== 1) {
    throw new RuntimeException('E2E_OWNER_PHONE is missing or not a valid Iranian mobile number (09xxxxxxxxx).');
}

if (mb_strlen($password) < 16) {
    throw new RuntimeException('E2E_OWNER_PASSWORD is missing or shorter than 16 characters.');
}

$user = App\Models\User::where('phone', $phone)->first();

if (! $user) {
    $user = App\Models\User::create([
        'phone' => $phone,
        'name' => 'E2E Test Owner',
        'password' => bcrypt($password),
        'email' => 'e2e-owner@test.local',
        'is_active' => true,
    ]);
    $user->assignRole('business_owner');
    echo 'CREATED user '.$user->id.PHP_EOL;
} else {
    echo 'EXISTS user '.$user->id.PHP_EOL;
}

$business = App\Models\Business::where('slug', 'e2e-test-biz')->first();

if (! $business) {
    $business = $user->businesses()->create(array_filter([
        'name' => 'کسب‌وکار تست E2E',
        'slug' => 'e2e-test-biz',
        'status' => 'approved',
        'category' => 'خدمات تستی',
        'phone' => $businessPhone !== '' ? $businessPhone : null,
        'city' => 'تهران',
        'address' => 'خیابان تست، پلاک ۱۲',
        'description' => 'کسب‌وکار ساخته‌شده برای آزمون پایان‌به‌انتهای فاز ۴ تا ۶.',
    ], fn ($value) => $value !== null));
    echo 'CREATED business '.$business->id.PHP_EOL;
} else {
    echo 'EXISTS business '.$business->id.PHP_EOL;
}

echo 'DONE'.PHP_EOL;
