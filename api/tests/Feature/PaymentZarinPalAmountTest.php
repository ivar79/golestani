<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * ZARINPAL AMOUNT UNIT REGRESSION (requirement 1 — money correctness).
 *
 * The UI displays plan prices in TOMAN («۲۴۹٬۰۰۰ تومان» from plans.price),
 * but ZarinPal charges RIAL. These tests lock the entire money flow:
 *
 *   plans.price (TOMAN, display) ──×10──▶ payment_transactions.amount (RIAL)
 *                                                    │
 *                                                    ├─▶ request.json  amount = 2,490,000
 *                                                    └─▶ verify.json   amount = 2,490,000 (from the DB row)
 *
 * No zero may be lost or added anywhere in the flow. The single ×10 lives
 * in Plan::priceRial(); the client can never influence any money value.
 */
class PaymentZarinPalAmountTest extends TestCase
{
    use RefreshDatabase;

    private const TOMAN_PRICE = 249000;      // UI/display unit — plans.price

    private const RIAL_AMOUNT = 2490000;     // gateway unit — price × 10

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'Money Biz', 'slug' => 'money-'.uniqid(), 'status' => 'approved']);
    }

    private function professionalPlan(): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => self::TOMAN_PRICE,
            'currency' => 'IRR', 'duration_days' => 30, 'features' => ['showcase' => true, 'max_showcases' => 5],
            'is_active' => true, 'is_public' => true,
        ]);
    }

    /** The EXACT payload bodies the gateway received — captured for assertions. */
    private function capturedRequestBodies(string $url): array
    {
        return collect(Http::recorded())
            ->filter(fn (array $pair) => str_contains($pair[0]->url(), $url))
            ->map(fn (array $pair) => $pair[0]->data())
            ->values()
            ->all();
    }

    private function fakeGatewaySuccess(): void
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'], 'errors' => []]),
        ]);
    }

    /* ============================================ the ×10 regression core */

    public function test_zarinpal_request_receives_exactly_2490000_rial_for_the_249000_toman_plan(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();

        $requests = $this->capturedRequestBodies('payment/request.json');
        $this->assertCount(1, $requests, 'exactly one gateway request must be sent');

        $body = $requests[0];
        $this->assertSame(self::RIAL_AMOUNT, (int) $body['amount'],
            'ZarinPal request.json MUST receive 2,490,000 RIAL (249,000 toman × 10) — never the raw toman value');
        $this->assertSame(self::TOMAN_PRICE * 10, self::RIAL_AMOUNT, 'sanity: the ×10 conversion is exact');
    }

    public function test_transaction_row_stores_the_rial_gateway_amount(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();

        $row = PaymentTransaction::findOrFail($res->json('transaction_id'));
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->amount, 'DB row must store the GATEWAY amount in RIAL');
        $this->assertSame('IRR', $row->currency);
        $this->assertSame($plan->id, $row->plan_id);
        $this->assertSame($user->id, $row->user_id);
        $this->assertSame($business->id, $row->business_id);
    }

    public function test_verify_is_called_with_the_exact_stored_rial_amount(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        $verifies = $this->capturedRequestBodies('payment/verify.json');
        $this->assertCount(1, $verifies, 'exactly one verify call');
        $this->assertSame(self::RIAL_AMOUNT, (int) $verifies[0]['amount'],
            'verify MUST use the stored DB amount (2,490,000 RIAL) — never a client value');
        $this->assertSame($authority, (string) $verifies[0]['authority']);

        $row = PaymentTransaction::where('authority', $authority)->first();
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->verification_payload['expected_amount'],
            'the expected amount is recorded in the verification payload');
    }

    public function test_replay_callback_never_shifts_the_amount_by_a_digit(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        // Replay the callback (duplicate ZarinPal redirect) with forged amounts.
        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK&Amount=249&amount=249000000");

        $row = PaymentTransaction::where('authority', $authority)->first()->refresh();
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->amount, 'replay must not touch the stored amount');
        $this->assertNotNull($row->subscription_id);

        $verifies = $this->capturedRequestBodies('payment/verify.json');
        $this->assertCount(1, $verifies, 'replay must NOT re-verify (idempotent refusal)');
        foreach ($verifies as $body) {
            $this->assertSame(self::RIAL_AMOUNT, (int) $body['amount'], 'every verify call carries exactly the stored rial amount — no digit drift');
        }
    }

    public function test_plan_reprice_after_init_never_changes_the_charged_amount(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');

        // Admin reprices 249,000 → 500,000 AFTER the session was created.
        $plan->update(['price' => 500000]);

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        $row = PaymentTransaction::where('authority', $authority)->first()->refresh();
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->amount, 'the charged amount was frozen at init; the repriced plan must NOT leak into the running session');

        $verifies = $this->capturedRequestBodies('payment/verify.json');
        $this->assertSame(self::RIAL_AMOUNT, (int) $verifies[0]['amount']);
    }

    public function test_client_injected_money_fields_are_completely_ignored(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", [
            'plan_id' => $plan->id,
            'amount' => 1,                      // forged rial
            'price' => 2,                       // forged toman
            'amount_toman' => 1000,             // forged invented field
            'currency' => 'USD',
        ])->assertCreated();

        $row = PaymentTransaction::findOrFail($res->json('transaction_id'));
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->amount, 'client cannot set the gateway amount');
        $this->assertSame('IRR', $row->currency, 'client cannot set the currency');

        $requests = $this->capturedRequestBodies('payment/request.json');
        $this->assertSame(self::RIAL_AMOUNT, (int) $requests[0]['amount'], 'the gateway received the server-computed amount only');
    }

    public function test_subscription_money_snapshot_stays_in_toman_beside_the_rial_transaction(): void
    {
        $this->fakeGatewaySuccess();
        $user = $this->owner();
        $business = $this->business($user);
        $plan = $this->professionalPlan();

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        $row = PaymentTransaction::where('authority', $authority)->first()->refresh();
        $subscription = Subscription::findOrFail($row->subscription_id);

        $this->assertSame(self::TOMAN_PRICE, (int) $subscription->price_amount,
            'the display/report snapshot stays in TOMAN (249,000) — matches every UI and the revenue report');
        $this->assertSame(self::RIAL_AMOUNT, (int) $row->amount,
            'the gateway row keeps the RIAL amount (2,490,000) — both units traceable from the DB');
    }
}
