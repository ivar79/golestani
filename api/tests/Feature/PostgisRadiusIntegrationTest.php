<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Real PostgreSQL/PostGIS integration proof for the Phase 3 radius search.
 *
 * These tests exercise the actual ST_DWithin / ST_Distance SQL through the
 * public search endpoint against a real PostGIS server — SQLite (used by the
 * rest of the suite) cannot prove spatial behaviour.
 *
 * SAFETY: RefreshDatabase is deliberately NOT used — it would point migrations
 * at the configured server and could clobber real data. Instead each test
 * creates its own rows with UUID slugs and removes exactly those rows in a
 * finally block. Run against a scratch database where possible.
 *
 * They SKIP unless a PostGIS test server is configured:
 *   PGSQL_TEST_HOST, PGSQL_TEST_DB, PGSQL_TEST_USER, PGSQL_TEST_PASS
 * (the local docker-compose PostGIS satisfies this).
 */
class PostgisRadiusIntegrationTest extends TestCase
{
    /** @var array<int, int> business ids to remove in finally */
    private array $cleanupBusinessIds = [];

    /** @var array<int, int> user ids to remove in finally */
    private array $cleanupUserIds = [];

    protected function setUp(): void
    {
        parent::setUp();

        $host = env('PGSQL_TEST_HOST');
        if (! $host) {
            $this->markTestSkipped('PGSQL_TEST_HOST not configured — skipping real-PostGIS integration tests.');
        }

        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql.host' => $host,
            'database.connections.pgsql.database' => env('PGSQL_TEST_DB'),
            'database.connections.pgsql.username' => env('PGSQL_TEST_USER'),
            'database.connections.pgsql.password' => env('PGSQL_TEST_PASS'),
        ]);

        DB::purge('pgsql');

        // Refuse to run against a server without PostGIS (e.g. plain Postgres).
        $version = DB::selectOne("SELECT extversion FROM pg_extension WHERE extname = 'postgis' LIMIT 1");
        if (! $version) {
            $this->markTestSkipped('PostGIS extension is not installed on the configured test server.');
        }
    }

    protected function tearDown(): void
    {
        // Remove exactly the rows this test created — never a truncate.
        if ($this->cleanupBusinessIds !== []) {
            DB::table('businesses')->whereIn('id', $this->cleanupBusinessIds)->delete();
        }
        if ($this->cleanupUserIds !== []) {
            DB::table('users')->whereIn('id', $this->cleanupUserIds)->delete();
        }

        parent::tearDown();
    }

    /** Create an isolated owner + approved geo business; registers both for cleanup. */
    private function makeGeoBusiness(string $name, float $lat, float $lng): Business
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $this->cleanupUserIds[] = $owner->id;

        $business = $owner->businesses()->create([
            'name' => $name,
            'slug' => 'gis-'.bin2hex(random_bytes(8)),
            'category' => 'کافه',
            'status' => 'approved',
            'latitude' => $lat,
            'longitude' => $lng,
        ]);
        $this->cleanupBusinessIds[] = $business->id;

        // Mirror the production geom sync (the controller does this on save).
        DB::statement('UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(?, ?), 4326) WHERE id = ?', [
            $lng, $lat, $business->id,
        ]);

        return $business;
    }

    /** Both businesses inside the radius, ordered nearest-first by PostGIS. */
    public function test_radius_search_returns_nearest_first_on_real_postgis(): void
    {
        // Tehran city center vs ~2.5km east. Nearest must rank first.
        $near = $this->makeGeoBusiness('نزدیک', 35.6892, 51.3890);
        $far = $this->makeGeoBusiness('دورتر', 35.6892, 51.4200);

        $res = $this->getJson('/api/search/businesses?latitude=35.6892&longitude=51.3890&radius=5000&category=کافه')
            ->assertOk();

        $ids = collect($res->json('data'))->pluck('id');
        $this->assertSame([$near->id, $far->id], $ids->all());

        // Distances come back from ST_Distance in meters, ascending.
        $distances = collect($res->json('data'))->pluck('distance')->map(fn ($d) => (float) $d);
        $this->assertTrue($distances->every(fn ($d) => $d >= 0));
        $this->assertTrue($distances->values()->first() < $distances->values()->last());

        // The far one must drop out when the radius is tightened.
        $tight = $this->getJson('/api/search/businesses?latitude=35.6892&longitude=51.3890&radius=1000&category=کافه')
            ->assertOk();
        $this->assertSame([$near->id], collect($tight->json('data'))->pluck('id')->all());
    }

    /** Phase 3 (B/F): promoted DESC outranks distance ASC on real PostGIS. */
    public function test_promoted_business_sorts_before_nearer_business_on_postgis(): void
    {
        $near = $this->makeGeoBusiness('نزدیک', 35.6892, 51.3890);
        $far = $this->makeGeoBusiness('دورترِ ویژه', 35.6892, 51.4200); // ~2.9km east
        $far->update(['is_promoted' => true]);

        $res = $this->getJson('/api/search/businesses?latitude=35.6892&longitude=51.3890&radius=5000&category=کافه')
            ->assertOk();

        // The farther promoted business must rank first, beating pure distance order.
        $this->assertSame([$far->id, $near->id], collect($res->json('data'))->pluck('id')->all());

        // Payload flags travel through the spatial branch too.
        $rows = collect($res->json('data'))->keyBy('id');
        $this->assertTrue($rows[$far->id]['is_promoted']);
        $this->assertFalse($rows[$near->id]['is_promoted']);
        $this->assertTrue($rows[$far->id]['is_claimed']);
    }

    /** A business without coordinates can never leak into a radius result set. */
    public function test_business_without_geom_is_excluded_from_radius_results(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $this->cleanupUserIds[] = $owner->id;

        $floating = $owner->businesses()->create([
            'name' => 'بی‌موقعیت',
            'slug' => 'gis-'.bin2hex(random_bytes(8)),
            'category' => 'کافه',
            'status' => 'approved',
            // Deliberately no latitude/longitude → no geom.
        ]);
        $this->cleanupBusinessIds[] = $floating->id;

        $res = $this->getJson('/api/search/businesses?latitude=35.6892&longitude=51.3890&radius=100000&category=کافه')
            ->assertOk();

        $this->assertNotContains($floating->id, collect($res->json('data'))->pluck('id'));
    }

    /**
     * Phase 3 cold start: unclaimed rows must be fully first-class citizens
     * of the spatial query — geom backfilled, distance computed, radius
     * filtering applied — so gray pins behave exactly like claimed pins.
     */
    public function test_unclaimed_businesses_work_with_postgis_radius_and_distance(): void
    {
        $seeder = new \Database\Seeders\UnclaimedBusinessSeeder;
        $seeder->run();

        $unclaimedNear = Business::where('slug', 'unclaimed-vanak-florist')->firstOrFail();
        $this->assertFalse($unclaimedNear->is_claimed);

        // geom was backfilled by the seeder — prove it.
        $geom = DB::selectOne('SELECT ST_AsText(geom) AS wkt FROM businesses WHERE id = ?', [$unclaimedNear->id]);
        $this->assertNotNull($geom?->wkt);
        $this->assertStringStartsWith('POINT(51.4102 35.7597)', (string) $geom->wkt);

        // Radius around Vanak (~600m from the florist) must include it with
        // a real ST_Distance value, same as claimed businesses.
        $res = $this->getJson('/api/search/businesses?latitude=35.7597&longitude=51.4102&radius=600')
            ->assertOk();

        $rows = collect($res->json('data'))->keyBy('id');
        $this->assertArrayHasKey($unclaimedNear->id, $rows);
        $this->assertFalse($rows[$unclaimedNear->id]['is_claimed']);
        $this->assertNotNull($rows[$unclaimedNear->id]['distance']);

        // And the pagination counter separates it from the listable total.
        $this->assertGreaterThanOrEqual(1, (int) $res->json('pagination.unclaimed_total'));
    }
}
