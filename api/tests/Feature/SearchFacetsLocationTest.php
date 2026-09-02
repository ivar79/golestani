<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Showcase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * M1 (contract Phase 3): search filters, facets, user-location persistence.
 */
class SearchFacetsLocationTest extends TestCase
{
    use RefreshDatabase;

    private function owner(string $phone): User
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $owner, array $overrides = []): Business
    {
        return $owner->businesses()->create([
            'name' => 'کسب‌وکار '.$overrides['slug'],
            'slug' => $overrides['slug'],
            'category' => $overrides['category'] ?? 'کافه',
            'city' => $overrides['city'] ?? 'تهران',
            'neighborhood' => $overrides['neighborhood'] ?? 'مرکز',
            'status' => 'approved',
        ]);
    }

    // ---------- filters ----------

    public function test_showcase_filter_returns_only_businesses_with_published_showcase(): void
    {
        $owner = $this->owner('09140000001');
        $withShowcase = $this->business($owner, ['slug' => 'with-showcase']);
        $withoutShowcase = $this->business($owner, ['slug' => 'without-showcase']);

        $withShowcase->showcases()->create(['title' => 'ویترین', 'is_published' => true]);
        $withoutShowcase->showcases()->create(['title' => 'پیش‌نویس', 'is_published' => false]);

        $ids = collect($this->getJson('/api/search/businesses?showcase=1')->json('data'))->pluck('id');

        $this->assertContains($withShowcase->id, $ids);
        $this->assertNotContains($withoutShowcase->id, $ids);
    }

    public function test_combinable_filters_city_category_and_verified(): void
    {
        $owner = $this->owner('09140000002');
        $match = $this->business($owner, ['slug' => 'match', 'city' => 'شیراز', 'category' => 'رستوران']);
        $match->update(['badges' => ['verified']]);
        $this->business($owner, ['slug' => 'wrong-city', 'city' => 'تهران', 'category' => 'رستوران']);
        $this->business($owner, ['slug' => 'wrong-category', 'city' => 'شیراز', 'category' => 'کافه']);

        $data = $this->getJson('/api/search/businesses?city=شیراز&category=رستوران&verified=1')->json('data');
        $ids = collect($data)->pluck('id');

        $this->assertContains($match->id, $ids);
        $this->assertCount(1, $ids);
    }

    // ---------- facets ----------

    public function test_facets_return_distinct_approved_values_and_cache(): void
    {
        $owner = $this->owner('09140000003');
        $this->business($owner, ['slug' => 'a', 'city' => 'تهران', 'category' => 'کافه']);
        $this->business($owner, ['slug' => 'b', 'city' => 'شیراز', 'category' => 'رستوران']);
        // pending businesses must not appear in facets
        $owner->businesses()->create([
            'name' => 'در انتظار', 'slug' => 'pending-x', 'category' => 'نباید بیاید',
            'city' => 'نباید', 'status' => 'pending',
        ]);

        $facets = $this->getJson('/api/search/facets')->assertOk()->json();

        $this->assertContains('تهران', $facets['cities']);
        $this->assertContains('شیراز', $facets['cities']);
        $this->assertNotContains('نباید', $facets['cities']);
        $this->assertContains('کافه', $facets['categories']);
        $this->assertContains('رستوران', $facets['categories']);

        // cached: second hit served from cache
        $this->assertTrue(Cache::has('search_facets_v1'));
        $this->getJson('/api/search/facets')->assertOk();
    }

    // ---------- user location ----------

    public function test_authenticated_user_can_save_update_and_clear_location(): void
    {
        $user = User::factory()->create(['phone' => '09140000004']);
        $user->assignRole('user');

        // save
        $this->actingAs($user)
            ->putJson('/api/auth/location', ['latitude' => 35.7123456, 'longitude' => 51.404321, 'label' => 'تهران، مرکز'])
            ->assertOk()
            ->assertJsonPath('location.latitude', 35.7123456)
            ->assertJsonPath('location.location_label', 'تهران، مرکز');

        $this->assertSame(35.7123456, (float) $user->fresh()->latitude);

        // returned by /me
        $this->actingAs($user)
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('location.location_label', 'تهران، مرکز');

        // update
        $this->actingAs($user)
            ->putJson('/api/auth/location', ['latitude' => 32.0, 'longitude' => 52.0, 'label' => 'اصفهان'])
            ->assertOk();
        $this->assertSame(32.0, (float) $user->fresh()->latitude);

        // clear (empty payload)
        $this->actingAs($user)->putJson('/api/auth/location', [])->assertOk();
        $this->assertNull($user->fresh()->latitude);
        $this->assertNull($user->fresh()->location_label);
    }

    public function test_location_validation_rejects_bad_input(): void
    {
        $user = User::factory()->create(['phone' => '09140000005']);
        $user->assignRole('user');

        // out of range
        $this->actingAs($user)
            ->putJson('/api/auth/location', ['latitude' => 95, 'longitude' => 51])
            ->assertUnprocessable();

        // longitude without latitude
        $this->actingAs($user)
            ->putJson('/api/auth/location', ['longitude' => 51])
            ->assertUnprocessable();
    }

    public function test_location_requires_authentication(): void
    {
        // actingAs() persists within a method, so the anonymous case gets its own test.
        $this->putJson('/api/auth/location', ['latitude' => 35.7, 'longitude' => 51.4])->assertUnauthorized();
    }

    public function test_location_is_not_settable_via_other_endpoints(): void
    {
        // horizontal-assignment guard: location only changes via /auth/location
        $user = User::factory()->create(['phone' => '09140000006']);
        $user->assignRole('user');
        $owner = $this->owner('09140000007');
        $business = $this->business($owner, ['slug' => 'loc-guard']);

        $this->actingAs($user)
            ->putJson('/api/businesses/'.$business->id, [
                'name' => 'تست', 'phone' => '09123456789', 'address' => 'تهران',
                'city' => 'تهران', 'latitude' => 1.0, 'longitude' => 2.0,
            ])
            ->assertForbidden();

        $this->assertNull($user->fresh()->latitude);
    }
}
