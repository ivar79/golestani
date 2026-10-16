<?php

namespace Tests\Feature;

use App\Models\DesignerBankAccount;
use App\Models\InternalNotification;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Services\Auth\OtpService;
use App\Services\Wallet\WalletLedger;
use App\Services\Wallet\WalletSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * THE ADMIN MONEY PANEL contract.
 *
 * Locks what the admin surface of the manual-settlement system must do:
 *   - ROLE: only an active admin reaches it (a designer or a plain user gets
 *     403 on every endpoint, whatever the payload);
 *   - the queue: status/date/search filters, pagination, per-status summary;
 *   - one request in full: complete sheba, wallet (including DEBT), commissions
 *     and the ledger the decision is based on;
 *   - the state machine: approve (with the OPTIONAL expected payout date),
 *     reject (reason required), pay (tracking reference required), terminal
 *     states frozen, out-of-order transitions refused with 422;
 *   - the batch CSV (approved only, with sheba + holder + amount);
 *   - the ADMIN-OWNED settings that used to be config: min withdrawal, bank
 *     change cooldown, settlement text/days and the submissions master switch,
 *     each change audited in `audit_events`.
 */
class AdminWalletPanelTest extends TestCase
{
    use RefreshDatabase;

    private const SHEBA = 'IR820540102680020817909002';

    private const CODE = '54321';

    private function designer(string $phone = '09120000001'): User
    {
        $user = User::factory()->create(['phone' => $phone, 'name' => 'طراح تست']);
        $user->assignRole('designer');

        return $user;
    }

    private function admin(string $phone = '09120000009'): User
    {
        $user = User::factory()->create(['phone' => $phone, 'name' => 'مدیر تست']);
        $user->assignRole('admin');

        return $user;
    }

    private function credit(User $user, int $amountRial): void
    {
        app(WalletLedger::class)->accrue($user->id, 'seed:'.Str::uuid()->toString(), $amountRial, [
            'description' => 'seed commission',
        ]);
    }

    private function registerBankAccount(User $user): void
    {
        app(OtpService::class)->storeCodeFor('bank_account', (string) $user->id, self::CODE);

        $this->actingAs($user)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => self::SHEBA,
            'owner_name' => 'طاهر گلستانی',
            'code' => self::CODE,
        ])->assertOk();
    }

    private function request(User $user, int $amount): WithdrawalRequest
    {
        $response = $this->actingAs($user)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => $amount])
            ->assertCreated();

        return WithdrawalRequest::findOrFail($response->json('id'));
    }

    /** @return array{0:User,1:User,2:WithdrawalRequest} */
    private function paidDesignedRequest(int $amount = 3_000_000): array
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, $amount);
        $this->registerBankAccount($designer);

        return [$admin, $designer, $this->request($designer, $amount)];
    }

    /* ------------------------------------------------------------------
     | Role gate
     * ------------------------------------------------------------------ */

    public function test_every_admin_wallet_endpoint_refuses_a_non_admin(): void
    {
        $designer = $this->designer();
        $plain = User::factory()->create(['phone' => '09120000077']);
        $withdrawal = $this->requestFor($designer);

        $paths = [
            ['get', '/api/admin/withdrawals'],
            ['get', '/api/admin/withdrawals/summary'],
            ['get', '/api/admin/withdrawals/export'],
            ['get', "/api/admin/withdrawals/{$withdrawal->id}"],
            ['patch', "/api/admin/withdrawals/{$withdrawal->id}"],
            ['post', "/api/admin/wallets/{$designer->id}/adjust"],
            ['get', '/api/admin/wallet/settings'],
            ['put', '/api/admin/wallet/settings'],
            ['get', '/api/admin/wallet/designers'],
            ['get', "/api/admin/wallet/designers/{$designer->id}"],
        ];

        foreach ([$designer, $plain] as $actor) {
            foreach ($paths as [$method, $path]) {
                $this->actingAs($actor)
                    ->json(strtoupper($method), $path, [])
                    ->assertForbidden();
            }
        }

        // The DESIGNER keeps their own wallet door; only the admin panel is shut.
        $this->actingAs($designer)->getJson('/api/designer/wallet')->assertOk();
    }

    private function requestFor(User $designer): WithdrawalRequest
    {
        $this->credit($designer, 3_000_000);
        $this->registerBankAccount($designer);

        return $this->request($designer, 2_000_000);
    }

    /* ------------------------------------------------------------------
     | Queue: filters, search, pagination, summary
     * ------------------------------------------------------------------ */

    public function test_the_queue_filters_by_status_date_and_designer_search(): void
    {
        $admin = $this->admin();
        $ali = $this->designer('09121110001');
        $ali->forceFill(['name' => 'علی رضایی'])->save();
        $sara = $this->designer('09122220002');
        $sara->forceFill(['name' => 'سارا محمدی'])->save();

        $aliRequest = $this->requestFor($ali);
        $saraRequest = $this->requestFor($sara);
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$saraRequest->id}", ['action' => 'reject', 'admin_note' => 'دلیل تست'])
            ->assertOk();

        // Status filter.
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?status=pending')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $aliRequest->id);
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?status=rejected')
            ->assertOk()
            ->assertJsonPath('data.0.id', $saraRequest->id);

        // Search by designer NAME and by PHONE.
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?q='.urlencode('سارا'))
            ->assertOk()->assertJsonPath('data.0.id', $saraRequest->id);
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?q=09121110001')
            ->assertOk()->assertJsonPath('data.0.id', $aliRequest->id);
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?q='.urlencode('ناموجود'))
            ->assertOk()->assertJsonCount(0, 'data');

        // Date range: yesterday..tomorrow keeps both, a past window empties it.
        $from = now()->subDay()->toDateString();
        $to = now()->addDay()->toDateString();
        $this->actingAs($admin)->getJson("/api/admin/withdrawals?from={$from}&to={$to}")
            ->assertOk()->assertJsonCount(2, 'data');
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?from=2020-01-01&to=2020-01-02')
            ->assertOk()->assertJsonCount(0, 'data');

        // An unknown status is a validation error, never a silent full list.
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?status=nope')->assertStatus(422);

        // Pagination is present and bounded.
        $response = $this->actingAs($admin)->getJson('/api/admin/withdrawals?per_page=1')->assertOk();
        $this->assertSame(2, $response->json('total'));
        $this->assertSame(1, $response->json('per_page'));
        $this->actAsAdminWithTooLargePage($admin);
    }

    private function actAsAdminWithTooLargePage(User $admin): void
    {
        $this->actingAs($admin)->getJson('/api/admin/withdrawals?per_page=5000')->assertStatus(422);
    }

    public function test_the_queue_row_and_summary_carry_the_designer_money_state(): void
    {
        [$admin, $designer, $withdrawal] = $this->paidDesignedRequest(4_000_000);

        $this->actingAs($admin)->getJson('/api/admin/withdrawals?status=pending')
            ->assertOk()
            ->assertJsonPath('data.0.sheba', self::SHEBA)
            ->assertJsonPath('data.0.amount', 4_000_000)
            ->assertJsonPath('data.0.amount_toman', 400_000)
            ->assertJsonPath('data.0.status_label', 'در انتظار بررسی')
            ->assertJsonPath('data.0.wallet.pending_balance', 4_000_000)
            ->assertJsonPath('data.0.designer.phone', '09120000001');

        $this->actingAs($admin)->getJson('/api/admin/withdrawals/summary')
            ->assertOk()
            ->assertJsonPath('pending', 1)
            ->assertJsonPath('statuses.pending.amount', 4_000_000)
            ->assertJsonPath('approved', 0)
            ->assertJsonStructure(['statuses' => ['paid', 'rejected', 'cancelled'], 'settlement' => ['note', 'days']]);

        // Approval moves the money from "pending" to "approved" in the summary.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'approve'])
            ->assertOk();

        $this->actingAs($admin)->getJson('/api/admin/withdrawals/summary')
            ->assertOk()
            ->assertJsonPath('pending', 0)
            ->assertJsonPath('approved', 1)
            ->assertJsonPath('approved_amount', 4_000_000)
            ->assertJsonPath('awaiting_payment_amount', 4_000_000);
    }

    /* ------------------------------------------------------------------
     | Detail screen
     * ------------------------------------------------------------------ */

    public function test_the_detail_screen_exposes_sheba_wallet_commissions_and_ledger(): void
    {
        [$admin, $designer, $withdrawal] = $this->paidDesignedRequest(2_000_000);

        $this->actingAs($admin)->getJson("/api/admin/withdrawals/{$withdrawal->id}")
            ->assertOk()
            ->assertJsonPath('request.sheba', self::SHEBA)
            ->assertJsonPath('request.sheba_formatted', 'IR82 0540 1026 8002 0817 9090 02')
            ->assertJsonPath('request.owner_name', 'طاهر گلستانی')
            ->assertJsonPath('request.is_open', true)
            ->assertJsonPath('request.is_terminal', false)
            ->assertJsonPath('designer.bank_account.sheba', self::SHEBA)
            ->assertJsonPath('wallet.pending_balance', 2_000_000)
            ->assertJsonPath('wallet.in_debt', false)
            ->assertJsonPath('commissions.accrued_rial', 2_000_000)
            ->assertJsonPath('commissions.net_rial', 2_000_000)
            ->assertJsonPath('commissions.sales_count', 0)
            ->assertJsonStructure([
                'ledger' => [['id', 'type', 'type_label', 'amount', 'balance_after']],
                'other_requests',
                'settlement' => ['note', 'days', 'withdrawals_enabled'],
            ]);

        // The ledger is the hold row of this very request.
        $hold = collect($this->actingAs($admin)->getJson("/api/admin/withdrawals/{$withdrawal->id}")->json('ledger'))
            ->firstWhere('type', WalletTransaction::TYPE_WITHDRAWAL_HOLD);
        $this->assertSame(-2_000_000, $hold['amount']);
        $this->assertSame('نگه‌داشت مبلغ برداشت', $hold['type_label']);
    }

    public function test_a_designer_in_debt_is_reported_as_debt_and_never_as_zero(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();

        // 1,000,000 earned, then a 2,000,000 reversal (a rejected subscription
        // whose commission had already been paid out): the designer is in debt.
        $this->credit($designer, 1_000_000);
        app(WalletLedger::class)->reverse(
            $designer->id,
            'reverse:manual:'.Str::uuid()->toString(),
            -2_000_000,
            ['description' => 'برگشت پورسانت تست'],
        );

        $this->actingAs($admin)->getJson("/api/admin/wallet/designers/{$designer->id}")
            ->assertOk()
            ->assertJsonPath('wallet.balance', -1_000_000)
            ->assertJsonPath('wallet.in_debt', true)
            // A debt is NOT withdrawable, and it is not silently clamped either.
            ->assertJsonPath('wallet.withdrawable', -1_000_000)
            ->assertJsonPath('commissions.reversed_rial', 2_000_000)
            ->assertJsonPath('commissions.net_rial', -1_000_000);
    }

    /* ------------------------------------------------------------------
     | State machine + expected payout date
     * ------------------------------------------------------------------ */

    public function test_approval_records_the_expected_payout_date_and_the_default_window(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();

        // 1. Explicit date from the admin.
        $this->credit($designer, 5_000_000);
        $this->registerBankAccount($designer);
        $first = $this->request($designer, 2_000_000);
        $explicit = now()->addDays(3)->toDateString();

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$first->id}", ['action' => 'approve', 'expected_paid_at' => $explicit])
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_APPROVED)
            ->assertJsonPath('expected_paid_at_jalali', $first->fresh()->expectedPaidJalali());

        $this->assertTrue($first->fresh()->expected_paid_at->isSameDay($explicit));

        // The designer is told the date (page + notification).
        $this->actingAs($designer)->getJson('/api/designer/wallet')
            ->assertOk()
            ->assertJsonPath('open_request.expected_paid_at_jalali', $first->fresh()->expectedPaidJalali());

        $this->assertTrue(
            InternalNotification::query()
                ->where('user_id', $designer->id)
                ->where('title', 'درخواست برداشت تأیید شد')
                ->where('message', 'like', '%تاریخ پیش‌بینی‌شدهٔ واریز%')
                ->exists(),
            'the approval notification carries the expected payout date',
        );

        // A date in the past is refused — and it is refused BEFORE the request
        // is touched, so the row stays pending for the next decision.
        $late = $this->designer('09120000042');
        $this->credit($late, 2_000_000);
        $this->registerBankAccount($late);
        $second = $this->request($late, 1_000_000);
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$second->id}", ['action' => 'approve', 'expected_paid_at' => now()->subDay()->toDateString()])
            ->assertStatus(422);
        $this->assertSame(WithdrawalRequest::STATUS_PENDING, $second->fresh()->status);

        // 2. No date → the ADMIN-CONFIGURED settlement window is applied.
        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'تسویه هر هفته پنجشنبه‌ها',
            'settlement_days' => 3,
            'min_amount_toman' => 100_000,
            'bank_change_cooldown_hours' => 24,
            'withdrawals_enabled' => true,
        ]])->assertOk();

        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$second->id}", ['action' => 'approve'])
            ->assertOk();
        $this->assertTrue($second->fresh()->expected_paid_at->isSameDay(now()->addDays(3)));

        // The admin's settlement text reaches the designer's page verbatim (and
        // the designer's own open request carries the estimate).
        $this->actingAs($late)->getJson('/api/designer/wallet')
            ->assertOk()
            ->assertJsonPath('settlement.note', 'تسویه هر هفته پنجشنبه‌ها')
            ->assertJsonPath('settlement.days', 3)
            ->assertJsonPath('open_request.expected_paid_at_jalali', $second->fresh()->expectedPaidJalali());
    }

    public function test_the_status_machine_refuses_out_of_order_and_terminal_actions(): void
    {
        [$admin, $designer, $withdrawal] = $this->paidDesignedRequest(2_000_000);

        // Unknown action.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'delete'])
            ->assertStatus(422);

        // Reject without a reason.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'reject'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('admin_note');

        // Pay without the manual tracking reference.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'pay'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('payment_reference');

        // pending → paid directly is allowed (the bank transfer already happened).
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'pay', 'payment_reference' => 'REF-1'])
            ->assertOk()
            ->assertJsonPath('status', WithdrawalRequest::STATUS_PAID);

        // Terminal: every further action is a clear 422 with the live status.
        foreach ([['action' => 'approve'], ['action' => 'reject', 'admin_note' => 'دیر شد'], ['action' => 'pay', 'payment_reference' => 'REF-2']] as $payload) {
            $this->actingAs($admin)
                ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", $payload)
                ->assertStatus(422);
        }

        $fresh = $withdrawal->fresh();
        $this->assertSame(WithdrawalRequest::STATUS_PAID, $fresh->status);
        $this->assertSame('REF-1', $fresh->payment_reference);
        $this->assertSame(0, (int) Wallet::forUser($designer->id)->pending_balance);
        // No second payment row was written by the refused retries.
        $this->assertSame(1, WalletTransaction::query()->where('idempotency_key', "withdrawal:{$withdrawal->id}:paid")->count());
    }

    public function test_the_second_admin_on_a_changed_request_gets_a_clear_422_and_the_live_row(): void
    {
        [$admin, $designer, $withdrawal] = $this->paidDesignedRequest(2_000_000);
        $otherAdmin = $this->admin('09120000010');

        // Admin A approves; admin B (stale screen) tries to approve again.
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'approve'])
            ->assertOk();

        $this->actingAs($otherAdmin)
            ->patchJson("/api/admin/withdrawals/{$withdrawal->id}", ['action' => 'approve'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'این درخواست در وضعیت «در انتظار بررسی» نیست.');

        // Re-reading the detail gives B the winning state to re-render from.
        $this->actingAs($otherAdmin)->getJson("/api/admin/withdrawals/{$withdrawal->id}")
            ->assertOk()
            ->assertJsonPath('request.status', WithdrawalRequest::STATUS_APPROVED)
            ->assertJsonPath('request.admin.id', $admin->id);
    }

    /* ------------------------------------------------------------------
     | Batch CSV
     * ------------------------------------------------------------------ */

    public function test_the_csv_export_lists_the_approved_queue_for_batch_payment(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, 6_000_000);
        $this->registerBankAccount($designer);

        $approved = $this->request($designer, 2_000_000);
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$approved->id}", ['action' => 'approve'])
            ->assertOk();

        $content = $this->actingAs($admin)
            ->get('/api/admin/withdrawals/export')
            ->assertOk()
            ->assertHeader('content-type', 'text/csv; charset=UTF-8')
            ->streamedContent();

        $this->assertStringContainsString('شماره شبا', $content);
        $this->assertStringContainsString(self::SHEBA, $content);
        $this->assertStringContainsString('طاهر گلستانی', $content);
        $this->assertStringContainsString('2000000', $content);
        $this->assertStringContainsString('200000', $content, 'the toman column is present');
        $this->assertStringContainsString('09120000001', $content);

        // Paid/rejected rows never leak into the default (approved) export.
        $someoneElse = $this->designer('09120000033');
        $this->credit($someoneElse, 1_000_000);
        $this->registerBankAccount($someoneElse);
        $other = $this->request($someoneElse, 1_000_000);
        $this->actingAs($admin)
            ->patchJson("/api/admin/withdrawals/{$other->id}", ['action' => 'reject', 'admin_note' => 'دلیل'])
            ->assertOk();

        $afterReject = $this->actingAs($admin)->get('/api/admin/withdrawals/export')->streamedContent();
        $this->assertStringContainsString('2000000', $afterReject, 'the approved row is exported');
        $this->assertStringNotContainsString('1000000', $afterReject, 'the rejected row is not exported');

        // The status filter is honoured explicitly too.
        $rejectedExport = $this->actingAs($admin)->get('/api/admin/withdrawals/export?status=rejected')->streamedContent();
        $this->assertStringContainsString('1000000', $rejectedExport);
        $this->assertStringNotContainsString('2000000', $rejectedExport);
    }

    /* ------------------------------------------------------------------
     | Admin-owned settings
     * ------------------------------------------------------------------ */

    public function test_the_admin_owns_the_settlement_settings_and_every_change_is_audited(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->getJson('/api/admin/wallet/settings')
            ->assertOk()
            ->assertJsonPath('settlement.days', 7) // config default, not yet overridden
            ->assertJsonPath('settings.0.overridden', false)
            ->assertJsonStructure(['settings' => [['key', 'label', 'type', 'value', 'default']]]);

        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'واریز هر شنبه',
            'settlement_days' => 5,
            'min_amount_toman' => 250_000, // 2,500,000 ریال stored
            'bank_change_cooldown_hours' => 48,
            'withdrawals_enabled' => false,
        ]])->assertOk()
            ->assertJsonPath('saved', true)
            ->assertJsonPath('settlement.days', 5)
            ->assertJsonPath('settlement.withdrawals_enabled', false)
            ->assertJsonPath('settlement.min_amount_rial', 2_500_000);

        $this->assertSame('2500000', DB::table('site_settings')->where('key', WalletSettings::KEY_MIN_WITHDRAWAL_RIAL)->value('value'));
        $this->assertSame('48', DB::table('site_settings')->where('key', WalletSettings::KEY_BANK_CHANGE_COOLDOWN_HOURS)->value('value'));
        $this->assertSame('0', DB::table('site_settings')->where('key', WalletSettings::KEY_WITHDRAWALS_ENABLED)->value('value'));

        // One audit row per CHANGED key, with old → new.
        $audited = DB::table('audit_events')->where('event', WalletSettings::AUDIT_EVENT)->get();
        $this->assertSame(5, $audited->count());
        $minRow = $audited->first(fn ($row) => json_decode((string) $row->metadata, true)['key'] === WalletSettings::KEY_MIN_WITHDRAWAL_RIAL);
        $this->assertNotNull($minRow);
        $this->assertSame($admin->id, (int) $minRow->actor_id);
        $metadata = json_decode((string) $minRow->metadata, true);
        $this->assertNull($metadata['from']);
        $this->assertSame('2500000', $metadata['to']);

        // A second identical save changes nothing → no new audit rows.
        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'واریز هر شنبه',
            'settlement_days' => 5,
            'min_amount_toman' => 250_000,
            'bank_change_cooldown_hours' => 48,
            'withdrawals_enabled' => false,
        ]])->assertOk()->assertJsonPath('saved', false);
        $this->assertSame(5, DB::table('audit_events')->where('event', WalletSettings::AUDIT_EVENT)->count());

        // Validation: bad shapes are refused and change nothing.
        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_days' => 500,
            'min_amount_toman' => -5,
            'bank_change_cooldown_hours' => 'زیاد',
            'withdrawals_enabled' => 'شاید',
        ]])->assertStatus(422);
        $this->assertSame('5', DB::table('site_settings')->where('key', WalletSettings::KEY_SETTLEMENT_DAYS)->value('value'));
    }

    public function test_the_admin_settings_drive_the_designer_facing_rules(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, 5_000_000);

        // Master switch OFF → submissions are refused with a clear message.
        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'متن تسویه',
            'settlement_days' => 7,
            'min_amount_toman' => 100_000,
            'bank_change_cooldown_hours' => 24,
            'withdrawals_enabled' => false,
        ]])->assertOk();

        $this->registerBankAccount($designer);
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertStatus(422)
            ->assertJsonPath('message', 'ثبت درخواست برداشت توسط مدیر موقتاً غیرفعال شده است؛ لطفاً بعداً تلاش کنید.');

        // Switch back ON, raise the minimum to 300,000 تومان (= 3,000,000 ریال).
        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'متن تسویه',
            'settlement_days' => 7,
            'min_amount_toman' => 300_000,
            'bank_change_cooldown_hours' => 24,
            'withdrawals_enabled' => true,
        ]])->assertOk();

        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 2_999_999])
            ->assertStatus(422)
            ->assertJsonPath('message', 'حداقل مبلغ برداشت 300,000 تومان است.');

        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 3_000_000])
            ->assertCreated();

        // The designer page shows the switch + the effective minimum.
        $this->actingAs($designer)->getJson('/api/designer/wallet')
            ->assertOk()
            ->assertJsonPath('settlement.withdrawals_enabled', true)
            ->assertJsonPath('settlement.min_amount_rial', 3_000_000)
            ->assertJsonPath('min_amount_rial', 3_000_000);
    }

    public function test_the_bank_change_cooldown_follows_the_admin_setting(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();
        $this->credit($designer, 5_000_000);

        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'متن تسویه',
            'settlement_days' => 7,
            'min_amount_toman' => 100_000,
            'bank_change_cooldown_hours' => 0, // no waiting at all
            'withdrawals_enabled' => true,
        ]])->assertOk();

        $this->registerBankAccount($designer);
        $this->actingAs($designer)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => 'IR060170000000000000000000',
            'owner_name' => 'طاهر گلستانی',
            'code' => $this->bankCode($designer),
        ])->assertOk();

        // Cooldown 0 → a sheba change does not freeze withdrawals.
        $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertCreated();

        // Now demand a 48-hour wait and change the account again.
        $withdrawal = WithdrawalRequest::query()->latest('id')->firstOrFail();
        $this->actingAs($designer)->deleteJson("/api/designer/wallet/withdrawals/{$withdrawal->id}")->assertOk();

        $this->actingAs($admin)->putJson('/api/admin/wallet/settings', ['values' => [
            'settlement_note' => 'متن تسویه',
            'settlement_days' => 7,
            'min_amount_toman' => 100_000,
            'bank_change_cooldown_hours' => 48,
            'withdrawals_enabled' => true,
        ]])->assertOk();

        $this->actingAs($designer)->putJson('/api/designer/wallet/bank-account', [
            'sheba' => self::SHEBA,
            'owner_name' => 'طاهر گلستانی',
            'code' => $this->bankCode($designer),
        ])->assertOk();

        $this->assertNotNull(DesignerBankAccount::query()->where('user_id', $designer->id)->value('bank_changed_at'));
        $blocked = $this->actingAs($designer)
            ->postJson('/api/designer/wallet/withdrawals', ['amount' => 1_000_000])
            ->assertStatus(422)
            ->json('message');
        $this->assertStringContainsString('تغییر کرده است', (string) $blocked);
        $this->assertSame(0, WithdrawalRequest::query()->where('status', WithdrawalRequest::STATUS_PENDING)->count());
    }

    private function bankCode(User $user): string
    {
        app(OtpService::class)->storeCodeFor('bank_account', (string) $user->id, self::CODE);

        return self::CODE;
    }

    /* ------------------------------------------------------------------
     | Sales / attribution report + adjustment
     * ------------------------------------------------------------------ */

    public function test_the_designer_report_lists_wallets_commissions_and_attribution(): void
    {
        [$admin, $designer] = $this->paidDesignedRequest(2_000_000);

        $this->actingAs($admin)->getJson('/api/admin/wallet/designers?per_page=50')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'phone', 'wallet' => ['balance', 'in_debt'], 'commissions' => ['net_rial'], 'attributed_businesses', 'owned_businesses', 'open_requests']],
                'totals' => ['balance_rial', 'pending_balance_rial', 'open_requests', 'open_requests_rial'],
                'current_page',
                'total',
            ])
            ->assertJsonPath('totals.open_requests', 1)
            ->assertJsonPath('totals.open_requests_rial', 2_000_000)
            ->assertJsonPath('totals.pending_balance_rial', 2_000_000);

        // Search narrows the report.
        $this->actingAs($admin)->getJson('/api/admin/wallet/designers?q=09120000001')
            ->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($admin)->getJson('/api/admin/wallet/designers?q=09129999999')
            ->assertOk()->assertJsonCount(0, 'data');

        // One designer in full, with the ledger and the request history.
        $this->actingAs($admin)->getJson("/api/admin/wallet/designers/{$designer->id}")
            ->assertOk()
            ->assertJsonPath('designer.id', $designer->id)
            ->assertJsonPath('wallet.updated_at', fn ($value) => $value !== null)
            ->assertJsonStructure(['businesses', 'withdrawals', 'ledger', 'settlement' => ['note']]);
    }

    public function test_an_adjustment_needs_a_reason_and_is_audited(): void
    {
        $admin = $this->admin();
        $designer = $this->designer();

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => 100_000])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');

        $this->actingAs($admin)
            ->postJson("/api/admin/wallets/{$designer->id}/adjust", ['amount' => 250_000, 'reason' => 'جبران پورسانت جاافتاده'])
            ->assertCreated()
            ->assertJsonPath('wallet.balance', 250_000)
            ->assertJsonPath('ledger.0.type_label', 'اصلاح دستی مدیر');

        $this->assertTrue(
            DB::table('audit_events')->where('event', 'wallet.balance_adjusted')->where('actor_id', $admin->id)->exists(),
        );
        // The designer is notified about the correction (with the reason).
        $this->assertTrue(
            InternalNotification::query()
                ->where('user_id', $designer->id)
                ->where('type', 'wallet_withdrawal')
                ->where('message', 'like', '%جبران پورسانت جاافتاده%')
                ->exists(),
        );
    }
}
