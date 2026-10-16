<?php

namespace Tests\Feature;

use App\Models\DesignerBankAccount;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Services\Auth\OtpService;
use App\Services\Wallet\WalletLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * MANUAL SETTLEMENT contract for designer payouts.
 *
 * No gateway, no bank API: the designer requests, the admin pays outside the
 * system and records the tracking number. These tests lock the money rules —
 * hold/release arithmetic, one open request, the sheba-change cooldown, the
 * mandatory reject reason and payment reference, and the terminal states.
 */
class WithdrawalFlowTest extends TestCase
{
    use RefreshDatabase;

    private const SHEBA = 'IR820540102680020817909002';
    private const OTHER_SHEBA = 'IR060170000000000000000000'; // shape-valid, different account
    private const CODE = '54321';

    private function designer(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');

        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('admin');

        return $user;
    }

    /** Seed a confirmed commission so the designer has withdrawable money. */
    private function credit(User $user, int $amountRial): void
    {
        app(WalletLedger::class)->accrue($user->id, 'seed:'.Str::uuid()->toString(), $amountRial, [
            'description' => 'seed commission',
        ]);
    }

    private function registerBankAccount(User $user, string $sheba = self::SHEBA, string $code = self::CODE): void
    {
        app(OtpService::class)->storeCodeFor('bank_account', (string) $user->id, self::CODE);

        $this->actingAs($user)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => $sheba,
            'owner_name' => 'طاهر گلستانی',
            'code' => $code,
        ])->assertOk();
    }

    private function request(User $user, int $amount): WithdrawalRequest
    {
        $response = $this->actingAs($user)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => $amount])
            ->assertCreated();

        return WithdrawalRequest::findOrFail($response->json('id'));
    }

    /** balance must always equal the sum of the ledger amounts. */
    private function assertLedgerInvariant(User $user): void
    {
        $wallet = Wallet::forUser($user->id);
        $sum = (int) WalletTransaction::query()->where('wallet_id', $wallet->id)->sum('amount');

        $this->assertSame($sum, (int) $wallet->balance, 'wallet balance must equal the ledger sum');
    }

    public function test_the_bank_account_requires_a_purpose_scoped_otp(): void
    {
        $designer = $this->designer();

        // No code at all.
        $this->actingAs($designer)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => self::SHEBA, 'owner_name' => 'طاهر گلستانی', 'code' => '00000',
        ])->assertStatus(422);

        // A LOGIN otp for the same phone must NOT authorise a sheba change.
        app(OtpService::class)->store((string) $designer->phone, self::CODE);
        $this->actingAs($designer)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => self::SHEBA, 'owner_name' => 'طاهر گلستانی', 'code' => self::CODE,
        ])->assertStatus(422);
        $this->assertNull(DesignerBankAccount::query()->where('user_id', $designer->id)->first());

        // An invalid sheba (bad MOD-97 check digits) is refused even with a valid code.
        app(OtpService::class)->storeCodeFor('bank_account', (string) $designer->id, self::CODE);
        $this->actingAs($designer)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => 'IR830540102680020817909002', 'owner_name' => 'طاهر گلستانی', 'code' => self::CODE,
        ])->assertStatus(422);

        // The right code + a real sheba registers it, normalized.
        $this->registerBankAccount($designer, 'ir82-0540-1026-8002-0817-9090-02');
        $this->assertSame(self::SHEBA, DesignerBankAccount::query()->where('user_id', $designer->id)->value('sheba'));
        // First registration does not start the payout cooldown.
        $this->assertNull(DesignerBankAccount::query()->where('user_id', $designer->id)->value('bank_changed_at'));
    }

    public function test_a_request_needs_a_registered_account_and_respects_minimum_and_balance(): void
    {
        $designer = $this->designer();
        $this->credit($designer, 5_000_000);

        // No registered sheba yet.
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 2_000_000])
            ->assertStatus(422);

        $this->registerBankAccount($designer);

        // Below the configured minimum (1,000,000 ریال).
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 999_999])
            ->assertStatus(422);

        // Above the withdrawable balance.
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 5_000_001])
            ->assertStatus(422);

        $this->assertCount(0, WithdrawalRequest::all());
        $this->assertSame(5_000_000, Wallet::forUser($designer->id)->balance);
    }

    public function test_submitting_holds_the_money_and_only_one_request_may_be_open(): void
    {
        $designer = $this->designer();
        $this->credit($designer, 5_000_000);
        $this->registerBankAccount($designer);

        $withdrawal = $this->request($designer, 2_000_000);

        $wallet = Wallet::forUser($designer->id);
        $this->assertSame(3_000_000, (int) $wallet->balance);
        $this->assertSame(2_000_000, (int) $wallet->pending_balance);
        // Money already held → nothing left to request.
        $this->assertSame(1_000_000, $wallet->withdrawable());
        $this->assertSame(self::SHEBA, (string) $withdrawal->sheba, 'the request snapshots the OWN sheba');

        $hold = WalletTransaction::query()->where('idempotency_key', "withdrawal:{$withdrawal->id}:hold")->firstOrFail();
        $this->assertSame(-2_000_000, (int) $hold->amount);
        $this->assertSame(WithdrawalRequest::STATUS_PENDING, $withdrawal->status);
        $this->assertLedgerInvariant($designer);

        // A second open request is refused: the same money cannot be held twice.
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertStatus(422);

        $this->assertCount(1, WithdrawalRequest::all());
        $this->assertSame(2_000_000, (int) Wallet::forUser($designer->id)->pending_balance);
    }

    public function test_a_pending_request_can_be_cancelled_and_releases_the_money(): void
    {
        $designer = $this->designer();
        $this->credit($designer, 3_000_000);
        $this->registerBankAccount($designer);
        $withdrawal = $this->request($designer, 3_000_000);
        $this->assertSame(0, Wallet::forUser($designer->id)->withdrawable());

        $this->actingAs($designer)
            ->deleteJson("/api/designer/wallet/withdrawals/{$withdrawal->id}")
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_CANCELLED);

        $wallet = Wallet::forUser($designer->id);
        $this->assertSame(3_000_000, (int) $wallet->balance);
        $this->assertSame(0, (int) $wallet->pending_balance);
        $this->assertLedgerInvariant($designer);

        // Cancelling twice cannot release the money a second time.
        $this->actingAs($designer)
            ->deleteJson("/api/designer/wallet/withdrawals/{$withdrawal->id}")
            ->assertStatus(422);
        $this->assertSame(3_000_000, (int) Wallet::forUser($designer->id)->balance);
        $this->assertLedgerInvariant($designer);
    }

    public function test_the_admin_flow_approve_then_pay_requires_a_tracking_reference(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, 4_000_000);
        $this->registerBankAccount($designer);
        $withdrawal = $this->request($designer, 4_000_000);

        // The queue shows the payout target in full (the admin types it into the bank).
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?status=pending')
            ->assertOk()
            ->assertJsonPath('data.0.sheba', self::SHEBA)
            ->assertJsonPath('data.0.amount', 4_000_000)
            ->assertJsonPath('data.0.wallet.pending_balance', 4_000_000);

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'approve', 'admin_note' => 'تأیید شد'])
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_APPROVED);

        // Paying without the manual tracking number is refused.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'pay'])
            ->assertStatus(422);
        $this->assertSame(WithdrawalRequest::STATUS_APPROVED, $withdrawal->fresh()->status);

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'pay', 'payment_reference' => '987654321'])
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_PAID);

        $wallet = Wallet::forUser($designer->id);
        $this->assertSame(0, (int) $wallet->balance);
        $this->assertSame(0, (int) $wallet->pending_balance);
        $this->assertLedgerInvariant($designer);

        $paidRow = WalletTransaction::query()->where('idempotency_key', "withdrawal:{$withdrawal->id}:paid")->firstOrFail();
        // The money left `balance` at hold time; this row is the audit stamp.
        $this->assertSame(0, (int) $paidRow->amount);
        $this->assertSame(WithdrawalRequest::STATUS_PAID, $withdrawal->fresh()->status);
        $this->assertSame('987654321', $withdrawal->fresh()->payment_reference);

        // Terminal: no second payment, no status rewrite.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'pay', 'payment_reference' => '111'])
            ->assertStatus(422);
        $this->assertSame('987654321', $withdrawal->fresh()->payment_reference);
    }

    public function test_rejecting_requires_a_reason_and_returns_the_money(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, 2_500_000);
        $this->registerBankAccount($designer);
        $withdrawal = $this->request($designer, 2_500_000);

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'reject'])
            ->assertStatus(422);

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'reject', 'admin_note' => 'شبا با نام صاحب حساب هم‌خوان نیست'])
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_REJECTED);

        $wallet = Wallet::forUser($designer->id);
        $this->assertSame(2_500_000, (int) $wallet->balance);
        $this->assertSame(0, (int) $wallet->pending_balance);
        $this->assertLedgerInvariant($designer);

        // Rejected is final: it cannot be approved or paid afterwards.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'approve'])
            ->assertStatus(422);
        $this->assertSame(WithdrawalRequest::STATUS_REJECTED, $withdrawal->fresh()->status);
    }

    public function test_changing_the_sheba_freezes_withdrawals_for_the_configured_cooldown(): void
    {
        config(['wallet.withdrawals.bank_change_cooldown_hours' => 24]);

        $designer = $this->designer();
        $this->credit($designer, 3_000_000);
        $this->registerBankAccount($designer);

        // Changing the account starts the cooldown...
        $this->registerBankAccount($designer, self::OTHER_SHEBA);
        $this->assertNotNull(DesignerBankAccount::query()->where('user_id', $designer->id)->value('bank_changed_at'));

        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertStatus(422);
        $this->assertSame(0, WithdrawalRequest::query()->count());

        // ...and the wallet payload tells the UI when withdrawals unlock again.
        $this->actingAs($designer)->getJson('/api/designer/wallet')
            ->assertOk()
            ->assertJsonPath('bank_account.sheba', self::OTHER_SHEBA)
            ->assertJsonPath('bank_account.sheba_masked', 'IR06******************0000')
            ->assertJsonStructure(['bank_account' => ['withdrawable_from']]);

        // After the cooldown the designer may withdraw again.
        $this->travel(25)->hours();
        $this->request($designer, 1_000_000);
        $this->assertCount(1, WithdrawalRequest::all());
    }

    public function test_an_admin_can_only_move_a_balance_through_an_adjustment_with_a_reason(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => 500_000])
            ->assertStatus(422);

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => 0, 'reason' => 'اشتباه'])
            ->assertStatus(422);

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => 500_000, 'reason' => 'جبران پورسانت جاافتاده'])
            ->assertCreated()
            ->assertJsonPath('wallet.balance', 500_000);

        $this->assertLedgerInvariant($designer);

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => -800_000, 'reason' => 'برگشت اشتباه قبلی'])
            ->assertCreated()
            ->assertJsonPath('wallet.balance', -300_000);

        $this->assertLedgerInvariant($designer);
        $this->assertSame(-300_000, Wallet::forUser($designer->id)->balance);
    }

    public function test_the_payout_endpoint_is_rate_limited_per_user(): void
    {
        config(['wallet.rate_limits.withdrawal_request' => 3]);

        $designer = $this->designer();
        $this->credit($designer, 5_000_000);
        $this->registerBankAccount($designer);

        // Three rejected attempts still consume the bucket...
        for ($i = 0; $i < 3; $i++) {
            $this->actingAs($designer)
                ->postJson('/api/designer/wallet/withdrawals', ['amount' => 10])
                ->assertStatus(422);
        }

        // ...and the fourth request never reaches the money rules.
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertStatus(429);
    }
}
