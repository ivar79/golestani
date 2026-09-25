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

    /** Phase 3 cold start: unclaimed rows are map-only — they never ride the
     *  paginated result set, so pagination describes exactly the claimed cards. */
    public function test_unclaimed_businesses_do_not_consume_claimed_pagination_slots(): void
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

        // data holds ONLY the claimed row (the listable set).
        $res->assertJsonCount(1, 'data');
        $this->assertSame('claimed-cafe', $res->json('data.0.slug'));
        $this->assertTrue($res->json('data.0.is_claimed'));

        // ...and the unclaimed row is reported separately as a map pin.
        $res->assertJsonCount(1, 'unclaimed');
        $this->assertSame('unclaimed-cafe', $res->json('unclaimed.0.slug'));
        $this->assertFalse($res->json('unclaimed.0.is_claimed'));

        // Pagination now matches the visible card list exactly (no subtraction).
        $this->assertSame(1, $res->json('pagination.total'));
        $this->assertSame(1, $res->json('pagination.last_page'));
        $this->assertSame(1, $res->json('pagination.unclaimed_total'));
    }

    /** Regression: a page full of unclaimed rows must not shrink the claimed
     *  card count — the previous implementation interleaved them into `data`
     *  and hid them client-side, so each page showed fewer cards than `limit`
     *  while `total`/`last_page` described the combined set. */
    public function test_claimed_page_is_full_even_when_surrounded_by_unclaimed_rows(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        // 3 claimed rows and a larger pool of unclaimed ones, interleaved on
        // purpose by id order so a naive LIMIT would mix them.
        foreach (range(1, 3) as $i) {
            $owner->businesses()->create(['name' => "رستوران زنده $i", 'slug' => "claimed-$i", 'status' => 'approved']);
            $owner->businesses()->create(['name' => "رستوران سرد $i", 'slug' => "unclaimed-$i", 'status' => 'approved', 'is_claimed' => false]);
        }
        // Two more unclaimed rows so they outnumber the claimed set.
        foreach (range(4, 5) as $i) {
            $owner->businesses()->create(['name' => "رستوران سرد $i", 'slug' => "unclaimed-$i", 'status' => 'approved', 'is_claimed' => false]);
        }

        // limit == the claimed count: if unclaimed rows were interleaved into
        // the page, fewer than 3 claimed cards would come back.
        $res = $this->getJson('/api/search/businesses?q=رستوران&limit=3')->assertOk();

        // Exactly `limit` claimed cards — unclaimed rows never stole a slot.
        $res->assertJsonCount(3, 'data');
        foreach ($res->json('data') as $row) {
            $this->assertTrue($row['is_claimed'], 'data must contain only claimed rows');
        }
        // All 5 unclaimed rows survive as map pins.
        $res->assertJsonCount(5, 'unclaimed');
        foreach ($res->json('unclaimed') as $row) {
            $this->assertFalse($row['is_claimed']);
        }

        // total/last_page describe the CLAIMED set only: 3 claimed → 1 page.
        $this->assertSame(3, $res->json('pagination.total'));
        $this->assertSame(1, $res->json('pagination.last_page'));
        $this->assertSame(5, $res->json('pagination.unclaimed_total'));
    }

    /** Regression: a claimed set larger than one page paginates normally and
     *  unclaimed rows never inflate the page count. */
    public function test_claimed_pagination_page_count_excludes_unclaimed_rows(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        // 4 claimed + 3 unclaimed, limit 2 → claimed needs 2 pages; the
        // unclaimed rows must not push that to a 4th page.
        foreach (range(1, 4) as $i) {
            $owner->businesses()->create(['name' => "کافه زنده $i", 'slug' => "c-$i", 'status' => 'approved']);
        }
        foreach (range(1, 3) as $i) {
            $owner->businesses()->create(['name' => "کافه سرد $i", 'slug' => "u-$i", 'status' => 'approved', 'is_claimed' => false]);
        }

        $page1 = $this->getJson('/api/search/businesses?q=کافه&limit=2&page=1')->assertOk();
        $page1->assertJsonCount(2, 'data');
        $this->assertSame(4, $page1->json('pagination.total'));
        $this->assertSame(2, $page1->json('pagination.last_page'));
        $this->assertSame(3, $page1->json('pagination.unclaimed_total'));

        $page2 = $this->getJson('/api/search/businesses?q=کافه&limit=2&page=2')->assertOk();
        $page2->assertJsonCount(2, 'data');
        // Page 2 is the last claimed page — unclaimed rows do not create a 3rd.
        $this->assertSame(2, $page2->json('pagination.last_page'));
        $this->assertNull($page2->json('pagination.next_page'));
    }

    /** Regression: filters apply to BOTH sets — an unclaimed row outside the
     *  filter scope must not surface as a map pin either. */
    public function test_filters_apply_to_claimed_and_unclaimed_sets(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $owner->businesses()->create(['name' => 'پیتزا کلیم', 'slug' => 'c-tehran', 'status' => 'approved', 'city' => 'تهران']);
        $owner->businesses()->create(['name' => 'پیتزا سرد', 'slug' => 'u-tehran', 'status' => 'approved', 'city' => 'تهران', 'is_claimed' => false]);
        $owner->businesses()->create(['name' => 'پیتزا سرد شیراز', 'slug' => 'u-shiraz', 'status' => 'approved', 'city' => 'شیراز', 'is_claimed' => false]);

        $res = $this->getJson('/api/search/businesses?q=پیتزا&city=تهران')->assertOk();

        $res->assertJsonCount(1, 'data');
        $this->assertSame('c-tehran', $res->json('data.0.slug'));

        // Only the Tehran unclaimed pin — the Shiraz one is out of scope.
        $res->assertJsonCount(1, 'unclaimed');
        $this->assertSame('u-tehran', $res->json('unclaimed.0.slug'));
    }

    /** Regression: the map-only set carries coordinates for pins, and on a
     *  real PostGIS server both sets carry distance with the approved spatial
     *  ordering (nearest-first, promoted-first). SQLite has no ST_Distance, so
     *  the distance-specific assertions run only there — the deeper real-PostGIS
     *  proof lives in PostgisRadiusIntegrationTest. */
    public function test_unclaimed_pins_carry_coordinates_and_spatial_data_where_available(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $owner->businesses()->create(['name' => 'نزدیک', 'slug' => 'near', 'status' => 'approved', 'latitude' => 35.70, 'longitude' => 51.40]);
        $owner->businesses()->create(['name' => 'نزدیک سرد', 'slug' => 'near-unclaimed', 'status' => 'approved', 'is_claimed' => false, 'latitude' => 35.71, 'longitude' => 51.41]);

        $res = $this->getJson('/api/search/businesses?latitude=35.6892&longitude=51.389&radius=50000')->assertOk();

        // The unclaimed pin is in scope of the same radius and is map-ready.
        $res->assertJsonCount(1, 'unclaimed');
        $pin = $res->json('unclaimed.0');
        $this->assertSame('near-unclaimed', $pin['slug']);
        $this->assertFalse($pin['is_claimed']);
        $this->assertNotNull($pin['coordinates']['latitude']);
        $this->assertNotNull($pin['coordinates']['longitude']);

        // Distance is only computable on PostGIS; guard the rest of the
        // spatial-ordering contract accordingly.
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->assertNotNull($pin['distance'], 'PostGIS must attach distance to unclaimed pins');
            $distances = collect($res->json('data'))->pluck('distance')->all();
            $this->assertNotEmpty($distances);
            $this->assertNotNull($distances[0]);
        }
    }
}
