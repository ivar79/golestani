<?php

namespace Tests\Feature;

use App\Models\DesignerBankAccount;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Support\Sheba;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

/**
 * PHASE 1 (wallet & designer commission) — schema + model invariants.
 *
 * These lock the structural promises the whole money system rests on:
 *   - the tables/columns exist on every driver (the suite runs on sqlite, the
 *     product on Postgres — both must accept the same schema);
 *   - `plans.commission_percent` defaults to 0, so shipping this migration
 *     changes no existing payout behaviour;
 *   - the ledger is APPEND-ONLY (update/delete throw) and exactly-once
 *     (`idempotency_key` unique);
 *   - balances are SIGNED (a reversal may push a designer into visible debt);
 *   - a withdrawal request freezes its identity and is immutable once
 *     terminal (paid/rejected/cancelled).
 *
 * Money-logic tests (accrual math, hold/release, concurrency) belong to the
 * phase-4 suite; this file only proves the foundation.
 */
class WalletSchemaTest extends TestCase
{
    use RefreshDatabase;

    /** A real Iranian sheba (its MOD-97 check digits verify). */
    private const VALID_SHEBA = 'IR820540102680020817909002';

    private function designer(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');

        return $user;
    }

    public function test_the_wallet_tables_exist_and_commission_defaults_to_zero(): void
    {
        foreach (['wallets', 'wallet_transactions', 'withdrawal_requests', 'designer_bank_accounts'] as $table) {
            $this->assertTrue(Schema::hasTable($table), "table {$table} is missing");
        }

        $this->assertTrue(Schema::hasColumn('plans', 'commission_percent'));

        $plan = Plan::create(['name' => 'دوره تست', 'price' => 99000, 'duration_days' => 30]);

        // Dormant by default: no plan pays commission until an admin sets one.
        $this->assertSame(0, $plan->fresh()->commission_percent);
        $this->assertSame(0, (int) Plan::query()->find($plan->id)->commission_percent);
    }

    public function test_sheba_normalization_validation_and_masking(): void
    {
        $this->assertTrue(Sheba::isValid(self::VALID_SHEBA));
        $this->assertTrue(Sheba::isValid('IR82 0540 1026 8002 0817 9090 02'), 'spaces must be tolerated');
        $this->assertTrue(Sheba::isValid('IR۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲'), 'persian digits must be accepted');

        // One digit changed in the check pair → the MOD-97 check must fail.
        $this->assertFalse(Sheba::isValid('IR830540102680020817909002'));
        $this->assertFalse(Sheba::isValid('IR82054010268002081790900'), 'short input is not a sheba');
        $this->assertFalse(Sheba::isValid('IR82054010268002081790900A'), 'letters outside IR are invalid');
        $this->assertFalse(Sheba::isValid(null));

        $this->assertSame(self::VALID_SHEBA, Sheba::normalize('ir82-0540-1026-8002-0817-9090-02'));
        $this->assertSame('IR82******************9002', Sheba::mask(self::VALID_SHEBA));
    }

    public function test_the_bank_account_is_normalized_on_write(): void
    {
        $account = DesignerBankAccount::create([
            'user_id' => $this->designer()->id,
            'sheba' => 'ir82-0540-1026-8002-0817-9090-02',
            'owner_name' => 'طاهر گلستانی',
        ]);

        $this->assertSame(self::VALID_SHEBA, $account->fresh()->sheba);
    }

    public function test_the_wallet_holds_signed_balances_and_a_derived_withdrawable_amount(): void
    {
        $user = $this->designer();
        $wallet = Wallet::forUser($user->id);
        $this->assertSame(0, $wallet->balance);

        // forUser is idempotent — never a second wallet per user.
        $this->assertTrue($wallet->is(Wallet::forUser($user->id)));

        $wallet->forceFill(['balance' => 5_000_000, 'pending_balance' => 2_000_000])->save();
        $this->assertSame(3_000_000, $wallet->fresh()->withdrawable());

        // A reversal may legitimately create designer debt: signed, not clamped.
        $wallet->forceFill(['balance' => -1_500_000, 'pending_balance' => 0])->save();
        $this->assertSame(-1_500_000, $wallet->fresh()->withdrawable());
    }

    public function test_the_ledger_is_append_only(): void
    {
        $wallet = Wallet::forUser($this->designer()->id);

        $row = (new WalletTransaction)->forceFill([
            'wallet_id' => $wallet->id,
            'type' => WalletTransaction::TYPE_COMMISSION_ACCRUED,
            'amount' => 1_000_000,
            'balance_after' => 1_000_000,
            'idempotency_key' => WalletTransaction::commissionKeyForOrder(7),
            'description' => 'پورسانت تست',
        ]);
        $row->save();

        $this->assertNotEmpty($row->fresh()->created_at, 'ledger rows must carry a written-once timestamp');

        try {
            $row->fresh()->forceFill(['amount' => 2_000_000])->save();
            $this->fail('updating a ledger row must be refused');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('فقط-ثبت', $e->getMessage());
        }

        try {
            $row->fresh()->delete();
            $this->fail('deleting a ledger row must be refused');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('فقط-ثبت', $e->getMessage());
        }

        $this->assertSame(1_000_000, (int) WalletTransaction::query()->find($row->id)->amount);
    }

    public function test_commission_keys_are_deterministic_and_unique_per_purchase_event(): void
    {
        $this->assertSame('commission:payment:42', WalletTransaction::commissionKeyForPayment(42));
        $this->assertSame('commission:order:42', WalletTransaction::commissionKeyForOrder(42));
        $this->assertSame('reverse:commission:order:42', WalletTransaction::reversalKeyFor('commission:order:42'));

        $wallet = Wallet::forUser($this->designer()->id);
        $attributes = [
            'wallet_id' => $wallet->id,
            'type' => WalletTransaction::TYPE_COMMISSION_ACCRUED,
            'amount' => 500_000,
            'balance_after' => 500_000,
            'idempotency_key' => WalletTransaction::commissionKeyForPayment(42),
        ];

        (new WalletTransaction)->forceFill($attributes)->save();

        // The database — not application bookkeeping — is what makes accrual
        // exactly-once, so a race cannot slip a duplicate through.
        $this->expectException(QueryException::class);
        (new WalletTransaction)->forceFill($attributes)->save();
    }

    public function test_a_terminal_withdrawal_request_can_never_be_changed_again(): void
    {
        $user = $this->designer();
        $request = (new WithdrawalRequest)->forceFill([
            'user_id' => $user->id,
            'amount' => 1_500_000,
            'sheba' => self::VALID_SHEBA,
            'owner_name' => 'طاهر گلستانی',
            'status' => WithdrawalRequest::STATUS_PENDING,
            'requested_at' => now(),
        ]);
        $request->save();

        $this->assertTrue($request->isOpen());

        // Identity and money are frozen as soon as the request exists.
        try {
            $request->forceFill(['amount' => 900_000])->save();
            $this->fail('the amount of a submitted request must not change');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('amount', $e->getMessage());
        }

        $request->refresh()->forceFill(['status' => WithdrawalRequest::STATUS_PAID, 'paid_at' => now()])->save();
        $this->assertTrue($request->fresh()->isTerminal());
        $this->assertSame(self::VALID_SHEBA, $request->fresh()->sheba, 'the sheba snapshot stays as submitted');
        $this->assertSame('IR82******************9002', $request->fresh()->maskedSheba());

        try {
            $request->fresh()->forceFill(['status' => WithdrawalRequest::STATUS_PENDING])->save();
            $this->fail('a paid request must be irreversible');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('پایانی', $e->getMessage());
        }

        $this->assertSame(WithdrawalRequest::STATUS_PAID, $request->fresh()->status);
    }

    public function test_the_wallet_plumbing_does_not_touch_the_subscription_contract(): void
    {
        // Guard against accidental coupling: the wallet feature adds tables and
        // one plan column, and must not alter how subscriptions store money.
        $this->assertFalse(Schema::hasColumn('subscriptions', 'wallet_id'));

        $plan = Plan::create(['name' => 'پلن تست', 'price' => 120_000, 'duration_days' => 30, 'commission_percent' => 25]);
        $this->assertSame(25, $plan->fresh()->commission_percent);
        // The single ×10 money conversion stays where it always was.
        $this->assertSame(1_200_000, $plan->priceRial());
        $this->assertInstanceOf(Subscription::class, new Subscription);
    }
}
