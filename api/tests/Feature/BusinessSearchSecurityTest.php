<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression suite for audit finding `search-unclaimed-set-uncapped`.
 *
 * Before the fix, GET /api/search/businesses returned the WHOLE unclaimed
 * collection in its `unclaimed` key regardless of `limit` (the PoC got 40 map
 * rows for `limit=5` on an unauthenticated request) and the route had no
 * throttle — response cost scaled with the table, not with the request.
 *
 * The fix is two-layered and both layers are asserted here:
 *   - a server-side cap applied AFTER the spatial/promoted ordering, so the
 *     nearest/most relevant pins survive and the claimed page is untouched;
 *   - one shared per-IP throttle bucket for /search/businesses + /search/facets.
 *
 * The tests lower the limits through configuration so they stay fast while
 * still proving the mechanism; one test asserts the shipped default is applied
 * against a population larger than the cap (the original PoC shape).
 */
class BusinessSearchSecurityTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function unclaimed(User $owner, int $index, array $overrides = []): Business
    {
        return $owner->businesses()->create(array_merge([
            'name' => "کسب‌وکار سرد {$index}",
            'slug' => "cold-biz-{$index}",
            'category' => 'کافه',
            'city' => 'تهران',
            'status' => 'approved',
            'is_claimed' => false,
        ], $overrides));
    }

    private function claimed(User $owner, int $index): Business
    {
        return $owner->businesses()->create([
            'name' => "کسب‌وکار فعال {$index}",
            'slug' => "warm-biz-{$index}",
            'category' => 'کافه',
            'city' => 'تهران',
            'status' => 'approved',
            'is_claimed' => true,
        ]);
    }

    // ------------------------------------------------------------------
    // Response bounding
    // ------------------------------------------------------------------

    public function test_default_cap_bounds_the_unclaimed_collection(): void
    {
        $owner = $this->owner();
        $cap = (int) config('search.max_map_pins');

        // More rows than the cap — the exact shape of the audit PoC.
        $total = $cap + 5;
        foreach (range(1, $total) as $i) {
            $this->unclaimed($owner, $i);
        }

        $response = $this->getJson('/api/search/businesses?city=تهران')->assertOk();

        // The map set is bounded by configuration, never by the table size.
        $this->assertCount($cap, $response->json('unclaimed'));
        $this->assertSame($cap, $response->json('pagination.unclaimed_total'));
        $this->assertTrue($response->json('pagination.unclaimed_capped'));
        // Cold-start pins never ride the listable set.
        $this->assertSame([], $response->json('data'));
    }

    public function test_cap_is_configurable_and_the_flag_is_false_below_it(): void
    {
        config(['search.max_map_pins' => 25]);
        $owner = $this->owner();

        foreach (range(1, 30) as $i) {
            $this->unclaimed($owner, $i);
        }

        $response = $this->getJson('/api/search/businesses?city=تهران')->assertOk();
        $this->assertCount(25, $response->json('unclaimed'));
        $this->assertTrue($response->json('pagination.unclaimed_capped'));

        // Under the cap nothing is dropped and the flag stays false.
        Business::query()->where('is_claimed', false)->orderByDesc('id')->limit(15)->delete();
        $smaller = $this->getJson('/api/search/businesses?city=تهران')->assertOk();
        $this->assertCount(15, $smaller->json('unclaimed'));
        $this->assertSame(15, $smaller->json('pagination.unclaimed_total'));
        $this->assertFalse($smaller->json('pagination.unclaimed_capped'));
    }

    public function test_cap_slices_after_ordering_so_the_priority_pins_survive(): void
    {
        config(['search.max_map_pins' => 5]);
        $owner = $this->owner();

        $oldest = $this->unclaimed($owner, 1);
        $secondOldest = $this->unclaimed($owner, 2);
        $this->unclaimed($owner, 3);
        // Promoted pin is created after the first three: only an ordering-aware
        // cap (is_promoted DESC first) can keep it inside the first 5.
        $promoted = $this->unclaimed($owner, 4, ['is_promoted' => true]);
        $newest = $this->unclaimed($owner, 7);
        $this->unclaimed($owner, 6);
        $this->unclaimed($owner, 5);

        $rows = collect($this->getJson('/api/search/businesses?city=تهران')->assertOk()->json('unclaimed'));
        $ids = $rows->pluck('id')->all();

        $this->assertCount(5, $ids);
        // Ordering is honored BEFORE slicing: promoted first, then newest.
        $this->assertSame($promoted->id, $ids[0], 'the promoted pin must sort first and survive the cap');
        $this->assertContains($newest->id, $ids, 'the most recent pin must survive the cap');
        // Only the two lowest-priority pins fall outside the cap.
        $this->assertNotContains($oldest->id, $ids, 'the cap must drop the lowest-priority pins');
        $this->assertNotContains($secondOldest->id, $ids);
    }

    public function test_claimed_pagination_is_untouched_by_the_map_cap(): void
    {
        config(['search.max_map_pins' => 3]);
        $owner = $this->owner();

        foreach (range(1, 5) as $i) {
            $this->unclaimed($owner, $i);
        }
        foreach (range(1, 3) as $i) {
            $this->claimed($owner, $i);
        }

        $response = $this->getJson('/api/search/businesses?city=تهران&limit=2')->assertOk();

        // The claimed page keeps its own validated pagination…
        $this->assertCount(2, $response->json('data'));
        $this->assertSame(3, $response->json('pagination.total'));
        $this->assertSame(2, $response->json('pagination.last_page'));
        $this->assertSame(2, $response->json('pagination.limit'));
        // …while the map set is capped independently.
        $this->assertCount(3, $response->json('unclaimed'));
    }

    public function test_limit_and_page_validation_are_unchanged(): void
    {
        // `limit` still maxes at 50 and pagination still rejects bad pages:
        // the cap must NOT have loosened (or tightened) the input contract.
        $this->getJson('/api/search/businesses?limit=51')->assertUnprocessable();
        $this->getJson('/api/search/businesses?limit=0')->assertUnprocessable();
        $this->getJson('/api/search/businesses?page=0')->assertUnprocessable();
        $this->getJson('/api/search/businesses?latitude=35&longitude=51&radius=100001')->assertUnprocessable();
    }

    public function test_legitimate_search_still_works_and_the_public_contract_holds(): void
    {
        $owner = $this->owner();
        $this->claimed($owner, 1);
        $this->unclaimed($owner, 1);

        $response = $this->getJson('/api/search/businesses?city=تهران')->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertCount(1, $response->json('unclaimed'));
        $this->assertFalse($response->json('pagination.unclaimed_capped'));
        // Public read for guests is intentional and must stay available.
        $this->assertNull($response->json('data.0.user_id'));
    }

    public function test_unclaimed_rows_expose_only_the_documented_fields(): void
    {
        $owner = $this->owner();
        $this->unclaimed($owner, 1);

        $row = $this->getJson('/api/search/businesses?city=تهران')->assertOk()->json('unclaimed.0');

        $this->assertSame([
            'id', 'slug', 'name', 'category', 'city', 'neighborhood', 'address',
            'coordinates', 'distance', 'verification_badge', 'badges',
            'is_promoted', 'is_claimed', 'license_verified', 'license_tracking_code',
            'logo', 'phone', 'services', 'description',
        ], array_keys($row));
    }

    // ------------------------------------------------------------------
    // Rate limiting
    // ------------------------------------------------------------------

    public function test_search_requests_are_throttled_per_ip(): void
    {
        config(['search.rate_limit_per_minute' => 3]);

        foreach (range(1, 3) as $i) {
            $this->getJson('/api/search/businesses')->assertOk();
        }

        $this->getJson('/api/search/businesses')->assertStatus(429);
    }

    public function test_search_and_facets_share_one_budget(): void
    {
        config(['search.rate_limit_per_minute' => 3]);

        // Two searches + one facets call exhaust the shared bucket — a separate
        // bucket per route would have allowed six requests here.
        $this->getJson('/api/search/businesses')->assertOk();
        $this->getJson('/api/search/businesses')->assertOk();
        $this->getJson('/api/search/facets')->assertOk();

        $this->getJson('/api/search/facets')->assertStatus(429);
    }
}
