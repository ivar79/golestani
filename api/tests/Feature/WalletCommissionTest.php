<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Designer;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\Payments\PaymentService;
use App\Services\Wallet\CommissionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * DESIGNER COMMISSION contract.
 *
 * A commission is accrued ONLY at a payment confirmation (online: the gateway
 * transaction is claimed `paid`; manual: an admin sets the subscription
 * `active`) and only for an attributed, non-self-referral business. It is
 * keyed on the purchase event, so no replay, renewal or re-run can pay twice —
 * while a renewal (which extends the SAME subscription row) still earns its
 * own commission.
 */
class WalletCommissionTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('admin');

        return $user;
    }

    private function designerUser(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');

        return $user;
    }

    private function designer(?User $user = null): Designer
    {
        $user ??= $this->designerUser();

        return Designer::create([
            'user_id' => $user->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-'.uniqid(),
            'status' => 'approved',
        ]);
    }

    private function business(User $owner, ?Designer $designer = null, string $slug = 'biz'): Business
    {
        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار '.$slug,
            'slug' => $slug.'-'.uniqid(),
            'status' => 'approved',
        ]);

        if ($designer !== null) {
            $business->update(['designer_id' => $designer->id]);
        }

        return $business->refresh();
    }

    private function plan(int $price = 100_000, int $percent = 20, string $features = 'basic', int $tier = 1): Plan
    {
        return Plan::create([
            'name' => 'پلن '.$features,
            'slug' => uniqid('plan-'),
            'price' => $price,
            'commission_percent' => $percent,
            'currency' => 'IRR',
            'duration_days' => 30,
            'tier' => $tier,
            'features' => ['showcase' => true, 'max_showcases' => 5],
            'is_active' => true,
            'is_public' => true,
        ]);
    }

    /** Full real-flow online purchase: init → gateway stub → callback → paid. */
    private function purchase(Business $business, Plan $plan): Subscription
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => fn () => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => fn () => Http::response([
                'data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999), 'card_pan' => '6219-86** ****-4586'],
                'errors' => [],
            ]),
        ]);

        $this->actingAs($business->owner);
        $res = $this->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])->assertCreated();
        $this->getJson("/api/payments/callback?Authority={$res->json('authority')}&Status=OK")->assertOk();

        return Subscription::findOrFail(
            PaymentTransaction::query()->where('authority', $res->json('authority'))->firstOrFail()->subscription_id,
        );
    }

    private function ledgerRows(User $designer): array
    {
        $wallet = Wallet::forUser($designer->id);

        return WalletTransaction::query()->where('wallet_id', $wallet->id)->orderBy('id')->get()->all();
    }

    /** Create a pending manual subscription (the receipt flow). */
    private function manualSubscription(Business $business, Plan $plan): Subscription
    {
        return $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'pending_receipt',
            'receipt_reference' => 'REF-'.uniqid(),
            'plan_name' => $plan->name,
            'price_amount' => $plan->price,
            'price_currency' => 'IRR',
            'duration_days' => $plan->duration_days,
        ]);
    }

    public function test_manual_approval_accrues_exactly_once_in_rial(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 100_000, percent: 20);
        $subscription = $this->manualSubscription($business, $plan);

        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $rows = $this->ledgerRows($designer->user);
        $this->assertCount(1, $rows);
        // 100,000 تومان → 1,000,000 ریال × ۲۰٪ = 200,000 ریال
        $this->assertSame(200_000, (int) $rows[0]->amount);
        $this->assertSame(WalletTransaction::TYPE_COMMISSION_ACCRUED, $rows[0]->type);
        $this->assertSame('commission:order:'.$subscription->id, $rows[0]->idempotency_key);
        $this->assertSame(200_000, Wallet::forUser($designer->user->id)->balance);

        // Re-approving the same subscription (admin re-saves `active`) must not pay again.
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $this->assertCount(1, $this->ledgerRows($designer->user));
    }

    public function test_a_self_referral_pays_nothing(): void
    {
        $admin = $this->admin();
        $owner = $this->owner();
        // The referring designer IS the business owner: no commission, ever.
        $ownDesigner = $this->designer($owner);
        $business = $this->business($owner, $ownDesigner);
        $subscription = $this->manualSubscription($business, $this->plan(percent: 25));

        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $quote = app(CommissionService::class)->quote($subscription->fresh(), null);
        $this->assertFalse($quote['eligible']);
        $this->assertSame(CommissionService::REASON_SELF_REFERRAL, $quote['reason']);
        $this->assertCount(0, $this->ledgerRows($owner));
        $this->assertSame(0, Wallet::forUser($owner->id)->balance);
    }

    public function test_unattributed_or_zero_percent_purchases_pay_nothing(): void
    {
        $admin = $this->admin();

        // (a) no designer attributed
        $business = $this->business($this->owner());
        $subscription = $this->manualSubscription($business, $this->plan(percent: 30));
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();
        $this->assertSame(CommissionService::REASON_NO_DESIGNER, app(CommissionService::class)->quote($subscription->fresh(), null)['reason']);

        // (b) attributed, but the plan pays 0% (the shipped default) → dormant
        $designer = $this->designer();
        $second = $this->business($this->owner(), $designer, 'biz-two');
        $zeroPlan = $this->plan(percent: 0);
        $secondSub = $this->manualSubscription($second, $zeroPlan);
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$secondSub->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $this->assertSame(CommissionService::REASON_NO_PERCENT, app(CommissionService::class)->quote($secondSub->fresh(), null)['reason']);
        $this->assertCount(0, $this->ledgerRows($designer->user));
    }

    public function test_online_payment_accrues_at_confirmation_and_survives_a_replayed_callback(): void
    {
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 249_000, percent: 10);

        $subscription = $this->purchase($business, $plan);

        $rows = $this->ledgerRows($designer->user);
        $this->assertCount(1, $rows);
        // 249,000 تومان → 2,490,000 ریال × ۱۰٪ = 249,000 ریال
        $this->assertSame(249_000, (int) $rows[0]->amount);
        $payment = PaymentTransaction::query()->where('subscription_id', $subscription->id)->firstOrFail();
        $this->assertSame('commission:payment:'.$payment->id, $rows[0]->idempotency_key);
        $this->assertSame($payment->id, (int) $rows[0]->payment_transaction_id);

        // Replay the very same callback: the row is already paid, so the
        // accrual is a no-op (and the subscription must not change either).
        $this->getJson("/api/payments/callback?Authority={$payment->authority}&Status=OK")->assertOk();
        $this->assertCount(1, $this->ledgerRows($designer->user));
    }

    public function test_a_renewal_earns_its_own_commission_while_on_renewal_is_on(): void
    {
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 100_000, percent: 10);

        $first = $this->purchase($business, $plan);
        $second = $this->purchase($business, $plan);

        // A renewal extends the SAME subscription row — keying on the
        // subscription would have silently skipped this second purchase.
        $this->assertSame($first->id, $second->id);
        $rows = $this->ledgerRows($designer->user);
        $this->assertCount(2, $rows);
        $this->assertNotSame($rows[0]->idempotency_key, $rows[1]->idempotency_key);
        $this->assertSame(200_000, Wallet::forUser($designer->user->id)->balance);
    }

    public function test_the_on_renewal_flag_can_restrict_commissions_to_the_first_purchase(): void
    {
        config(['wallet.commission.on_renewal' => false]);

        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 100_000, percent: 10);

        $this->purchase($business, $plan);
        $this->purchase($business, $plan);

        $this->assertCount(1, $this->ledgerRows($designer->user));
        $subscription = $business->subscriptions()->firstOrFail();
        $this->assertSame(
            CommissionService::REASON_FIRST_PURCHASE_ONLY,
            app(CommissionService::class)->quote($subscription, $business->paymentTransactions()->latest('id')->first())['reason'],
        );
    }

    public function test_the_percentage_rounds_half_up_by_default_and_can_floor(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        // 100,005 تومان = 1,000,050 ریال × ۷٪ = 70,003.5 ریال
        $plan = $this->plan(price: 100_005, percent: 7);

        $subscription = $this->manualSubscription($business, $plan);
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        // Default (round_half_up): the designer's exact share rounds up.
        $this->assertSame(70_004, (int) $this->ledgerRows($designer->user)[0]->amount);

        // Business preference: never round up.
        config(['wallet.commission.rounding' => 'floor']);
        $secondPlan = $this->plan(price: 100_005, percent: 7, features: 'floor');
        $secondSub = $this->manualSubscription($business, $secondPlan);
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$secondSub->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $rows = $this->ledgerRows($designer->user);
        $this->assertSame(70_003, (int) $rows[1]->amount);
    }

    public function test_rejecting_a_subscription_reverses_its_commission_and_may_create_debt(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $subscription = $this->manualSubscription($business, $this->plan(price: 100_000, percent: 30));

        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();
        $this->assertSame(300_000, Wallet::forUser($designer->user->id)->balance);

        // The designer already withdrew the money: the reversal must still be
        // recorded, leaving a visible negative balance.
        Wallet::forUser($designer->user->id)->forceFill(['balance' => 0])->save();

        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'rejected', 'admin_note' => 'رسید نامعتبر'])
            ->assertOk();

        $rows = $this->ledgerRows($designer->user);
        $this->assertCount(2, $rows);
        $this->assertSame(WalletTransaction::TYPE_COMMISSION_REVERSED, $rows[1]->type);
        $this->assertSame(-300_000, (int) $rows[1]->amount);
        $this->assertSame(-300_000, Wallet::forUser($designer->user->id)->balance);

        // A second rejection cannot reverse the same accrual twice.
        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'rejected'])
            ->assertOk();
        $this->assertCount(2, $this->ledgerRows($designer->user));
    }

    public function test_natural_expiry_and_lazy_scheduled_promotion_never_accrue(): void
    {
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 100_000, percent: 10, tier: 2);

        // Two payments: the second is a downgrade → its row becomes `scheduled`.
        $cheap = $this->plan(price: 50_000, percent: 10, features: 'cheap', tier: 1);
        $subscription = $this->purchase($business, $plan);
        $scheduled = $this->purchase($business, $cheap);
        $this->assertSame('scheduled', $scheduled->status);

        $before = count($this->ledgerRows($designer->user));

        // Promoting the scheduled row is a LIFECYCLE event, not a payment —
        // the purchase was already paid for at confirmation time.
        app(PaymentService::class)->promoteDueScheduled(
            $business->fresh(),
            $subscription->expires_at->copy()->addMinute(),
        );
        $this->assertSame($before, count($this->ledgerRows($designer->user)));

        // And a natural expiry reverses nothing either.
        $this->actingAs($this->admin())
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'expired'])
            ->assertOk();
        $this->assertSame($before, count($this->ledgerRows($designer->user)));
        $this->assertGreaterThan(0, Wallet::forUser($designer->user->id)->balance);
    }

    public function test_a_failing_commission_never_breaks_the_activation(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $subscription = $this->manualSubscription($business, $this->plan(percent: 20));

        // REAL failure injection: the ledger table is unreachable, so the
        // accrual blows up mid-flight exactly like a broken migration or a
        // dropped connection would.
        Schema::rename('wallet_transactions', 'wallet_transactions_broken');

        $this->actingAs($admin)
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk()
            ->assertJsonPath('status', 'active');

        Schema::rename('wallet_transactions_broken', 'wallet_transactions');

        $this->assertSame('active', $subscription->fresh()->status);
        $this->assertNotNull($subscription->fresh()->started_at, 'the activation must stand on its own');
        $this->assertCount(0, $this->ledgerRows($designer->user));

        // ...and the repair path rebuilds it, proving the failure is recoverable.
        $this->artisan('commissions:backfill')->assertExitCode(0);
        $this->assertCount(1, $this->ledgerRows($designer->user));
        $this->assertSame(200_000, Wallet::forUser($designer->user->id)->balance);
    }

    public function test_re_saving_an_online_subscription_as_active_never_double_pays(): void
    {
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $subscription = $this->purchase($business, $this->plan(price: 100_000, percent: 10));
        $this->assertCount(1, $this->ledgerRows($designer->user));

        // The admin re-confirms an ONLINE subscription: its money event is the
        // gateway transaction, already accrued — the order key must not add a
        // second commission for the same purchase.
        $this->actingAs($this->admin())
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $this->assertCount(1, $this->ledgerRows($designer->user));
    }

    public function test_the_backfill_command_rebuilds_a_missing_commission_and_is_idempotent(): void
    {
        $designer = $this->designer();
        $business = $this->business($this->owner(), $designer);
        $plan = $this->plan(price: 200_000, percent: 15);

        $subscription = $this->purchase($business, $plan);
        $this->assertCount(1, $this->ledgerRows($designer->user));

        // Simulate a failed accrual: the purchase is confirmed but no ledger
        // row exists (exactly what accrueQuietly() leaves behind on error).
        $wallet = Wallet::forUser($designer->user->id);
        WalletTransaction::query()->where('wallet_id', $wallet->id)->delete();
        $wallet->forceFill(['balance' => 0, 'pending_balance' => 0])->save();

        $this->artisan('commissions:backfill')->assertExitCode(0);
        $this->assertCount(1, $this->ledgerRows($designer->user));
        $this->assertSame(300_000, Wallet::forUser($designer->user->id)->balance); // 2,000,000 × ۱۵٪

        // Running it again must not pay twice.
        $this->artisan('commissions:backfill')->assertExitCode(0);
        $this->assertCount(1, $this->ledgerRows($designer->user));
        $this->assertSame(300_000, Wallet::forUser($designer->user->id)->balance);

        $this->artisan('commissions:backfill', ['--dry-run' => true])->assertExitCode(0);
        $this->assertCount(1, $this->ledgerRows($designer->user));
    }
}
