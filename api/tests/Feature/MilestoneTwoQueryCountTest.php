<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Milestone 2 performance acceptance: real-execution query measurement.
 *
 * Proves (by running the scenarios, not by code inspection) that the main
 * Milestone 2 endpoints keep a CONSTANT query count while the dataset grows,
 * i.e. there is no N+1. Also records per-request total SQL duration.
 *
 * Constraints honored: no Debugbar/Telescope, no preventLazyLoading,
 * no migration/index/cache changes, API responses untouched. The suite only
 * READS through the public API; the only artifact is a SQL dump appended to
 * storage/logs/m2-query-audit.log as evidence for the client.
 */
class MilestoneTwoQueryCountTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $role = 'business_owner'): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->assignRole($role);

        return $u;
    }

    private function makeBusiness(User $owner, string $suffix, int $imageCount, string $status = 'approved'): Business
    {
        $b = $owner->businesses()->create([
            'name' => 'کافه '.$suffix,
            'slug' => 'audit-'.$suffix.'-'.Str::lower(Str::random(8)),
            'category' => 'کافه',
            'services' => ['قهوه'],
            'description' => 'توضیحات آزمایشی',
            'city' => 'تهران',
            'neighborhood' => 'مرکز',
            'status' => $status,
            'latitude' => 35.7,
            'longitude' => 51.4,
        ]);
        for ($i = 1; $i <= $imageCount; $i++) {
            $b->images()->create(['path' => '/storage/businesses/gallery/'.$b->id.'-'.$i.'.jpg', 'alt' => 'img'.$i]);
        }

        return $b;
    }

    /**
     * Runs the HTTP call with the query log enabled and returns the real
     * query count, total SQL duration (ms) and the raw query list.
     */
    private function measure(callable $request): array
    {
        // enableQueryLog() does NOT reset previously captured queries; without
        // flushing, each measurement would accumulate the previous run's SQL
        // and fake a linear "growth" that is an artifact of this harness.
        DB::flushQueryLog();
        DB::enableQueryLog();
        $response = $request();
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $response->assertOk();

        return [
            'count' => count($log),
            'time' => round(array_sum(array_column($log, 'time')), 2),
            'queries' => $log,
        ];
    }

    private function report(string $scenario, int $records, array $m): void
    {
        fwrite(STDOUT, sprintf(
            "[M2 QUERY AUDIT] %-48s records=%-4d queries=%-3d sql_time=%.2fms\n",
            $scenario, $records, $m['count'], $m['time']
        ));
    }

    private function dumpQueries(string $scenario, array $measurements): void
    {
        $out = '==== '.$scenario.' ===='.PHP_EOL;
        foreach ($measurements as $label => $m) {
            $out .= '-- '.$label.': '.$m['count'].' queries, '.$m['time'].' ms'.PHP_EOL;
            foreach ($m['queries'] as $i => $q) {
                $out .= sprintf("[%02d] %6.2fms  %s\n", $i + 1, $q['time'], $q['query']);
            }
        }
        file_put_contents(storage_path('logs/m2-query-audit.log'), $out, FILE_APPEND);
    }

    /** Constant count under dataset growth = no N+1 (executable proof). */
    private function assertNoGrowth(array $small, array $large, string $endpoint): void
    {
        $this->assertSame(
            $small['count'],
            $large['count'],
            "$endpoint query count changed with dataset growth: ".
            "{$small['count']} -> {$large['count']} queries (N+1 suspected)."
        );
    }

    public function test_public_business_show_query_count_is_constant(): void
    {
        $target = $this->makeBusiness($this->account(), 't', 2);
        for ($i = 1; $i <= 4; $i++) {
            $this->makeBusiness($this->account(), 's'.$i, 2);
        }
        $small = $this->measure(fn () => $this->getJson('/api/public/businesses/'.$target->slug));

        $targetLarge = $this->makeBusiness($this->account(), 'L', 25);
        for ($i = 1; $i <= 19; $i++) {
            $this->makeBusiness($this->account(), 'l'.$i, 25);
        }
        $large = $this->measure(fn () => $this->getJson('/api/public/businesses/'.$targetLarge->slug));

        $this->report('GET /api/public/businesses/{slug} (5 businesses)', 5, $small);
        $this->report('GET /api/public/businesses/{slug} (25 businesses)', 25, $large);
        $this->dumpQueries('public_business_show', ['5 businesses' => $small, '25 businesses' => $large]);
        $this->assertNoGrowth($small, $large, 'public business show');
    }

    public function test_admin_businesses_index_query_count_is_constant(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $this->makeBusiness($this->account(), 'a'.$i, 2);
        }
        $this->actingAs($this->account('admin'));
        $small = $this->measure(fn () => $this->getJson('/api/admin/businesses'));

        for ($i = 1; $i <= 15; $i++) {
            $this->makeBusiness($this->account(), 'b'.$i, 5);
        }
        // A fresh instance per request: the bound User carries its loaded
        // `roles` relation across requests, which would hide the role lookup
        // and fake a DECREASE (2 -> 1). Same artifact class as N+1, inverted.
        $this->actingAs($this->account('admin'));
        $large = $this->measure(fn () => $this->getJson('/api/admin/businesses'));

        $this->report('GET /api/admin/businesses (5 businesses)', 5, $small);
        $this->report('GET /api/admin/businesses (20 businesses)', 20, $large);
        $this->dumpQueries('admin_businesses_index', ['5 businesses' => $small, '20 businesses' => $large]);
        $this->assertNoGrowth($small, $large, 'admin businesses index');
    }

    public function test_owner_business_show_query_count_is_constant(): void
    {
        $owner = $this->account();
        $target = $this->makeBusiness($owner, 'own', 2);
        $this->actingAs($owner);
        $small = $this->measure(fn () => $this->getJson('/api/businesses/'.$target->id));

        $targetLarge = $this->makeBusiness($owner, 'OWN', 12);
        for ($i = 1; $i <= 7; $i++) {
            $this->makeBusiness($owner, 'w'.$i, 12);
        }
        // Fresh instance: see the relation-caching note in the admin test.
        $this->actingAs(User::query()->findOrFail($owner->id));
        $large = $this->measure(fn () => $this->getJson('/api/businesses/'.$targetLarge->id));

        $this->report('GET /api/businesses/{business} (1 business)', 1, $small);
        $this->report('GET /api/businesses/{business} (8 businesses)', 8, $large);
        $this->dumpQueries('owner_business_show', ['1 business' => $small, '8 businesses' => $large]);
        $this->assertNoGrowth($small, $large, 'owner business show');
    }

    public function test_owner_business_index_query_count_is_constant(): void
    {
        $owner = $this->account();
        $this->actingAs($owner);
        for ($i = 1; $i <= 3; $i++) {
            $this->makeBusiness($owner, 'i'.$i, 2);
        }
        $small = $this->measure(fn () => $this->getJson('/api/businesses'));

        for ($i = 1; $i <= 7; $i++) {
            $this->makeBusiness($owner, 'j'.$i, 5);
        }
        // Fresh instance: see the relation-caching note in the admin test.
        $this->actingAs(User::query()->findOrFail($owner->id));
        $large = $this->measure(fn () => $this->getJson('/api/businesses'));

        $this->report('GET /api/businesses (3 businesses)', 3, $small);
        $this->report('GET /api/businesses (10 businesses)', 10, $large);
        $this->dumpQueries('owner_business_index', ['3 businesses' => $small, '10 businesses' => $large]);
        $this->assertNoGrowth($small, $large, 'owner business index');
    }

    public function test_search_businesses_query_count_is_constant(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $this->makeBusiness($this->account(), 'r'.$i, 2);
        }
        $small = $this->measure(fn () => $this->getJson('/api/search/businesses?city='.urlencode('تهران')));

        for ($i = 1; $i <= 15; $i++) {
            $this->makeBusiness($this->account(), 'q'.$i, 5);
        }
        $large = $this->measure(fn () => $this->getJson('/api/search/businesses?city='.urlencode('تهران')));

        $this->report('GET /api/search/businesses (5 approved)', 5, $small);
        $this->report('GET /api/search/businesses (20 approved)', 20, $large);
        $this->dumpQueries('search_businesses', ['5 approved' => $small, '20 approved' => $large]);
        $this->assertNoGrowth($small, $large, 'search businesses');
    }
}
