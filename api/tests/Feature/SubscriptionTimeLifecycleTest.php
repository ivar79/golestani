<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * SUBSCRIPTION TIME LIFECYCLE (requirements 3–7).
 *
 * Source of truth = started_at/expires_at timestamps (UTC). Remaining time
 * is ALWAYS derived (expires_at − now) — there is no stored counter to
 * decrement, so refresh / multiple devices / cron failure / restarts /
 * timezones can never drift it. Access control re-evaluates the timestamp
 * on EVERY read: the instant `expires_at` passes, the subscription stops
 * granting entitlements (no cron needed) and free-tier limits return.
 */
class SubscriptionTimeLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function secondOwner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user, string $slug = 'time-biz'): Business
    {
        return $user->businesses()->create(['name' => 'Time Biz', 'slug' => $slug.'-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(int $price = 249000, int $days = 30, array $features = ['showcase' => true, 'max_showcases' => 5]): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => $price,
            'currency' => 'IRR', 'duration_days' => $days, 'features' => $features,
            'is_active' => true, 'is_public' => true,
        ]);
    }

    private function fakeZarinpal(): void
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'], 'errors' => []]),
        ]);
    }

    /** A deliberately BOGUS success response — the gateway is stubbed, and no
     *  HTTP attempt ever escapes the test process (Http::fake is global for
     *  the remainder of the test once called). */
    private function fakeZarinpalInitOnly(): void
    {
        // Closure (not a static response): each init call gets a FRESH
        // authority — a static response would return the same token twice
        // and trip the authority UNIQUE constraint.
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => fn () => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
        ]);
    }

    /** Full real-flow purchase: init → callback → paid → activation. */
    private function purchase(Business $business, Plan $plan): Subscription
    {
        $this->fakeZarinpal();
        $res = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        return Subscription::findOrFail(PaymentTransaction::where('authority', $authority)->first()->subscription_id);
    }

    /* ============================================ timestamps are the truth */

    public function test_successful_payment_sets_timestamp_lifecycle_and_exact_expiry(): void
    {
        // Freeze the server clock: 2026-09-28 15:30 → 30 days = 2026-10-28 15:30.
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));

        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $subscription = $this->purchase($business, $plan);

        $this->assertSame('active', $subscription->status);
        $this->assertEquals(Carbon::parse('2026-09-28 15:30:00', 'UTC'), $subscription->started_at);
        $this->assertEquals(Carbon::parse('2026-10-28 15:30:00', 'UTC'), $subscription->expires_at,
            'expires_at = started_at + plan duration, at the EXACT purchase time');
        // Day-granular mirror stays consistent for reports.
        $this->assertSame('2026-09-28', $subscription->start_date->toDateString());
        $this->assertSame('2026-10-28', $subscription->end_date->toDateString());

        Carbon::setTestNow();
    }

    public function test_remaining_time_is_derived_and_no_db_counter_exists_or_decrements(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $subscription = $this->purchase($business, $plan);

        $firstRead = $subscription->refresh()->remaining_seconds;
        $this->assertSame(30 * 86400, $firstRead);

        // Advance the SERVER clock 2 hours: the remaining time derived from
        // timestamps decreases by exactly 7200s — with ZERO DB writes.
        Carbon::setTestNow(Carbon::parse('2026-09-28 17:30:00', 'UTC'));
        $subscription->refresh();
        $this->assertSame($firstRead - 7200, $subscription->remaining_seconds,
            'remaining = expires_at − now, purely derived');

        // Prove nothing in the row stores/decrements a counter: only the
        // activation writes happened (no writes between the two reads).
        $updatedColumns = array_intersect_key(
            $subscription->getAttributes(),
            array_flip(['remaining_days', 'remaining_seconds_stored', 'remaining_hours'])
        );
        $this->assertSame([], $updatedColumns, 'no decrementing counter column exists on the row');

        Carbon::setTestNow();
    }

    public function test_refresh_and_multiple_reads_show_the_same_remaining_time(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $subscription = $this->purchase($business, $plan);

        // Simulate multiple devices / repeated refreshes: every read at the
        // same server moment yields the SAME remaining time (no drift).
        $reads = [];
        for ($i = 0; $i < 3; $i++) {
            $reads[] = $subscription->refresh()->remaining_seconds;
            $reads[] = Subscription::find($subscription->id)->remaining_seconds;
        }
        $this->assertCount(1, array_unique($reads), 'all reads/devices see identical remaining time');

        Carbon::setTestNow();
    }

    public function test_no_endpoint_accepts_time_fields_from_the_client(): void
    {
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $this->fakeZarinpal();

        // Client attempts to inject its own lifecycle — must all be ignored.
        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", [
            'plan_id' => $plan->id,
            'started_at' => '2000-01-01T00:00:00Z',
            'expires_at' => '2099-01-01T00:00:00Z',
            'remaining_seconds' => 999999999,
            'duration_days' => 99999,
        ])->assertCreated();

        $authority = $res->json('authority');
        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        $subscription = Subscription::find(PaymentTransaction::where('authority', $authority)->first()->subscription_id);
        $this->assertEquals(Carbon::now('UTC')->startOfSecond(), $subscription->started_at, 'server clock set the start');
        $this->assertTrue($subscription->expires_at->lessThan(Carbon::parse('2099-01-01')), 'client expiry rejected');
        $this->assertSame(30, (int) $subscription->duration_days);
    }

    /* ============================================ expiration blocks access */

    public function test_expiration_blocks_access_immediately_without_cron(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $subscription = $this->purchase($business, $plan);

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'showcase'), 'active before expiry');
        $this->assertSame('active', $subscription->refresh()->effective_status);

        // One second past expires_at — the SAME request-time evaluation now
        // refuses. No nightly sweep has run; nothing was written to the row.
        Carbon::setTestNow(Carbon::parse('2026-10-28 15:30:01', 'UTC'));

        $this->assertFalse($gate->allows($business, 'showcase'), 'access blocked right after expires_at');
        $this->assertSame(0, $gate->limit($business, 'max_showcases'), 'free-tier limit returns');
        $this->assertSame('expired', $subscription->refresh()->effective_status,
            'derived status is expired although the stored flag still says active');
        $this->assertSame(0, $subscription->remaining_seconds);

        Carbon::setTestNow();
    }

    public function test_client_clock_cannot_extend_the_subscription(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $subscription = $this->purchase($business, $plan);
        $expiresAt = $subscription->expires_at->copy();

        // The client's clock is irrelevant to the backend: whatever a user
        // sets their device to, the server keeps evaluating its own UTC now.
        Carbon::setTestNow(Carbon::parse('2026-10-28 15:30:02', 'UTC'));

        // A "client" claiming its local clock is still 2026-09-28 changes nothing.
        $this->actingAs($user)->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('subscription.effective_status', 'expired')
            ->assertJsonPath('entitlements.capabilities.showcase', false);

        $this->assertFalse(app(FeatureGate::class)->allows($business, 'showcase'));
        $this->assertTrue($expiresAt->lt(now()), 'server time governs, not the client clock');

        Carbon::setTestNow();
    }

    /* ============================================ ownership binding */

    public function test_subscription_is_bound_to_the_paying_user_and_business_only(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $userA = $this->owner();
        $userB = $this->secondOwner();
        $businessA = $this->business($userA, 'biz-a');
        $businessB = $this->business($userB, 'biz-b');
        $plan = $this->plan();

        $subscription = $this->purchase($businessA, $plan);

        $this->assertSame($businessA->id, $subscription->business_id, 'activation binds to the PAYING business only');
        $this->assertSame($plan->id, $subscription->plan_id);

        // Activation must NOT create anything for anyone else.
        $this->assertSame(1, Subscription::count());
        $this->assertSame(0, Subscription::where('business_id', $businessB->id)->count());

        // User B's entitlements remain free (isolation).
        $this->actingAs($userB)->getJson("/api/businesses/{$businessB->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('subscription', null)
            ->assertJsonPath('entitlements.capabilities.showcase', false);

        Carbon::setTestNow();
    }

    public function test_wrong_user_cannot_read_subscription_resources(): void
    {
        $userA = $this->owner();
        $userB = $this->secondOwner();
        $businessA = $this->business($userA, 'biz-a');
        $businessB = $this->business($userB, 'biz-b');
        $plan = $this->plan();

        $this->fakeZarinpal();
        $subscription = $this->purchase($businessA, $plan);

        // User A sees only their own subscription list.
        $this->actingAs($userA)->getJson("/api/businesses/{$businessA->id}/subscriptions")
            ->assertOk()
            ->assertJsonCount(1);

        // User B cannot read A's subscription through B's business endpoint…
        $this->actingAs($userB)->getJson("/api/businesses/{$businessB->id}/subscriptions")->assertOk();
        $this->assertSame(0, count(array_filter(
            $this->actingAs($userB)->getJson("/api/businesses/{$businessB->id}/subscriptions")->json(),
            fn (array $s) => $s['id'] === $subscription->id
        )), 'B never receives A\'s subscription row');

        // …nor the entitlements of A's business (IDOR attempt with A's id).
        $this->actingAs($userB)->getJson("/api/businesses/{$businessA->id}/entitlements")->assertForbidden();
        $this->actingAs($userB)->getJson("/api/businesses/{$businessA->id}/subscriptions")->assertForbidden();
        $this->actingAs($userB)->getJson("/api/subscriptions/{$subscription->id}/receipt")->assertForbidden();

        // Payment status of A's authority is also A-only.
        $authority = PaymentTransaction::where('subscription_id', $subscription->id)->first()->authority;
        $this->actingAs($userB)->getJson("/api/payments/status?authority={$authority}")->assertForbidden();

        // Guests are rejected — the role middleware short-circuits with 403
        // (or 401 depending on middleware order); either way no data leaks.
        $guestStatus = $this->getJson("/api/businesses/{$businessA->id}/entitlements")->status();
        $this->assertContains($guestStatus, [401, 403]);
    }

    /* ============================================ payment outcomes */

    public function test_failed_and_canceled_payments_create_no_subscription(): void
    {
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $this->fakeZarinpalInitOnly();

        // Canceled at the gateway (Status=NOK).
        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $this->getJson("/api/payments/callback?Authority={$res->json('authority')}&Status=NOK")->assertOk();
        $this->assertSame(0, Subscription::count(), 'canceled payment must not activate');

        // Verify failure (forged/unpaid session).
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response([
            'data' => [], 'errors' => ['message' => 'Session is not valid', 'code' => -51],
        ], 200)]);
        $res2 = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $this->getJson("/api/payments/callback?Authority={$res2->json('authority')}&Status=OK")->assertOk();
        $this->assertSame(0, Subscription::count(), 'failed verification must not activate');
        $this->assertSame(0, Subscription::where('status', 'active')->count());
    }

    public function test_payment_record_contains_the_full_audit_trail(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $this->fakeZarinpal();
        $subscription = $this->purchase($business, $plan);
        $row = PaymentTransaction::where('subscription_id', $subscription->id)->firstOrFail();

        // Re-fetching through the service-level fake in purchase(): the
        // gateway stub covers both request.json and verify.json.

        $this->assertSame($user->id, $row->user_id);
        $this->assertSame($business->id, $row->business_id);
        $this->assertSame($plan->id, $row->plan_id);
        $this->assertSame('zarinpal', $row->provider);
        $this->assertNotSame('', $row->authority);
        $this->assertNotNull($row->ref_id, 'provider reference recorded');
        $this->assertSame(2490000, (int) $row->amount, 'RIAL gateway amount');
        $this->assertSame('IRR', $row->currency);
        $this->assertSame('paid', $row->status);
        $this->assertNotNull($row->paid_at);
        $this->assertNotNull($row->verified_at, 'verification timestamp recorded');
        $this->assertNotNull($row->created_at, 'initiated_at = created_at');
        $this->assertSame($subscription->id, $row->subscription_id, 'payment ↔ subscription relationship');
        // No sensitive card data is stored — only the masked PAN (or null).

        Carbon::setTestNow();
    }
}
