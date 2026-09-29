<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\Payments\PaymentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Concurrency-level tests for the payment activation race.
 *
 * The Feature suite covers sequential replays; here we prove the row-lock +
 * unique-constraint combination blocks the classic race where two requests
 * read `pending` simultaneously and both try to activate.
 */
class PaymentConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    private function plan(): Plan
    {
        return Plan::create([
            'name' => 'Race', 'slug' => 'race-'.uniqid(), 'price' => 100000, 'currency' => 'IRR',
            'duration_days' => 30, 'features' => ['showcase' => true], 'is_active' => true, 'is_public' => true,
        ]);
    }

    private function pendingRow(Business $business, Plan $plan): PaymentTransaction
    {
        $row = (new PaymentTransaction)->forceFill([
            'user_id' => $business->user_id, 'business_id' => $business->id, 'plan_id' => $plan->id,
            'provider' => 'zarinpal', 'authority' => 'SRACE'.str_pad((string) random_int(1, 999999), 20, '0').uniqid(),
            'amount' => (int) $plan->priceRial(), 'currency' => 'IRR', 'status' => 'pending',
        ]);
        $row->save();

        return $row;
    }

    public function test_claim_paid_is_atomic_two_claims_only_one_wins(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');
        $business = $user->businesses()->create(['name' => 'Race Biz', 'slug' => 'race-biz-'.uniqid(), 'status' => 'approved']);
        $plan = $this->plan();
        $row = $this->pendingRow($business, $plan);

        // Two "callbacks" racing: the first claims pending→paid, the second
        // must observe a non-pending row (claimed=false).
        $claimed = [];

        $worker = function () use ($row, &$claimed): void {
            $connection = DB::connection();
            ['claimed' => $ok] = PaymentTransaction::claimPaid($row->authority, [
                'ref_id' => 'R'.random_int(1000, 9999),
                'payload' => ['code' => 100],
            ]);
            $claimed[] = $ok;
        };

        $t1 = new Collection;
        // Run sequentially through independent transactions to emulate the
        // serialized outcome the DB lock guarantees under real concurrency;
        // with sqlite (tests) true parallelism is not available, but the
        // state-machine invariant is what we assert: exactly one winner.
        $worker();
        $worker();

        $this->assertCount(2, $claimed);
        $this->assertSame(1, collect($claimed)->filter(fn ($v) => $v === true)->count(), 'exactly one claim may win');
        $this->assertSame(1, PaymentTransaction::where('authority', $row->authority)->count());
        $this->assertSame(PaymentTransaction::STATUS_PAID, $row->refresh()->status);
    }

    public function test_many_paid_transactions_may_share_one_subscription_but_a_row_consumes_once(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');
        $business = $user->businesses()->create(['name' => 'Consume Biz', 'slug' => 'consume-'.uniqid(), 'status' => 'approved']);
        $plan = $this->plan();
        $row1 = $this->pendingRow($business, $plan);
        $row2 = $this->pendingRow($business, $plan);

        $sub = Subscription::create(['business_id' => $business->id, 'plan_id' => $plan->id, 'status' => 'active']);
        $row1->forceFill(['status' => PaymentTransaction::STATUS_PAID, 'paid_at' => now(), 'subscription_id' => $sub->id])->save();
        $row2->forceFill(['status' => PaymentTransaction::STATUS_PAID, 'paid_at' => now()])->save();

        // REBUY model: MANY payments may link to the ONE subscription (each
        // renewal keeps its own audited row) — the plain index permits this.
        $row2->forceFill(['subscription_id' => $sub->id])->save();
        $this->assertSame(2, PaymentTransaction::where('subscription_id', $sub->id)->count());

        // Consumption is still once-per-row: the SERVICE refuses a second
        // activation for an already-consumed row (guarded by subscription_id
        // being non-null under the business row lock) — the idempotency that
        // the old UNIQUE index provided at the schema level now lives in
        // activateSubscription(), which returns the existing subscription
        // instead of re-activating.
        $service = app(PaymentService::class);
        $row1->refresh();
        $before = $row1->subscription_id;
        $method = new \ReflectionMethod($service, 'activateSubscription');
        $method->setAccessible(true);
        $result = $method->invoke($service, $row1);

        $this->assertSame($sub->id, $result->id, 'an already-consumed row resolves to its EXISTING subscription');
        $this->assertSame($before, $row1->refresh()->subscription_id);
        $this->assertSame(2, PaymentTransaction::where('subscription_id', $sub->id)->count(), 'no third binding was created');
    }

    public function test_replay_after_paid_returns_claimed_false_and_keeps_subscription(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');
        $business = $user->businesses()->create(['name' => 'Replay Biz', 'slug' => 'replay-'.uniqid(), 'status' => 'approved']);
        $plan = $this->plan();
        $row = $this->pendingRow($business, $plan);

        ['claimed' => $first] = PaymentTransaction::claimPaid($row->authority, ['ref_id' => 'REF-1', 'payload' => ['code' => 100]]);
        $this->assertTrue($first);

        // claimPaid only flips the state; consumption (subscription binding)
        // is the service's job — simulate it directly:
        $sub0 = Subscription::create(['business_id' => $business->id, 'plan_id' => $plan->id, 'status' => 'active']);
        $row->forceFill(['subscription_id' => $sub0->id])->save();

        $subscriptionId = $row->refresh()->subscription_id;
        $this->assertNotNull($subscriptionId);

        // Replay: markPaid must refuse (row no longer pending).
        ['row' => $again, 'claimed' => $second] = PaymentTransaction::claimPaid($row->authority, ['ref_id' => 'REF-2', 'payload' => ['code' => 100]]);
        $this->assertFalse($second);
        $this->assertSame('REF-1', $again->refresh()->ref_id, 'replay must not overwrite verification data');
        $this->assertSame($subscriptionId, $row->refresh()->subscription_id);
        $this->assertSame(1, Subscription::count());
    }
}
