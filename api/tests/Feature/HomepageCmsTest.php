<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminController;
use App\Models\User;
use Database\Seeders\HomepageSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Regression tests for the homepage CMS endpoint.
 *
 * Historical bug: with an unseeded site_settings table, publicHomepage()
 * cached the empty payload for 5 minutes — the homepage rendered blank
 * even after seeding until the cache was manually flushed.
 */
class HomepageCmsTest extends TestCase
{
    use RefreshDatabase;

    public function test_homepage_payload_contains_seeded_content(): void
    {
        $this->seed(HomepageSeeder::class);

        $response = $this->getJson('/api/public/homepage');
        $response->assertOk();

        $payload = $response->json();
        $this->assertNotEmpty($payload);
        $this->assertArrayHasKey('homepage.hero.title', $payload);
        $this->assertNotSame('', $payload['homepage.hero.title']);
        $this->assertArrayHasKey('homepage.brand', $payload);
    }

    public function test_empty_settings_are_never_cached(): void
    {
        // No seeder: site_settings is empty.
        Cache::forget(AdminController::HOMEPAGE_CACHE_KEY);

        $response = $this->getJson('/api/public/homepage');
        $response->assertOk();

        $this->assertSame([], $response->json());

        // The guard must NOT have cached the empty payload...
        $this->assertNull(Cache::get(AdminController::HOMEPAGE_CACHE_KEY));

        // ...so seeding afterwards is visible on the very next request.
        $this->seed(HomepageSeeder::class);
        $payload = $this->getJson('/api/public/homepage')->json();
        $this->assertArrayHasKey('homepage.hero.title', $payload);
    }

    public function test_populated_payload_is_cached_and_flushed_on_setting_save(): void
    {
        $this->seed(HomepageSeeder::class);

        $this->getJson('/api/public/homepage')->assertOk();
        $this->assertNotNull(Cache::get(AdminController::HOMEPAGE_CACHE_KEY));

        // Saving any CMS setting flushes the cache so edits appear immediately.
        $admin = User::factory()->create(['phone' => '09000000001']);
        $admin->assignRole('admin');

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/homepage.hero.title', ['value' => 'عنوان به‌روزشده'])
            ->assertOk();

        $this->assertNull(Cache::get(AdminController::HOMEPAGE_CACHE_KEY));
        $payload = $this->getJson('/api/public/homepage')->json();
        $this->assertSame('عنوان به‌روزشده', $payload['homepage.hero.title']);
    }

    public function test_greeting_schedule_setting_roundtrips_through_public_payload(): void
    {
        $admin = User::factory()->create(['phone' => '09000000009']);
        $admin->assignRole('admin');

        $schedule = json_encode([
            'timezone' => 'Asia/Tehran',
            'slots' => [
                ['id' => 'morning',  'start' => '05:00', 'end' => '11:00', 'label' => 'صبح بخیر',       'message' => null],
                ['id' => 'forenoon', 'start' => '11:00', 'end' => '16:00', 'label' => 'ظهر بخیر', 'message' => null],
                ['id' => 'evening',  'start' => '16:00', 'end' => '21:00', 'label' => 'عصر بخیر',       'message' => null],
                ['id' => 'night',    'start' => '21:00', 'end' => '05:00', 'label' => 'شب بخیر',        'message' => null],
            ],
        ], JSON_UNESCAPED_UNICODE);

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/dashboard.greeting.schedule', ['value' => $schedule])
            ->assertOk();

        // The key must be whitelisted so non-admin dashboards can read it.
        $payload = $this->getJson('/api/public/homepage')->json();
        $this->assertArrayHasKey('dashboard.greeting.schedule', $payload);
        $this->assertSame($schedule, $payload['dashboard.greeting.schedule']);
    }
}
