<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * PAYMENT SECURITY TEST SUITE — ZarinPal sandbox era.
 *
 * Covers the threat model (docs/PAYMENT_THREAT_MODEL_FA.md):
 * happy path, plan/amount/authority tampering, callback replay, wrong
 * user/business/plan, forged success, provider failure, canceled payment,
 * network failure, concurrent callback, already-paid transaction, refresh
 * idempotency, direct-URL activation, client-side bypass.
 *
 * Convention: every test name states the expected result (…_activates /
 * …_is_rejected / …_is_not_activated).
 */
class PaymentSecurityTest extends TestCase
{
    use RefreshDatabase;

    /* ------------------------------------------------------------- helpers */

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########'), 'email' => 'owner-'.uniqid().'@test.local']);
        $user->assignRole('business_owner');

        return $user;
    }

    private function secondOwner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########'), 'email' => 'second-'.uniqid().'@test.local']);
        $user->assignRole('business_owner');

        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09123330000']);
        $user->assignRole('admin');

        return $user;
    }

    private function business(User $user, string $slug = 'pay-biz'): Business
    {
        return $user->businesses()->create(['name' => 'Pay Biz', 'slug' => $slug.'-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(int $price = 249000, int $days = 30, array $features = ['showcase' => true, 'max_showcases' => 5]): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => $price,
            'currency' => 'IRR', 'duration_days' => $days, 'features' => $features,
            'is_active' => true, 'is_public' => true,
        ]);
    }

    /** Create a pending transaction row directly (init flow with a stubbed gateway). */
    private function pendingTransaction(Business $business, Plan $plan, ?User $user = null): PaymentTransaction
    {
        $transaction = (new PaymentTransaction)->forceFill([
            'user_id' => ($user ?? $business->owner)->id,
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'provider' => 'zarinpal',
            'authority' => 'S'.str_repeat('0', 24).uniqid(),
            'amount' => (int) $plan->priceRial(), // gateway RIAL amount, same conversion as the service
            'currency' => $plan->currency,
            'status' => PaymentTransaction::STATUS_PENDING,
        ]);
        $transaction->save();

        return $transaction;
    }

    /** Stub the two provider endpoints (request + verify) with a queue of responses. */
    private function fakeZarinpal(): void
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => function () {
                return Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]);
            },
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => function () {
                return Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'], 'errors' => []]);
            },
        ]);
    }

    private function initPayload(Business $business, Plan $plan): array
    {
        return ['plan_id' => $plan->id];
    }

    /* ================================================= HAPPY PATH (PASS) */

    public function test_init_creates_transaction_with_server_side_amount_and_returns_redirect(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan(249000);

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", $this->initPayload($business, $plan))
            ->assertCreated();

        $row = PaymentTransaction::findOrFail($res->json('transaction_id'));
        // MONEY UNIT CONTRACT: plans.price is TOMAN; the transaction amount
        // is the GATEWAY amount in RIAL (price × 10 = 2,490,000).
        $this->assertSame(2490000, (int) $row->amount, 'amount must be the gateway RIAL amount from the DB plan');
        $this->assertSame('IRR', $row->currency);
        $this->assertSame($plan->id, $row->plan_id);
        $this->assertSame($business->id, $row->business_id);
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status);
        $this->assertNotNull($row->authority);
        $this->assertStringStartsWith('https://sandbox.zarinpal.com/pg/StartPay/', $res->json('redirect_url'));
    }

    public function test_successful_callback_verifies_activates_subscription_and_entitlements(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $row = $this->pendingTransaction($business, $plan);

        $res = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK");
        $res->assertOk();

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_PAID, $row->status);
        $this->assertNotNull($row->paid_at);
        $this->assertNotNull($row->verified_at);
        $this->assertNotNull($row->ref_id);

        $subscription = Subscription::find($row->subscription_id);
        $this->assertNotNull($subscription, 'exactly one subscription must be created');
        $this->assertSame('active', $subscription->status);
        $this->assertSame((int) $plan->price, (int) $subscription->price_amount, 'money snapshot from the DB plan');
        $this->assertSame($plan->duration_days, (int) $subscription->duration_days);
        $this->assertNotNull($subscription->start_date);
        $this->assertNotNull($subscription->end_date);
        $this->assertEqualsCanonicalizing(['showcase' => true, 'max_showcases' => 5], $subscription->entitlements, 'entitlement snapshot must be frozen');
        $this->assertTrue(app(FeatureGate::class)->allows($business, 'showcase'));
    }

    /* ================================================= FAIL / SECURITY */

    public function test_invalid_forged_authority_is_rejected_and_activates_nothing(): void
    {
        Http::fake(['*' => Http::response(['data' => [], 'errors' => ['message' => 'not found', 'code' => -51]], 200)]);
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();

        $res = $this->getJson('/api/payments/callback?Authority=FORGED-AUTHORITY-123&Status=OK');
        $res->assertOk(); // callback answers JSON without FRONTEND_URL in tests

        $this->assertSame(0, Subscription::count(), 'no subscription may be created');
        $this->assertSame('failed', $res->json('status'));
        $this->assertNotSame(PaymentTransaction::STATUS_PAID, PaymentTransaction::where('authority', 'FORGED-AUTHORITY-123')->value('status'));
        $this->assertSame(0, PaymentTransaction::where('plan_id', $plan->id)->where('status', PaymentTransaction::STATUS_PAID)->count());
    }

    public function test_callback_with_bad_status_nok_cancels_and_does_not_verify_or_activate(): void
    {
        // Verify endpoint must NOT be hit: assert by faking only request, then NOK.
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response(['data' => ['code' => 100]], 200)]);
        $user = $this->owner();
        $row = $this->pendingTransaction($this->business($user), $this->plan());

        $res = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=NOK")->assertOk();

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_CANCELED, $row->status);
        $this->assertNull($row->paid_at);
        $this->assertNull($row->subscription_id);
        $this->assertSame(0, Subscription::count());
        Http::assertNothingSent(); // NOK must never call verify
    }

    public function test_verify_failure_marks_failed_and_activates_nothing(): void
    {
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response([
            'data' => [], 'errors' => ['message' => 'Session is not valid', 'code' => -51],
        ], 200)]);
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_FAILED, $row->status);
        $this->assertStringContainsString('verify_failed', (string) $row->failure_reason);
        $this->assertNull($row->subscription_id);
        $this->assertSame(0, Subscription::count());
    }

    public function test_provider_timeout_keeps_row_pending_and_activates_nothing(): void
    {
        Http::fake(function () {
            throw new ConnectionException('cURL error 28: timeout');
        });
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        $res = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK");
        $res->assertStatus(503);

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status, 'timeout must stay recoverable (pending)');
        $this->assertNull($row->subscription_id);
        $this->assertSame(0, Subscription::count(), 'network failure must never activate');
    }

    public function test_provider_5xx_keeps_row_pending_and_activates_nothing(): void
    {
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response('oops', 503)]);
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertStatus(503);

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status);
        $this->assertSame(0, Subscription::count());
    }

    public function test_duplicate_callback_replay_is_idempotent_and_creates_no_second_subscription(): void
    {
        $this->fakeZarinpal();
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        $first = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();
        $this->assertSame('paid', $first->json('status'));
        $firstSubId = $row->refresh()->subscription_id;
        $this->assertNotNull($firstSubId);

        // REPLAY: same authority, same OK callback, second + third time.
        $second = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();
        $third = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();

        $this->assertTrue((bool) $second->json('already_final'));
        $this->assertTrue((bool) $third->json('already_final'));
        $row->refresh();
        $this->assertSame($firstSubId, $row->subscription_id, 'subscription_id must never change on replay');
        $this->assertSame(1, Subscription::count(), 'no duplicate subscription');
        $this->assertSame(1, Subscription::where('status', 'active')->count());
        $this->assertSame(1, PaymentTransaction::where('status', PaymentTransaction::STATUS_PAID)->count());
    }

    public function test_concurrent_callbacks_cannot_double_activate(): void
    {
        $this->fakeZarinpal();
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        // Simulate the race: two callbacks arrive; the DB-level row lock +
        // state machine serializes them. Second one must observe non-pending.
        $results = [];
        $run = fn () => $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK");
        $results[] = $run()->assertOk()->json('already_final');
        $results[] = $run()->assertOk()->json('already_final');

        $this->assertSame(1, Subscription::count(), 'exactly one subscription across the race');
        $this->assertSame(1, Subscription::where('business_id', $row->business_id)->where('status', 'active')->count());
        $row->refresh();
        $this->assertSame(1, (int) PaymentTransaction::where('authority', $row->authority)->count());
        $this->assertFalse($results[0] && $results[1], 'at most one of the two callbacks may claim activation');
    }

    public function test_already_paid_transaction_via_verify_101_does_not_double_activate(): void
    {
        // ZarinPal verify code 101 = "verified before": genuine but consumed.
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response([
            'data' => ['code' => 101, 'ref_id' => '555555'], 'errors' => [],
        ], 200)]);

        $user = $this->owner();
        $business = $this->business($user);
        $row = $this->pendingTransaction($business, $this->plan());
        // Pre-consume: transaction already paid and bound to an earlier subscription.
        $old = Subscription::create(['business_id' => $business->id, 'plan_id' => $row->plan_id, 'status' => 'active']);
        $row->forceFill(['status' => PaymentTransaction::STATUS_PAID, 'paid_at' => now(), 'verified_at' => now(), 'ref_id' => '555555', 'subscription_id' => $old->id])->save();

        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();

        $row->refresh();
        $this->assertSame($old->id, $row->subscription_id, 'consumed transaction keeps its original subscription');
        $this->assertSame(1, Subscription::count());
    }

    public function test_verify_amount_is_always_taken_from_db_row_never_client(): void
    {
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response([
            'data' => ['code' => 100, 'ref_id' => '777'], 'errors' => [],
        ], 200)]);
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan(249000));

        // Attacker-supplied amounts in the callback query string must be ignored.
        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK&Amount=1&amount=999");
        $row->refresh();
        // Row amount = gateway RIAL amount (249000 toman × 10); immutable from callback input.
        $this->assertSame(2490000, (int) $row->amount, 'stored amount is immutable from callback input');

        // The verification payload stores the code AND the expected amount
        // the provider was asked to verify against (the DB row's amount).
        $row->refresh();
        $this->assertSame(2490000, (int) ($row->verification_payload['expected_amount'] ?? 0), 'verify amount must equal the DB row amount (RIAL)');
        $this->assertNotNull($row->ref_id, 'provider ref_id recorded');
    }

    public function test_status_endpoint_rejects_wrong_user_and_reveals_nothing(): void
    {
        $userA = $this->owner();
        $userB = $this->secondOwner();
        $row = $this->pendingTransaction($this->business($userA), $this->plan());

        // User B (not owner, not admin) must be forbidden.
        $this->actingAs($userB)->getJson("/api/payments/status?authority={$row->authority}")->assertForbidden();

        // Guest must be rejected (401 unauthenticated or 403 forbidden —
        // either way the transaction is not revealed).
        $guestStatus = $this->getJson("/api/payments/status?authority={$row->authority}")->status();
        $this->assertContains($guestStatus, [401, 403], 'guest must not read transaction status');

        // Owner may read.
        $this->actingAs($userA)->getJson("/api/payments/status?authority={$row->authority}")->assertOk()->assertJsonPath('status', 'pending');
    }

    public function test_user_a_cannot_verify_or_see_transaction_of_user_b(): void
    {
        $userA = $this->owner();
        $userB = $this->secondOwner();
        $businessB = $this->business($userB, 'biz-b');
        $rowB = $this->pendingTransaction($businessB, $this->plan(), $userB);

        // A cannot init a payment on B's business.
        $this->actingAs($userA)->postJson("/api/businesses/{$businessB->id}/payments/init", ['plan_id' => $rowB->plan_id])->assertForbidden();

        // A cannot read B's transaction status.
        $this->actingAs($userA)->getJson("/api/payments/status?authority={$rowB->authority}")->assertForbidden();

        // Even A's session riding B's authority cannot mutate anything: the
        // callback is stateless — it can only resolve B's own row via verify.
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response(['data' => [], 'errors' => ['code' => -51]], 200)]);
        $this->actingAs($userA)->getJson("/api/payments/callback?Authority={$rowB->authority}&Status=OK");
        $rowB->refresh();
        $this->assertNotSame(PaymentTransaction::STATUS_PAID, $rowB->status, 'wrong-user callback must not mark paid');
        $this->assertSame(0, Subscription::where('business_id', $businessB->id)->count());
    }

    public function test_init_requires_ownership_and_blocks_foreign_business(): void
    {
        $userA = $this->owner();
        $userB = $this->secondOwner();
        $businessB = $this->business($userB, 'biz-b2');
        $plan = $this->plan();

        $this->actingAs($userA)->postJson("/api/businesses/{$businessB->id}/payments/init", ['plan_id' => $plan->id])->assertForbidden();
        $this->assertSame(0, PaymentTransaction::where('business_id', $businessB->id)->count());
    }

    public function test_init_requires_authentication(): void
    {
        $business = $this->business($this->owner());
        $this->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $this->plan()->id])->assertUnauthorized();
    }

    public function test_init_with_wrong_plan_id_is_rejected(): void
    {
        $user = $this->owner();
        $business = $this->business($user);
        $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => 999999])->assertUnprocessable();
        $this->assertSame(0, PaymentTransaction::count());
    }

    public function test_init_rejects_deactivated_plan(): void
    {
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $plan->update(['is_active' => false]);

        $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])->assertNotFound();
        $this->assertSame(0, PaymentTransaction::count());
    }

    public function test_init_rejects_non_public_plan(): void
    {
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $plan->update(['is_public' => false]);

        $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])->assertNotFound();
        $this->assertSame(0, PaymentTransaction::count());
    }

    public function test_client_cannot_inject_amount_currency_duration_or_status(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan(249000, 30);

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", [
            'plan_id' => $plan->id,
            // Forged commercial fields — must ALL be ignored:
            'amount' => 1,
            'price' => 2,
            'currency' => 'USD',
            'duration_days' => 9999,
            'plan_name' => 'Free',
            'entitlements' => ['ads' => true, 'max_cards' => 99999],
            'status' => 'paid',
            'business_id' => 1,
            'user_id' => 1,
            'authority' => 'FAKE',
            'ref_id' => 'FAKE-REF',
            'subscription_id' => 1,
        ])->assertCreated();

        $row = PaymentTransaction::findOrFail($res->json('transaction_id'));
        $this->assertSame(2490000, (int) $row->amount);
        $this->assertSame('IRR', $row->currency);
        $this->assertSame($plan->id, $row->plan_id);
        $this->assertSame($business->id, $row->business_id);
        $this->assertSame($user->id, $row->user_id);
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status);
        $this->assertNull($row->ref_id);
        $this->assertNull($row->subscription_id);
        $this->assertNotSame('FAKE', $row->authority);
    }

    public function test_transaction_business_binding_is_immutable_after_init(): void
    {
        $userA = $this->owner();
        $businessA = $this->business($userA, 'biz-a');
        $businessB = $this->business($userA, 'biz-b'); // same owner, different business
        $row = $this->pendingTransaction($businessA, $this->plan());

        // No endpoint accepts a business transfer: attempt via status & callback.
        $this->actingAs($userA)->getJson("/api/payments/status?authority={$row->authority}");
        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK&business_id={$businessB->id}");
        $row->refresh();
        $this->assertSame($businessA->id, $row->business_id, 'business binding must never change');
        $this->assertSame(0, Subscription::where('business_id', $businessB->id)->count());
    }

    public function test_direct_url_access_without_real_provider_verify_activates_nothing(): void
    {
        // Attacker crafts a success-looking URL with an authority that was
        // never issued by the provider for a real session.
        Http::fake(['sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response([
            'data' => [], 'errors' => ['message' => 'authority not found', 'code' => -51],
        ], 200)]);

        $user = $this->owner();
        $business = $this->business($user);
        $this->plan();

        $this->getJson('/api/payments/callback?Status=OK&Authority=S00000000000000000000000000000FAKE')->assertOk();

        $this->assertSame(0, Subscription::count(), 'direct success URL must never activate');
        $this->assertSame(0, PaymentTransaction::where('status', PaymentTransaction::STATUS_PAID)->count());
    }

    public function test_status_refresh_after_success_is_read_only(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $row = $this->pendingTransaction($business, $this->plan());

        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();
        $subCount = Subscription::count();

        // User refreshes the result page repeatedly → status endpoint only.
        for ($i = 0; $i < 3; $i++) {
            $this->actingAs($user)->getJson("/api/payments/status?authority={$row->authority}")
                ->assertOk()
                ->assertJsonPath('status', 'paid');
        }

        $this->assertSame($subCount, Subscription::count(), 'refresh must not re-activate');
        $this->assertSame(1, Subscription::where('status', 'active')->count());
    }

    public function test_prune_pending_command_expires_stale_rows_and_never_activates(): void
    {
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());
        PaymentTransaction::query()->update(['created_at' => now()->subHours(48)]);

        $this->artisan('payment:prune-pending')->assertExitCode(0);

        $row->refresh();
        $this->assertSame(PaymentTransaction::STATUS_EXPIRED, $row->status);
        $this->assertSame(0, Subscription::count());

        // Pruning never touches paid rows:
        $paid = $this->pendingTransaction($this->business($this->owner()), $this->plan());
        $paid->forceFill(['status' => PaymentTransaction::STATUS_PAID, 'paid_at' => now()])->save();
        PaymentTransaction::whereKey($paid->id)->update(['created_at' => now()->subHours(48)]);
        $this->artisan('payment:prune-pending')->assertExitCode(0);
        $this->assertSame(PaymentTransaction::STATUS_PAID, $paid->refresh()->status);
    }

    public function test_activation_supersedes_previous_active_subscription(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan();
        $oldPlan = $this->plan(99000, 30, ['showcase' => true]);
        $old = $business->subscriptions()->create(['plan_id' => $oldPlan->id, 'status' => 'active', 'start_date' => now(), 'end_date' => now()->addDays(10)]);

        $row = $this->pendingTransaction($business, $plan);
        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();

        $this->assertSame('expired', $old->refresh()->status, 'old active subscription must be superseded');
        $this->assertSame(1, Subscription::where('business_id', $business->id)->where('status', 'active')->count());
    }

    public function test_init_gateway_unreachable_marks_row_failed_and_returns_503(): void
    {
        Http::fake(function () {
            throw new ConnectionException('cURL error 7: connection refused');
        });
        $user = $this->owner();
        $business = $this->business($user);

        // The gateway exception is converted to 503 by the exception handler
        // only when app.debug is off; with debug on (tests) it may surface as
        // 500 — the SECURITY-relevant assertion is the row state below.
        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $this->plan()->id]);
        $this->assertContains($res->status(), [500, 503], 'client-facing failure without any success signal');

        $row = PaymentTransaction::first();
        $this->assertNotNull($row);
        $this->assertSame(PaymentTransaction::STATUS_FAILED, $row->status);
        $this->assertNull($row->authority);
        $this->assertSame(0, Subscription::count());
    }

    public function test_callback_without_authority_is_rejected(): void
    {
        $this->getJson('/api/payments/callback?Status=OK')->assertStatus(400);
        $this->assertSame(0, Subscription::count());
    }

    public function test_callback_with_frontend_url_configured_returns_redirect_to_result_page(): void
    {
        // REGRESSION for browser-E2E finding F1: with FRONTEND_URL set the
        // callback must REDIRECT the browser to the SPA result page (302),
        // not crash with a JsonResponse-only return type. Idempotent replay
        // must behave identically (this exact sequence broke production E2E).
        config(['business.frontend_url' => 'http://localhost:3000']);
        $this->fakeZarinpal();
        $row = $this->pendingTransaction($this->business($this->owner()), $this->plan());

        $first = $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK");
        $first->assertRedirect("http://localhost:3000/payment/result?authority={$row->authority}");

        // Replay after the fix: still a clean redirect, never a 500 TypeError.
        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")
            ->assertRedirect("http://localhost:3000/payment/result?authority={$row->authority}");
        $this->assertSame(1, Subscription::count(), 'replay must not create a second subscription');
    }

    public function test_plan_price_change_after_init_does_not_change_the_charged_amount(): void
    {
        $this->fakeZarinpal();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->plan(249000);
        $row = $this->pendingTransaction($business, $plan);

        // Admin reprices the plan AFTER the transaction was created.
        $plan->update(['price' => 1]);

        $this->getJson("/api/payments/callback?Authority={$row->authority}&Status=OK")->assertOk();
        $row->refresh();
        $subscription = Subscription::find($row->subscription_id);

        $this->assertSame(2490000, (int) $row->amount, 'stored amount (RIAL) is frozen');
        $this->assertSame(249000, (int) $subscription->price_amount, 'subscription money snapshot stays in TOMAN (display unit)');
    }
}
