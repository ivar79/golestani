<?php

namespace Tests\Feature;

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
        $this->seed(\Database\Seeders\HomepageSeeder::class);

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
        Cache::forget(\App\Http\Controllers\Api\AdminController::HOMEPAGE_CACHE_KEY);

        $response = $this->getJson('/api/public/homepage');
        $response->assertOk();

        $this->assertSame([], $response->json());

        // The guard must NOT have cached the empty payload...
        $this->assertNull(Cache::get(\App\Http\Controllers\Api\AdminController::HOMEPAGE_CACHE_KEY));

        // ...so seeding afterwards is visible on the very next request.
        $this->seed(\Database\Seeders\HomepageSeeder::class);
        $payload = $this->getJson('/api/public/homepage')->json();
        $this->assertArrayHasKey('homepage.hero.title', $payload);
    }

    public function test_populated_payload_is_cached_and_flushed_on_setting_save(): void
    {
        $this->seed(\Database\Seeders\HomepageSeeder::class);

        $this->getJson('/api/public/homepage')->assertOk();
        $this->assertNotNull(Cache::get(\App\Http\Controllers\Api\AdminController::HOMEPAGE_CACHE_KEY));

        // Saving any CMS setting flushes the cache so edits appear immediately.
        $admin = \App\Models\User::factory()->create(['phone' => '09000000001']);
        $admin->assignRole('admin');

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/homepage.hero.title', ['value' => 'عنوان به‌روزشده'])
            ->assertOk();

        $this->assertNull(Cache::get(\App\Http\Controllers\Api\AdminController::HOMEPAGE_CACHE_KEY));
        $payload = $this->getJson('/api/public/homepage')->json();
        $this->assertSame('عنوان به‌روزشده', $payload['homepage.hero.title']);
    }
}
