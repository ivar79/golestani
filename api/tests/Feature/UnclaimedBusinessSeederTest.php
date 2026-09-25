<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Database\Seeders\UnclaimedBusinessSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Phase 3 cold-start seeder contract:
 *  - every row is approved + unclaimed + unpromoted + unverified;
 *  - rows share one system placeholder owner (FK satisfied);
 *  - re-running never duplicates (idempotent updateOrCreate);
 *  - placeholder owner can never log in (no phone) or be listed as a business.
 */
class UnclaimedBusinessSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeder_creates_unclaimed_approved_rows_with_defaults(): void
    {
        $this->seed(UnclaimedBusinessSeeder::class);

        $owner = User::where('email', 'cold-start@system.inkart.invalid')->firstOrFail();

        $unclaimed = Business::where('is_claimed', false)->get();

        $this->assertGreaterThanOrEqual(30, $unclaimed->count(), 'Cold start dataset must be meaningful for the demo map.');

        $unclaimed->each(function (Business $b) use ($owner) {
            $this->assertSame('approved', $b->status);
            $this->assertFalse($b->is_promoted);
            $this->assertSame(0, $b->verification_level);
            $this->assertNull($b->license_tracking_code);
            $this->assertNull($b->phone);
            $this->assertSame($owner->id, $b->user_id);
            $this->assertSame('تهران', $b->city);
            $this->assertNotNull($b->latitude, 'Map pins need coordinates');
            $this->assertNotNull($b->longitude, 'Map pins need coordinates');
            $this->assertStringStartsWith('unclaimed-', $b->slug);
        });
    }

    public function test_seeder_is_idempotent(): void
    {
        $this->seed(UnclaimedBusinessSeeder::class);
        $countAfterFirstRun = Business::where('is_claimed', false)->count();

        $this->seed(UnclaimedBusinessSeeder::class);

        $this->assertSame(
            $countAfterFirstRun,
            Business::where('is_claimed', false)->count(),
            'Re-seeding must not duplicate cold-start rows.'
        );
        $this->assertSame(1, User::where('email', 'cold-start@system.inkart.invalid')->count());
    }

    public function test_seeded_rows_carry_phase3_flag_payload_in_search_api(): void
    {
        $this->seed(UnclaimedBusinessSeeder::class);

        // Phase 3 result-set separation: unclaimed rows are map-only, so they
        // surface in the dedicated `unclaimed` key — never in `data`.
        $rows = collect($this->getJson('/api/search/businesses?city=تهران')->assertOk()->json('unclaimed'))
            ->keyBy('slug');

        $this->assertGreaterThan(0, $rows->count());

        $unclaimed = $rows->filter(fn ($row) => str_starts_with((string) $row['slug'], 'unclaimed-'));
        $this->assertGreaterThan(0, $unclaimed->count());

        $unclaimed->each(function ($row) {
            $this->assertFalse($row['is_claimed']);
            $this->assertFalse($row['is_promoted']);
            $this->assertFalse($row['license_verified']);
            $this->assertNull($row['license_tracking_code']);
        });

        // And they never leak into the listable set.
        $claimed = collect($this->getJson('/api/search/businesses?city=تهران')->assertOk()->json('data'));
        $this->assertSame(
            0,
            $claimed->filter(fn ($row) => $row['is_claimed'] === false)->count(),
            'data must not contain unclaimed rows'
        );
    }
}
