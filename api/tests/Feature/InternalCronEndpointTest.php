<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\InternalNotification;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * EXTERNAL SCHEDULER TRIGGER (Phase 5 finding A).
 *
 * The API runs on Render's free web-service plan, where no process executes
 * Laravel's scheduler. This endpoint is what makes automatic expiry REAL in
 * the deployed environment: a free outside timer (Vercel Cron / GitHub
 * Actions) POSTs here with a shared secret and the deployed API runs the same
 * sweep the artisan command runs.
 *
 * These tests pin the security contract (fail-closed when unconfigured,
 * constant-time shared secret, POST only, no data leakage) and the lifecycle
 * contract (settles past-due rows, notifies exactly once, idempotent on
 * repeats, promotes a due scheduled downgrade).
 */
class InternalCronEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const ENDPOINT = '/api/internal/cron/expire-subscriptions';

    private const TOKEN = 'cron-secret-for-tests-0123456789';

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'Cron Biz', 'slug' => 'cron-biz-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'cron-plan-'.uniqid(), 'price' => 249000,
            'currency' => 'IRR', 'duration_days' => 30,
            'features' => ['showcase' => true, 'max_showcases' => 7, 'ads' => true, 'max_ads' => 2],
            'is_active' => true, 'is_public' => true,
        ]);
    }

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
        return InternalNotification::where('type', 'subscription_expired')
            ->whereIn('related_id', Subscription::where('business_id', $businessId)->pluck('id'))
            ->count();
    }

    private function withCronToken(?string $token = self::TOKEN)
    {
        return $this->withHeaders($token === null ? [] : ['X-Cron-Token' => $token]);
    }

    public function test_the_endpoint_is_disabled_when_no_token_is_configured(): void
    {
        config(['app.cron_token' => null]);
        $business = $this->business($this->owner());
        $subscription = $this->activeSubscription($business, $this->plan());

        // Even a correct-looking header must not open an unconfigured endpoint.
        $this->withCronToken()->postJson(self::ENDPOINT)->assertNotFound();

        $this->assertSame('active', $subscription->fresh()->status);
        $this->assertSame(0, $this->expiredNotifications($business->id));
    }

    public function test_a_missing_or_wrong_token_is_forbidden_and_nothing_changes(): void
    {
        config(['app.cron_token' => self::TOKEN]);
        $business = $this->business($this->owner());
        $subscription = $this->activeSubscription($business, $this->plan());

        $this->postJson(self::ENDPOINT)->assertForbidden();
        $this->withCronToken('not-the-token')->postJson(self::ENDPOINT)->assertForbidden();
        $this->withCronToken('')->postJson(self::ENDPOINT)->assertForbidden();

        $this->assertSame('active', $subscription->fresh()->status);
        $this->assertSame(0, $this->expiredNotifications($business->id));
    }

    public function test_a_valid_token_runs_the_sweep_and_reports_the_count(): void
    {
        config(['app.cron_token' => self::TOKEN]);
        $business = $this->business($this->owner());
        $subscription = $this->activeSubscription($business, $this->plan());

        $this->withCronToken()
            ->postJson(self::ENDPOINT)
            ->assertOk()
            ->assertExactJson(['ok' => true, 'expired' => 1]);

        $this->assertSame('expired', $subscription->fresh()->status);
        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_repeated_triggers_are_idempotent_and_never_duplicate_the_notification(): void
    {
        config(['app.cron_token' => self::TOKEN]);
        $business = $this->business($this->owner());
        $this->activeSubscription($business, $this->plan());

        $this->withCronToken()->postJson(self::ENDPOINT)->assertOk()->assertJson(['expired' => 1]);

        // A retry from the outside timer (or an overlapping one) transitions
        // nothing a second time, and the owner is told exactly once.
        $this->withCronToken()->postJson(self::ENDPOINT)->assertOk()->assertJson(['expired' => 0]);
        $this->withCronToken()->postJson(self::ENDPOINT)->assertOk()->assertJson(['expired' => 0]);

        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_a_due_scheduled_downgrade_is_promoted_by_the_same_trigger(): void
    {
        config(['app.cron_token' => self::TOKEN]);
        $business = $this->business($this->owner());
        $plan = $this->plan();

        $active = $this->activeSubscription($business, $plan);
        $scheduled = $this->activeSubscription($business, $plan, [
            'status' => 'scheduled',
            'started_at' => Carbon::now()->subHour(),
            'expires_at' => Carbon::now()->addDays(29),
        ]);

        $this->withCronToken()->postJson(self::ENDPOINT)->assertOk();

        $this->assertSame('expired', $active->fresh()->status);
        $this->assertSame('active', $scheduled->fresh()->status);
        $this->assertSame(1, $this->expiredNotifications($business->id));
    }

    public function test_the_endpoint_is_post_only_and_leaks_no_customer_data(): void
    {
        config(['app.cron_token' => self::TOKEN]);
        $business = $this->business($this->owner());
        $this->activeSubscription($business, $this->plan());

        $this->getJson(self::ENDPOINT)->assertStatus(405);

        $response = $this->withCronToken()->postJson(self::ENDPOINT)->assertOk();
        $this->assertSame(['ok', 'expired'], array_keys($response->json()));
        $this->assertStringNotContainsString($business->name, $response->getContent());
    }
}
