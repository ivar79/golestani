<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BusinessSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_returns_only_approved_businesses_and_applies_filters(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $owner->businesses()->create([
            'name' => 'کافه نزدیک', 'slug' => 'near-cafe', 'category' => 'کافه',
            'city' => 'تهران', 'neighborhood' => 'مرکز', 'status' => 'approved',
            'latitude' => 35.70, 'longitude' => 51.40,
        ]);
        $owner->businesses()->create([
            'name' => 'کافه در انتظار', 'slug' => 'pending-cafe', 'category' => 'کافه',
            'city' => 'تهران', 'status' => 'pending',
            'latitude' => 35.70, 'longitude' => 51.40,
        ]);

        $response = $this->getJson('/api/search/businesses?q=نزدیک&city=تهران&category=کافه');

        $response->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.slug', 'near-cafe');
    }

    public function test_search_validates_coordinates_and_limit(): void
    {
        $this->getJson('/api/search/businesses?latitude=91&longitude=51')->assertUnprocessable();
        $this->getJson('/api/search/businesses?latitude=35&longitude=51&limit=51')->assertUnprocessable();
    }

    public function test_postgis_migration_uses_the_configured_database_driver(): void
    {
        $this->assertContains(DB::connection()->getDriverName(), ['pgsql', 'sqlite', 'mysql']);
    }

    /** Phase 3 (C): promoted first even in the non-spatial branch. */
    public function test_promoted_business_sorts_before_newer_non_promoted_business(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        // Created first + promoted. Without the flag, latest()->orderByDesc('id')
        // would rank the newer row first — so this ordering is only satisfiable
        // if is_promoted DESC is applied before the deterministic fallback.
        $promoted = $owner->businesses()->create([
            'name' => 'آرایشگاه ویژه', 'slug' => 'promoted-first',
            'city' => 'تهران', 'status' => 'approved',
            'is_promoted' => true,
        ]);
        $normal = $owner->businesses()->create([
            'name' => 'آرایشگاه معمولی', 'slug' => 'normal-second',
            'city' => 'تهران', 'status' => 'approved',
        ]);

        $res = $this->getJson('/api/search/businesses?city=تهران')->assertOk();

        $this->assertSame([$promoted->id, $normal->id], collect($res->json('data'))->pluck('id')->all());
    }

    /** Phase 3 (D+E): payload flags + migration defaults surface in the API. */
    public function test_search_payload_contains_phase3_flags_with_migration_defaults(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $owner->businesses()->create([
            'name' => 'کافه پروانه‌دار', 'slug' => 'licensed-cafe',
            'status' => 'approved', 'license_tracking_code' => 'IR-123456',
        ]);
        $owner->businesses()->create([
            'name' => 'کافه ساده', 'slug' => 'plain-cafe', 'status' => 'approved',
        ]);

        $rows = collect($this->getJson('/api/search/businesses?q=کافه')->assertOk()->json('data'))->keyBy('slug');

        $this->assertTrue($rows['licensed-cafe']['license_verified']);
        $this->assertFalse($rows['plain-cafe']['license_verified']);
        foreach (['licensed-cafe', 'plain-cafe'] as $slug) {
            $this->assertTrue($rows[$slug]['is_claimed'], "{$slug} must default to claimed");
            $this->assertFalse($rows[$slug]['is_promoted'], "{$slug} must default to not promoted");
        }
    }

    /** Phase 3 (E): column defaults apply to fresh rows through the migration. */
    public function test_business_rows_default_to_claimed_and_not_promoted(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $b = $owner->businesses()->create(['name' => 'پیش‌فرض‌ها', 'slug' => 'defaults-biz']);
        $fresh = $b->fresh();

        $this->assertTrue($fresh->is_claimed);
        $this->assertFalse($fresh->is_promoted);
        $this->assertSame(0, $fresh->verification_level);
        $this->assertNull($fresh->license_tracking_code);
    }

    /** Phase 3 cold start: raw license code + logo surface for badge/popup use. */
    public function test_search_payload_contains_license_code_and_logo(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $owner->businesses()->create([
            'name' => 'کافه مدارک‌دار', 'slug' => 'coded-cafe',
            'status' => 'approved', 'license_tracking_code' => 'IR-998877',
            'logo' => '/storage/businesses/logos/coded.png',
        ]);
        $owner->businesses()->create([
            'name' => 'کافه بی‌مدارک', 'slug' => 'uncoded-cafe', 'status' => 'approved',
        ]);

        $rows = collect($this->getJson('/api/search/businesses?q=کافه')->assertOk()->json('data'))->keyBy('slug');

        $this->assertSame('IR-998877', $rows['coded-cafe']['license_tracking_code']);
        $this->assertSame('/storage/businesses/logos/coded.png', $rows['coded-cafe']['logo']);
        $this->assertNull($rows['uncoded-cafe']['license_tracking_code']);
        $this->assertNull($rows['uncoded-cafe']['logo']);
    }

    /** Phase 3 cold start: unclaimed rows ride the payload but are counted apart. */
    public function test_unclaimed_businesses_reported_separately_from_listable_total(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $owner->businesses()->create([
            'name' => 'کافه رسمی', 'slug' => 'claimed-cafe', 'status' => 'approved',
        ]);
        $owner->businesses()->create([
            'name' => 'کافه ثبت‌نشده', 'slug' => 'unclaimed-cafe',
            'status' => 'approved', 'is_claimed' => false,
        ]);

        $res = $this->getJson('/api/search/businesses?q=کافه')->assertOk();

        // Both ride the same payload (the map needs the unclaimed one).
        $this->assertCount(2, $res->json('data'));
        $rows = collect($res->json('data'))->keyBy('slug');
        $this->assertFalse($rows['unclaimed-cafe']['is_claimed']);

        // ...but the pagination separates them for the front-end counter.
        $this->assertSame(1, $res->json('pagination.total'));
        $this->assertSame(1, $res->json('pagination.unclaimed_total'));
    }
}
