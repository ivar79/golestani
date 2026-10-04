<?php

namespace Tests\Feature\Console;

use App\Models\Business;
use App\Models\Designer;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The studio rollout commands (amendment 6):
 *
 *   studio:access-report              — read-only report, always safe;
 *   studio:backfill-designers         — DRY RUN by default, --apply writes;
 *   subscriptions:refresh-snapshot    — DRY RUN by default, --apply writes.
 *
 * The dry run must never touch data; the apply path must be canonical
 * (users.designer_status + role, entitlement snapshot) and auditable.
 */
class StudioCommandsTest extends TestCase
{
    use RefreshDatabase;

    private function legacyApprovedDesigner(): array
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('user');

        $designer = Designer::create([
            'user_id' => $user->id,
            'display_name' => 'طراح قدیمی',
            'slug' => 'legacy-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'status' => 'approved',
        ]);

        return [$user->fresh(), $designer];
    }

    public function test_access_report_runs_and_reports_the_gate_state(): void
    {
        $this->artisan('studio:access-report')
            ->expectsOutputToContain('Gate enforcement (studio_designer_only): off (staged rollout)')
            ->assertExitCode(0);

        $this->artisan('studio:access-report', ['--json' => true])
            ->assertExitCode(0);
    }

    public function test_backfill_dry_run_writes_nothing(): void
    {
        [$user] = $this->legacyApprovedDesigner();

        $this->artisan('studio:backfill-designers')
            ->expectsOutputToContain('DRY RUN (default)')
            ->assertExitCode(0);

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'none']);
        $this->assertFalse($user->fresh()->hasRole('designer'));
    }

    public function test_backfill_apply_promotes_legacy_approved_designers(): void
    {
        [$user] = $this->legacyApprovedDesigner();

        $this->artisan('studio:backfill-designers', ['--apply' => true, '--force' => true])
            ->assertExitCode(0);

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'approved']);
        $this->assertTrue($user->fresh()->hasRole('designer'));
        $this->assertDatabaseHas('audit_events', [
            'event' => 'studio.backfill_designers',
            'subject_type' => 'user',
            'subject_id' => $user->id,
        ]);
    }

    public function test_backfill_never_overwrites_an_already_set_canonical_status(): void
    {
        [$user] = $this->legacyApprovedDesigner();
        $user->forceFill(['designer_status' => 'suspended'])->save();

        $this->artisan('studio:backfill-designers', ['--apply' => true, '--force' => true])
            ->assertExitCode(0);

        // Divergence is reported, never auto-resolved in the legacy direction.
        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'suspended']);
    }

    public function test_snapshot_refresh_dry_run_writes_nothing_and_apply_adds_new_keys(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $business = $owner->businesses()->create(['name' => 'B', 'slug' => 'snap-biz', 'status' => 'approved']);

        $plan = Plan::create([
            'name' => 'Snapshot Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => ['card_editor' => true, 'designer_studio' => true],
        ]);

        /** @var Subscription $subscription */
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);
        // Frozen snapshot from BEFORE designer_studio existed in the catalog.
        $subscription->forceFill(['entitlements' => ['card_editor' => true]])->save();

        $this->artisan('subscriptions:refresh-snapshot')
            ->expectsOutputToContain('DRY RUN (default)')
            ->assertExitCode(0);

        $this->assertSame(['card_editor' => true], $subscription->fresh()->entitlements);

        $this->artisan('subscriptions:refresh-snapshot', ['--apply' => true, '--force' => true])
            ->assertExitCode(0);

        $refreshed = $subscription->fresh()->entitlements;
        $this->assertTrue($refreshed['designer_studio'] ?? false);
        $this->assertTrue($refreshed['card_editor']);

        $this->assertDatabaseHas('audit_events', [
            'event' => 'subscription.snapshot_refreshed',
            'subject_type' => 'subscription',
            'subject_id' => $subscription->id,
        ]);

        $metadata = json_decode(
            (string) DB::table('audit_events')->where('event', 'subscription.snapshot_refreshed')->value('metadata'),
            true,
        );
        $this->assertContains('designer_studio', $metadata['added']);
    }

    public function test_snapshot_refresh_can_scope_statuses(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $business = $owner->businesses()->create(['name' => 'B2', 'slug' => 'snap-biz-2', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'P2', 'price' => 100, 'duration_days' => 30, 'features' => ['card_editor' => true]]);

        /** @var Subscription $expired */
        $expired = $business->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => 'expired',
            'start_date' => now()->subDays(60), 'end_date' => now()->subDays(30),
        ]);
        $expired->forceFill(['entitlements' => []])->save();

        $this->artisan('subscriptions:refresh-snapshot', [
            '--apply' => true,
            '--force' => true,
            '--status' => 'expired',
            // Empty snapshots are never seeded implicitly — the flag is explicit.
            '--seed-empty' => true,
        ])->assertExitCode(0);

        $this->assertTrue($expired->fresh()->entitlements['card_editor'] ?? false);
    }

    private function activeSubscription(array $planFeatures, array $snapshot): Subscription
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $business = $owner->businesses()->create([
            'name' => 'S', 'slug' => 'snap-'.fake()->unique()->regexify('[a-z0-9]{8}'), 'status' => 'approved',
        ]);
        $plan = Plan::create(['name' => 'SP', 'price' => 100, 'duration_days' => 30, 'features' => $planFeatures]);

        /** @var Subscription $subscription */
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => 'active',
            'start_date' => now(), 'end_date' => now()->addDays(30),
        ]);
        $subscription->forceFill(['entitlements' => $snapshot])->save();

        return $subscription;
    }

    public function test_additive_mode_preserves_existing_and_unknown_keys(): void
    {
        $subscription = $this->activeSubscription(
            ['card_editor' => false, 'designer_studio' => true, 'max_cards' => 1],
            ['card_editor' => true, 'max_cards' => 3, 'legacy_unknown' => true],
        );

        $this->artisan('subscriptions:refresh-snapshot', ['--apply' => true, '--force' => true])
            ->assertExitCode(0);

        $entitlements = $subscription->fresh()->entitlements;
        $this->assertTrue($entitlements['card_editor']);     // unchanged even though the plan now says false
        $this->assertSame(3, $entitlements['max_cards']);    // unchanged even though the plan now says 1
        $this->assertTrue($entitlements['legacy_unknown']);  // non-catalog key preserved
        $this->assertTrue($entitlements['designer_studio']); // only the MISSING key was added
    }

    public function test_additive_only_adds_the_named_key(): void
    {
        $subscription = $this->activeSubscription(
            ['card_editor' => true, 'designer_studio' => true, 'custom_templates' => true],
            ['card_editor' => true],
        );

        $this->artisan('subscriptions:refresh-snapshot', [
            '--apply' => true, '--force' => true, '--only' => 'designer_studio',
        ])->assertExitCode(0);

        $entitlements = $subscription->fresh()->entitlements;
        $this->assertTrue($entitlements['designer_studio'] ?? false);
        $this->assertArrayNotHasKey('custom_templates', $entitlements);
    }

    public function test_empty_snapshot_is_skipped_unless_seed_empty(): void
    {
        $subscription = $this->activeSubscription(['card_editor' => true], []);

        $this->artisan('subscriptions:refresh-snapshot', ['--apply' => true, '--force' => true])
            ->expectsOutputToContain('empty snapshot')
            ->assertExitCode(0);
        $this->assertSame([], $subscription->fresh()->entitlements);

        $this->artisan('subscriptions:refresh-snapshot', [
            '--apply' => true, '--force' => true, '--seed-empty' => true,
        ])->assertExitCode(0);
        $this->assertTrue($subscription->fresh()->entitlements['card_editor'] ?? false);
    }

    public function test_full_mode_rewrites_and_can_remove_keys(): void
    {
        $subscription = $this->activeSubscription(
            ['card_editor' => true],
            ['card_editor' => true, 'max_ads' => 5],
        );

        $this->artisan('subscriptions:refresh-snapshot', [
            '--apply' => true, '--force' => true, '--mode' => 'full',
        ])
            ->expectsOutputToContain('WARNING')
            ->assertExitCode(0);

        $entitlements = $subscription->fresh()->entitlements;
        $this->assertArrayHasKey('card_editor', $entitlements);
        $this->assertArrayNotHasKey('max_ads', $entitlements);
    }

    public function test_invalid_mode_is_refused(): void
    {
        $this->artisan('subscriptions:refresh-snapshot', ['--mode' => 'bogus'])
            ->assertExitCode(1);
    }

    public function test_backfill_apply_records_legacy_metadata(): void
    {
        [$user] = $this->legacyApprovedDesigner();

        $this->artisan('studio:backfill-designers', ['--apply' => true, '--force' => true])
            ->assertExitCode(0);

        $metadata = json_decode(
            (string) DB::table('audit_events')->where('event', 'studio.backfill_designers')->value('metadata'),
            true,
        );
        $this->assertSame('approved', $metadata['legacy_status']);
        $this->assertSame('designers.status', $metadata['source']);
    }

    public function test_report_and_backfill_share_one_candidate_divergent_classification(): void
    {
        [$user] = $this->legacyApprovedDesigner(); // canonical none, legacy approved
        $builder = app(\App\Services\StudioAccessReport::class);

        $report = $builder->build();
        $this->assertContains($user->id, array_column($report['users']['backfill_candidates'], 'user_id'));
        $this->assertNotContains($user->id, array_column($report['users']['divergent'], 'user_id'));

        // Once the canonical status is SET and disagrees, it flips to divergent.
        $user->forceFill(['designer_status' => 'suspended'])->save();
        $report = $builder->build();
        $this->assertContains($user->id, array_column($report['users']['divergent'], 'user_id'));
        $this->assertNotContains($user->id, array_column($report['users']['backfill_candidates'], 'user_id'));
    }
}
