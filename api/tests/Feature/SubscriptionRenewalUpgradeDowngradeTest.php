<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use App\Services\Payments\PaymentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\TestDox;
use Tests\TestCase;

/**
 * REBUY / UPGRADE / DOWNGRADE contract (the subscription model):
 *
 *   Business ── ONE active Subscription ← extended in place by renewals
 *                    ├── Payment #1 ┐
 *                    ├── Payment #2 ┘ all link subscription_id → row
 *   + optional ONE scheduled Subscription (downgrade waiting for the
 *     current lifetime to end).
 *
 * Locked requirements:
 *  1. same-plan renewal extends expires_at (never a parallel subscription)
 *  2. different duration of the same plan composes (timestamp based)
 *  3. downgrade NEVER takes effect before the current plan expires
 *  4. upgrade activates immediately + carries the remaining time over
 *  5. expired purchase starts FRESH from now
 *  6. concurrent same-plan payments COMPOSE under the business row lock
 *  7. payment history is preserved (many payments → one subscription)
 *  8. replay of an already-consumed payment changes nothing
 */
#[TestDox('Subscription rebuy / upgrade / downgrade lifecycle')]
class SubscriptionRenewalUpgradeDowngradeTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user, string $name = 'biz'): Business
    {
        return $user->businesses()->create(['name' => 'Biz '.$name, 'slug' => $name.'-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(string $name, int $price, int $days, ?int $tier = null, array $features = ['showcase' => true, 'max_showcases' => 5]): Plan
    {
        return Plan::create([
            'name' => $name, 'slug' => uniqid($name), 'price' => $price, 'currency' => 'IRR',
            'duration_days' => $days, 'tier' => $tier, 'features' => $features,
            'is_active' => true, 'is_public' => true,
        ]);
    }

    /** Full real-flow purchase: init → gateway stub → callback → paid. */
    private function purchase(Business $business, Plan $plan): Subscription
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => fn () => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            // Closure: each verify gets a FRESH ref_id — the column is UNIQUE.
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => fn () => Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'], 'errors' => []]),
        ]);

        $res = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])->assertCreated();
        $this->getJson("/api/payments/callback?Authority={$res->json('authority')}&Status=OK")->assertOk();

        return Subscription::findOrFail(PaymentTransaction::where('authority', $res->json('authority'))->first()->subscription_id);
    }

    /* ============================================ 1. same-plan renewal */

    public function test_same_plan_renewal_extends_the_active_subscription_without_parallel_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $premium = $this->plan('premium', 249000, 30, tier: 2);
        $first = $this->purchase($business, $premium);

        // 20 days pass → 10 days remain.
        Carbon::setTestNow(Carbon::parse('2026-10-18 15:30:00', 'UTC'));
        $expiryBeforeRenewal = $first->refresh()->expires_at->copy();

        // Renew the SAME plan for 30 days → +30 days on top of the remainder.
        $renewed = $this->purchase($business, $premium);

        $this->assertSame($first->id, $renewed->id, 'renewal MUST extend the same subscription row');
        $this->assertEquals(
            $expiryBeforeRenewal->copy()->addDays(30)->getTimestamp(),
            $renewed->expires_at->getTimestamp(),
            'expires_at = current_expires_at + purchased_duration'
        );

        // Exactly ONE subscription row, still active.
        $this->assertSame(1, Subscription::where('business_id', $business->id)->count());
        $this->assertSame(1, Subscription::where('business_id', $business->id)->where('status', 'active')->count());

        // TWO payments, both paid, both pointing at the SAME subscription.
        $this->assertSame(2, PaymentTransaction::where('business_id', $business->id)->where('status', 'paid')->count());
        $this->assertSame(2, PaymentTransaction::where('subscription_id', $first->id)->count());

        Carbon::setTestNow();
    }

    public function test_renewal_adds_exactly_the_purchased_duration_to_current_expiry(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan('basic', 99000, 30, tier: 1);
        $sub = $this->purchase($business, $plan);
        $expiryAfterFirst = $sub->refresh()->expires_at->copy();

        // Renewal for 30 more days → expiry = first expiry + 30 days exactly.
        $this->purchase($business, $plan);

        $this->assertEquals(
            $expiryAfterFirst->copy()->addDays(30)->getTimestamp(),
            $sub->refresh()->expires_at->getTimestamp(),
            'expires_at = current_expires_at + purchased_duration'
        );
        // started_at untouched by renewal.
        $this->assertEquals(Carbon::parse('2026-09-28 15:30:00', 'UTC'), $sub->started_at);

        Carbon::setTestNow();
    }

    /* ==================================== 2. different-duration renewal */

    public function test_different_duration_of_same_plan_composes_timestamp_based(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $m30 = $this->plan('prem30', 249000, 30, tier: 2);
        $m90 = $this->plan('prem90', 597000, 90, tier: 2);
        $sub = $this->purchase($business, $m30);
        $expiry1 = $sub->refresh()->expires_at->copy(); // Oct 28 15:30

        // Oct 20 (22 days into the 30d term): 8 days remain + 90d purchased.
        Carbon::setTestNow(Carbon::parse('2026-10-20 15:30:00', 'UTC'));
        $renewed = $this->purchase($business, $m90);

        $this->assertSame($sub->id, $renewed->id);
        $expectedExpiry = $expiry1->copy()->addDays(90);
        $this->assertEquals($expectedExpiry->getTimestamp(), $renewed->expires_at->getTimestamp(), 'Oct 20 purchase extends the SAME lifetime by the purchased 90d (expiry1 + 90d = Jan 18)');
        $this->assertEquals($expectedExpiry->getTimestamp(), $renewed->expires_at->getTimestamp());
        $this->assertSame(90, (int) $renewed->duration_days, 'money snapshot follows the newest purchase');
        $this->assertSame(2, PaymentTransaction::where('subscription_id', $sub->id)->count());

        Carbon::setTestNow();
    }

    /* ================================= 3+5. expired baseline → fresh start */

    public function test_purchase_on_expired_subscription_starts_fresh_from_now(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan('basic', 99000, 30, tier: 1);
        $sub = $this->purchase($business, $plan);

        // The subscription lapses (no renewal until Nov 15).
        Carbon::setTestNow(Carbon::parse('2026-11-15 10:00:00', 'UTC'));
        $this->assertSame('expired', $sub->refresh()->effective_status);

        $second = $this->purchase($business, $plan);

        $this->assertNotSame($sub->id, $second->id, 'a lapsed purchase must NOT extend the expired lifetime');
        $this->assertEquals(now()->getTimestamp(), $second->started_at->getTimestamp(), 'started_at = now');
        $this->assertEquals(now()->addDays(30)->getTimestamp(), $second->expires_at->getTimestamp(), 'expires_at = now + duration');
        $this->assertSame('active', $second->status);
        $this->assertSame(2, Subscription::where('business_id', $business->id)->count(), 'history preserved: expired row stays');
        $this->assertSame(1, Subscription::where('business_id', $business->id)->where('status', 'active')->count());

        Carbon::setTestNow();
    }

    /* ======================================= 3. downgrade is SCHEDULED */

    public function test_downgrade_is_scheduled_and_does_not_touch_current_entitlements(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $premium = $this->plan('premium', 249000, 30, tier: 2, features: ['showcase' => true, 'max_showcases' => 5, 'print_file' => true]);
        $basic = $this->plan('basic', 99000, 30, tier: 1, features: ['showcase' => true, 'max_showcases' => 1]);

        $premiumSub = $this->purchase($business, $premium);
        $premiumExpiry = $premiumSub->refresh()->expires_at->copy();

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'print_file'));

        // Downgrade purchase while premium is active.
        $basicSub = $this->purchase($business, $basic);

        $this->assertSame('scheduled', $basicSub->status);
        $this->assertNotSame($premiumSub->id, $basicSub->id);
        $this->assertEquals($premiumExpiry->getTimestamp(), $basicSub->started_at->getTimestamp(), 'scheduled starts EXACTLY at the current expires_at');
        $this->assertEquals($premiumExpiry->copy()->addDays(30)->getTimestamp(), $basicSub->expires_at->getTimestamp());

        // Premium entitlements are UNTOUCHED until the boundary.
        $this->assertTrue($gate->allows($business, 'print_file'), 'downgrade must not remove current entitlements');
        $this->assertSame(5, $gate->limit($business, 'max_showcases'));
        $this->assertSame('active', $premiumSub->refresh()->status);
        $this->assertSame('snapshot', $gate->capabilities($business)['source']);

        // Payload exposes the scheduled change for the dashboard.
        $scheduled = $gate->payload($business)['scheduled'];
        $this->assertNotNull($scheduled);
        $this->assertSame($basicSub->id, $scheduled['id']);
        $this->assertEquals($premiumExpiry->getTimestamp(), Carbon::parse($scheduled['starts_at'])->getTimestamp());

        Carbon::setTestNow();
    }

    public function test_scheduled_downgrade_activates_right_after_current_plan_expires(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $premium = $this->plan('premium', 249000, 30, tier: 2, features: ['showcase' => true, 'max_showcases' => 5, 'print_file' => true]);
        $basic = $this->plan('basic', 99000, 30, tier: 1, features: ['showcase' => true, 'max_showcases' => 1]);

        $premiumSub = $this->purchase($business, $premium);
        $basicSub = $this->purchase($business, $basic);
        $expiry = $premiumSub->refresh()->expires_at->copy();

        // ONE SECOND past expiry — the lazy path promotes without any cron.
        Carbon::setTestNow($expiry->copy()->addSecond());

        $gate = app(FeatureGate::class);
        $active = $gate->activeSubscription($business);

        $this->assertNotNull($active);
        $this->assertSame($basicSub->id, $active->id, 'scheduled row promotes exactly at the boundary');
        $this->assertSame('active', $basicSub->refresh()->status);
        $this->assertSame('expired', $premiumSub->refresh()->status);

        // New entitlements are the BASIC snapshot (frozen at downgrade time).
        $this->assertFalse($gate->allows($business, 'print_file'));
        $this->assertSame(1, $gate->limit($business, 'max_showcases'));

        Carbon::setTestNow();
    }

    public function test_renewal_of_active_plan_rebases_the_scheduled_downgrade(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $premium = $this->plan('premium', 249000, 30, tier: 2);
        $basic = $this->plan('basic', 99000, 30, tier: 1);

        $premiumSub = $this->purchase($business, $premium);
        $scheduled = $this->purchase($business, $basic);
        $oldScheduledStart = $scheduled->refresh()->started_at->copy();

        // Premium renewed → the scheduled change must move to the NEW expiry.
        Carbon::setTestNow(Carbon::parse('2026-10-01 12:00:00', 'UTC'));
        $renewed = $this->purchase($business, $premium);
        $newExpiry = $renewed->refresh()->expires_at->copy();

        $this->assertSame($premiumSub->id, $renewed->id);
        $scheduled->refresh();
        $this->assertSame('scheduled', $scheduled->status);
        $this->assertEquals($newExpiry->getTimestamp(), $scheduled->started_at->getTimestamp(), 'scheduled rebase to the new expiry');
        $this->assertGreaterThan($oldScheduledStart->getTimestamp(), $scheduled->started_at->getTimestamp());

        Carbon::setTestNow();
    }

    /* ============================================ 4. upgrade behaviour */

    public function test_upgrade_activates_immediately_and_carries_remaining_time_over(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $basic = $this->plan('basic', 99000, 30, tier: 1, features: ['showcase' => true, 'max_showcases' => 1]);
        $premium = $this->plan('premium', 249000, 30, tier: 2, features: ['showcase' => true, 'max_showcases' => 5, 'print_file' => true]);

        $basicSub = $this->purchase($business, $basic);
        $basicExpiry = $basicSub->refresh()->expires_at->copy();

        // Upgrade 20 days in → 10 days remain (864000s).
        Carbon::setTestNow(Carbon::parse('2026-10-18 15:30:00', 'UTC'));
        $remaining = $basicSub->refresh()->expires_at->getTimestamp() - now()->getTimestamp();
        $this->assertSame(10 * 86400, $remaining);

        $premiumSub = $this->purchase($business, $premium);

        $this->assertSame('active', $premiumSub->status);
        $this->assertNotSame($basicSub->id, $premiumSub->id);
        // expires_at = now + 30d + remaining(10d) = 40 days of premium.
        $this->assertEquals(
            now()->addDays(40)->getTimestamp(),
            $premiumSub->expires_at->getTimestamp(),
            'remaining lifetime of the lower plan carries over'
        );
        $this->assertSame('expired', $basicSub->refresh()->status, 'old row expired, never deleted');
        $this->assertNotNull(PaymentTransaction::where('subscription_id', $basicSub->id)->first(), 'old payment history intact');

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'print_file'));
        $this->assertSame(5, $gate->limit($business, 'max_showcases'));

        Carbon::setTestNow();
    }

    public function test_tier_falls_back_to_price_when_tiers_missing(): void
    {
        $service = app(PaymentService::class);
        $cheap = $this->plan('cheap', 50000, 30);
        $dear = $this->plan('dear', 200000, 30);

        $m = new \ReflectionMethod($service, 'classify');
        $m->setAccessible(true);

        $this->assertSame('upgrade', $m->invoke($service, $dear, $cheap));
        $this->assertSame('downgrade', $m->invoke($service, $cheap, $dear));
        $this->assertSame('renewal', $m->invoke($service, $cheap, $cheap));
    }

    /* ============================ 6. concurrent same-plan payments COMPOSE */

    public function test_two_back_to_back_same_plan_payments_both_extend(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan('basic', 99000, 30, tier: 1);

        $sub = $this->purchase($business, $plan);
        $expiry1 = $sub->refresh()->expires_at->copy();

        // Two more valid payments for the SAME plan, back to back (the
        // business row lock serializes them — both must compose, not race).
        $this->purchase($business, $plan);
        $this->purchase($business, $plan);

        $this->assertEquals($expiry1->copy()->addDays(60)->getTimestamp(), $sub->refresh()->expires_at->getTimestamp(), 'Oct20 + 30 + 30 — both extensions compose');
        $this->assertSame(1, Subscription::where('business_id', $business->id)->count(), 'still exactly ONE subscription row');
        $this->assertSame(3, PaymentTransaction::where('subscription_id', $sub->id)->where('status', 'paid')->count(), 'three payments, one subscription');

        Carbon::setTestNow();
    }

    /* ======================================== 7. history + 8. replay safety */

    public function test_payment_history_is_preserved_across_renewals(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan('basic', 99000, 30, tier: 1);

        $sub = $this->purchase($business, $plan);
        $this->purchase($business, $plan);

        $payments = PaymentTransaction::where('subscription_id', $sub->id)->orderBy('id')->get();
        $this->assertCount(2, $payments);
        $this->assertNotNull($payments[0]->ref_id);
        $this->assertNotNull($payments[1]->ref_id);
        $this->assertNotSame($payments[0]->ref_id, $payments[1]->ref_id, 'each payment keeps its own provider reference');
        $this->assertSame(990000, (int) $payments[1]->amount, 'RIAL gateway amount preserved per payment');

        Carbon::setTestNow();
    }

    public function test_replaying_a_consumed_payment_changes_nothing(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan('basic', 99000, 30, tier: 1);

        $sub = $this->purchase($business, $plan);
        $expiry = $sub->refresh()->expires_at->copy();
        $row = PaymentTransaction::where('subscription_id', $sub->id)->first();

        // Replay the SAME authority through the callback — idempotent refusal.
        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();

        $this->assertEquals($expiry->getTimestamp(), $sub->refresh()->expires_at->getTimestamp(), 'replay must not extend again');
        $this->assertSame(1, PaymentTransaction::where('subscription_id', $sub->id)->count());
        $this->assertSame('paid', $row->refresh()->status);

        Carbon::setTestNow();
    }

    /* ============================== entitlement + dashboard endpoints */

    public function test_entitlements_endpoint_reflects_scheduled_state(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $premium = $this->plan('premium', 249000, 30, tier: 2, features: ['showcase' => true, 'max_showcases' => 5, 'print_file' => true]);
        $basic = $this->plan('basic', 99000, 30, tier: 1, features: ['showcase' => true, 'max_showcases' => 1]);

        $this->purchase($business, $premium);
        $basicSub = $this->purchase($business, $basic);

        $this->actingAs($business->owner)->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('entitlements.scheduled.id', $basicSub->id)
            ->assertJsonPath('entitlements.scheduled.plan_name', 'basic')
            ->assertJsonPath('entitlements.capabilities.max_showcases', 5, 'current plan still governs')
            ->assertJsonPath('subscription.status', 'active');

        Carbon::setTestNow();
    }

    /* ======================= plan-change policy declaration ================= */

    /**
     * The business rules live in ONE place (config/entitlements.php) and the
     * payment service must agree with them. This test is that agreement: it
     * fails the moment the declared policy and the implemented behaviour
     * drift, which is how the old scalar `'immediate'` went unnoticed.
     */
    public function test_declared_plan_change_policy_matches_implemented_behaviour(): void
    {
        $policy = PaymentService::planChangePolicy();

        // Locked business rules (user decisions).
        $this->assertSame('extend', $policy['renewal'], 'renewal must extend the existing lifetime');
        $this->assertSame('immediate_carry_over', $policy['upgrade'], 'upgrade must be immediate and keep remaining time');
        $this->assertSame('scheduled_at_expiry', $policy['downgrade'], 'downgrade must be scheduled at expiry');
        $this->assertSame('none', $policy['proration'], 'no monetary proration');

        // And the declaration is the structured form, not the stale scalar.
        $this->assertIsArray(config('entitlements.policies.plan_change'));
    }

    public function test_stale_scalar_plan_change_policy_is_refused_instead_of_ignored(): void
    {
        config(['entitlements.policies.plan_change' => 'immediate']);

        try {
            PaymentService::planChangePolicy();
            $this->fail('A stale scalar plan_change policy must not be silently accepted.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('plan_change', $e->getMessage());
        }
    }

    public function test_a_policy_that_disagrees_with_the_code_blocks_activation_before_consuming_the_payment(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'policy-mismatch');
        $premium = $this->plan('premium', 249000, 30, tier: 2);
        $basic = $this->plan('basic', 99000, 30, tier: 1);

        $this->purchase($business, $premium);

        // Now declare a downgrade rule the service does not implement.
        config(['entitlements.policies.plan_change.downgrade' => 'immediate']);

        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => fn () => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => fn () => Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'], 'errors' => []]),
        ]);

        $res = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $basic->id])->assertCreated();

        // Activation aborts loudly (the declared rule is not implementable) and
        // the request fails instead of silently applying a different one.
        $this->getJson("/api/payments/callback?Authority={$res->json('authority')}&Status=OK")
            ->assertStatus(500);

        // Nothing half-applied: the money row is untouched, so the purchase can
        // be resolved once the configuration is corrected.
        $row = PaymentTransaction::where('authority', $res->json('authority'))->firstOrFail();
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status);
        $this->assertNull($row->subscription_id);
        $this->assertSame(1, Subscription::where('business_id', $business->id)->count(), 'no scheduled row was created');
    }
}
