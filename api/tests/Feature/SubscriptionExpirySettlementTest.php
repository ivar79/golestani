<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\InternalNotification;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use App\Services\SubscriptionLifecycle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * LAZY + BATCH EXPIRY SETTLEMENT (Phase 5 finding A).
 *
 * The contract: a subscription that is genuinely past its end must end up
 * `expired` with exactly ONE `subscription_expired` notification — with or
 * without a running scheduler. The lazy read path (FeatureGate) and the
 * artisan sweep share SubscriptionLifecycle, so these tests pin both entry
 * points plus their interaction (no duplicates, no early expiry, no
 * destruction of payment history, entitlements revert to free tier).
 */
class SubscriptionExpirySettlementTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'Expiry Biz', 'slug' => 'expiry-biz-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'expiry-plan-'.uniqid(), 'price' => 249000,
            'currency' => 'IRR', 'duration_days' => 30,
            'features' => ['showcase' => true, 'max_showcases' => 7, 'ads' => true, 'max_ads' => 2],
            'is_active' => true, 'is_public' => true,
        ]);
    }

    /** An ACTIVE row written directly — no payment flow needed for lifecycle tests. */
    private function activeSubscription(Business $business, Plan $plan, array $overrides = []): Subscription
    {
        $subscription = (new Subscription)->forceFill(array_merge([
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'status' => 'active',
            'plan_name' => $plan->name,
            'price_amount' => $plan->price,
            'price_currency' => $plan->currency,
            'duration_days' => $plan->duration_days,
            'entitlements' => FeatureGate::normalize($plan->features),
            'started_at' => Carbon::now()->subDays(31),
            'expires_at' => Carbon::now()->subDay(),
        ], $overrides));
        $subscription->save();

        return $subscription;
    }

    private function expiredNotifications(int $businessId): int
    {
        $subscriptionIds = Subscription::where('business_id', $businessId)->pluck('id');

        return InternalNotification::where('type', 'subscription_expired')
            ->whereIn('related_id', $subscriptionIds)
            ->count();
    }

    public function test_a_lazy_read_expires_a_past_due_subscription_and_notifies_the_owner_once(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $subscription = $this->activeSubscription($business, $this->plan());

        // No scheduler runs anywhere in this test: the read itself settles it.
        $this->actingAs($owner)
            ->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk();

        $this->assertSame('expired', $subscription->fresh()->status);
        $this->assertSame(1, $this->expiredNotifications($business->id));

        $notification = InternalNotification::where('type', 'subscription_expired')->firstOrFail();
        $this->assertSame($owner->id, $notification->user_id);
        $this->assertSame($subscription->id, $notification->related_id);
    }

    public function test_repeated_reads_and_a_sweep_never_duplicate_the_notification(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->activeSubscription($business, $this->plan());

        // 1. three reads in a row (the dedupe window must not skip the work
        //    entirely, and repeats must not re-notify)
        for ($i = 0; $i < 3; $i++) {
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();
        }
        $this->assertSame(1, $this->expiredNotifications($business->id));

        // 2. the nightly sweep afterwards is a no-op for an already-expired row
        $this->artisan('subscriptions:expire')->assertSuccessful();
        $this->assertSame(1, $this->expiredNotifications($business->id));

        // 3. and the lazy value helper is idempotent too
        app(SubscriptionLifecycle::class)->expirePastDueFor($business->fresh());
        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_the_batch_sweep_alone_expires_and_notifies_exactly_once(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $subscription = $this->activeSubscription($business, $this->plan());

        $this->artisan('subscriptions:expire')->assertSuccessful();
        $this->assertSame('expired', $subscription->fresh()->status);
        $this->assertSame(1, $this->expiredNotifications($business->id));

        // Re-running the sweep (scheduler retry, overlapping cron) changes nothing.
        $this->artisan('subscriptions:expire')->assertSuccessful();
        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_a_subscription_is_never_expired_or_announced_before_its_boundary(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);

        // Timestamp row that ends in the future.
        $future = $this->activeSubscription($business, $this->plan(), ['expires_at' => Carbon::now()->addDay()]);
        // Legacy day-granular row whose last valid day IS today.
        $lastDay = $this->activeSubscription($business, $this->plan(), ['expires_at' => null, 'end_date' => Carbon::today()]);

        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();

        $this->assertSame('active', $future->fresh()->status);
        $this->assertSame('active', $lastDay->fresh()->status);
        $this->assertSame(0, $this->expiredNotifications($business->id));
    }

    public function test_a_legacy_day_granular_row_expires_once_its_end_date_has_passed(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $legacy = $this->activeSubscription($business, $this->plan(), ['expires_at' => null, 'end_date' => Carbon::yesterday()]);

        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();

        $this->assertSame('expired', $legacy->fresh()->status);
        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_expiry_reverts_entitlements_to_the_free_tier_without_touching_history(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $plan = $this->plan();
        $subscription = $this->activeSubscription($business, $plan, [
            'started_at' => Carbon::now()->subDay(),
            'expires_at' => Carbon::now()->addDay(),
        ]);

        // While still inside its window the paid capabilities are live.
        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'ads'));
        $this->assertSame(7, $gate->limit($business, 'max_showcases'));

        // Cross the boundary, then read again: the same request path that used
        // to grant the plan now settles it and falls back to the free tier.
        Carbon::setTestNow(Carbon::now()->addDays(2));
        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();
        Carbon::setTestNow();

        $this->assertFalse($gate->allows($business->fresh(), 'ads'));
        $this->assertSame(0, $gate->limit($business->fresh(), 'max_showcases'));

        // Money + ownership snapshot untouched by the settlement.
        $row = $subscription->fresh();
        $this->assertSame($plan->price, (int) $row->price_amount);
        $this->assertSame($plan->name, $row->plan_name);
        $this->assertSame($business->id, $row->business_id);
        $this->assertSame(30, (int) $row->duration_days);
    }

    public function test_the_manual_admin_activation_path_still_supersedes_and_survives_settlement(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $plan = $this->plan();

        // Old, already past-due row (settles to expired) + a fresh paid row that
        // is still valid: the settlement must not touch the valid one.
        $old = $this->activeSubscription($business, $plan);
        $current = $this->activeSubscription($business, $plan, [
            'started_at' => Carbon::now()->subDay(),
            'expires_at' => Carbon::now()->addDays(29),
        ]);

        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();

        $this->assertSame('expired', $old->fresh()->status);
        $this->assertSame('active', $current->fresh()->status);
        $this->assertSame(7, app(FeatureGate::class)->limit($business->fresh(), 'max_showcases'));
    }

    public function test_a_due_scheduled_downgrade_is_still_promoted_by_the_lazy_path(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $plan = $this->plan();

        $active = $this->activeSubscription($business, $plan);
        $scheduled = $this->activeSubscription($business, $plan, [
            'status' => 'scheduled',
            'started_at' => Carbon::now()->subHour(),
        ]);

        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();

        $this->assertSame('expired', $active->fresh()->status);
        $this->assertSame('active', $scheduled->fresh()->status);
        // Exactly ONE expiry notification (for the superseded plan) — never a
        // second one for the row that took over, and never an early notice.
        $this->assertSame(1, InternalNotification::where('type', 'subscription_expired')->count());
    }
}
