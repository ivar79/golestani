<?php

// E2E staging setup (run via: php artisan tinker storage/e2e_setup.php)
// Creates/refreshes the dedicated E2E owner + test business. NO real payments.

$u = App\Models\User::where('phone', '09330000001')->first();
if (!$u) {
    $u = App\Models\User::create([
        'phone' => '09330000001',
        'name' => 'E2E Test Owner',
        'password' => bcrypt('E2ePass!2026'),
        'email' => 'e2e-owner@test.local',
        'is_active' => true,
    ]);
    $u->assignRole('business_owner');
    echo 'CREATED user ' . $u->id . PHP_EOL;
} else {
    echo 'EXISTS user ' . $u->id . PHP_EOL;
}

$b = App\Models\Business::where('slug', 'e2e-test-biz')->first();
if (!$b) {
    $b = $u->businesses()->create([
        'name' => 'کسب‌وکار تست E2E',
        'slug' => 'e2e-test-biz',
        'status' => 'approved',
        'category' => 'خدمات تستی',
        'phone' => '02155667788',
        'city' => 'تهران',
        'address' => 'خیابان تست، پلاک ۱۲',
        'description' => 'کسب‌وکار ساخته‌شده برای آزمون پایان‌به‌انتهای فاز ۴ تا ۶.',
    ]);
    echo 'CREATED business ' . $b->id . PHP_EOL;
} else {
    echo 'EXISTS business ' . $b->id . PHP_EOL;
}

echo 'plan2=حرفه‌ای id: ' . App\Models\Plan::where('slug', 'professional')->value('id') . PHP_EOL;
echo 'DONE' . PHP_EOL;
