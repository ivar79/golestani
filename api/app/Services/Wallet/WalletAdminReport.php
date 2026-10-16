<?php

namespace App\Services\Wallet;

use App\Models\DesignerBankAccount;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Support\Sheba;

/**
 * The read-only money view of ONE designer, shared by every admin surface:
 * the payout queue, the per-request detail screen, the designer wallet page
 * and the sales/attribution report.
 *
 * WHY A SERVICE: the same numbers (balance, debt, commissions, ledger) used to
 * be assembled per controller, which is how two admin screens end up showing
 * different totals for the same designer. There is exactly one shaping of the
 * data now, and it always comes from the LEDGER — never from a cached column
 * that could drift.
 *
 * Everything here is READ-ONLY. Writes go through WalletLedger / WithdrawalService.
 */
final class WalletAdminReport
{
    /**
     * One row of the payout queue / a single request screen.
     *
     * `$wallet` lets a list endpoint pass the ALREADY LOADED wallet of that
     * designer (one query for the whole page instead of one per row).
     */
    public function requestPayload(WithdrawalRequest $row, ?Wallet $wallet = null): array
    {
        return [
            'id' => $row->id,
            'amount' => (int) $row->amount,
            'amount_toman' => intdiv((int) $row->amount, 10),
            // The ADMIN needs the real account number: they are the one typing
            // it into the bank. Everyone else sees it masked.
            'sheba' => (string) $row->sheba,
            'sheba_formatted' => $this->formattedSheba((string) $row->sheba),
            'sheba_masked' => $row->maskedSheba(),
            'owner_name' => (string) $row->owner_name,
            'status' => $row->status,
            'status_label' => $this->statusLabel((string) $row->status),
            'admin_note' => $row->admin_note,
            'payment_reference' => $row->payment_reference,
            'requested_at' => $row->requested_at?->toISOString(),
            'reviewed_at' => $row->reviewed_at?->toISOString(),
            'paid_at' => $row->paid_at?->toISOString(),
            'expected_paid_at' => $row->expected_paid_at?->toISOString(),
            'expected_paid_at_jalali' => $row->expectedPaidJalali(),
            'is_open' => $row->isOpen(),
            'is_terminal' => $row->isTerminal(),
            // The queue shows the designer's money AT A GLANCE (balance, debt,
            // what is held) so a decision does not need a second screen.
            'wallet' => $wallet === null
                ? $this->walletPayload((int) $row->user_id)
                : $this->walletPayloadFor($wallet),
            'admin' => $row->relationLoaded('admin') && $row->admin !== null
                ? ['id' => $row->admin->id, 'name' => $row->admin->name]
                : null,
            'designer' => $row->relationLoaded('user') && $row->user !== null
                ? [
                    'id' => $row->user->id,
                    'name' => $row->user->name,
                    'phone' => $row->user->phone,
                    'username' => $row->user->username,
                ]
                : null,
        ];
    }

    /** Identity + the registered payout account (admins may see the full sheba). */
    public function designerPayload(?User $user): ?array
    {
        if ($user === null) {
            return null;
        }

        $account = DesignerBankAccount::query()->where('user_id', $user->id)->first();

        return [
            'id' => $user->id,
            'name' => $user->name,
            'phone' => $user->phone,
            'username' => $user->username,
            'designer_status' => $user->designer_status,
            'bank_account' => $account === null ? null : [
                'sheba' => (string) $account->sheba,
                'sheba_formatted' => $this->formattedSheba((string) $account->sheba),
                'owner_name' => (string) $account->owner_name,
                'bank_changed_at' => $account->bank_changed_at?->toISOString(),
            ],
        ];
    }

    public function walletPayload(int $userId): array
    {
        return $this->walletPayloadFor(Wallet::forUser($userId));
    }

    /** Same payload from an already-loaded wallet row. */
    public function walletPayloadFor(Wallet $wallet): array
    {
        return [
            'balance' => (int) $wallet->balance,
            'pending_balance' => (int) $wallet->pending_balance,
            'withdrawable' => $wallet->withdrawable(),
            // A negative balance is the designer's DEBT after a reversal; the
            // panel must show it as debt, never as a rounded-away zero.
            'in_debt' => (int) $wallet->balance < 0,
            'updated_at' => $wallet->updated_at?->toISOString(),
        ];
    }

    /** Commission + sales summary of one designer (aggregated from the ledger). */
    public function commissionPayload(int $userId): array
    {
        $walletId = Wallet::forUser($userId)->id;

        $sumByType = WalletTransaction::query()
            ->where('wallet_id', $walletId)
            ->selectRaw('type, coalesce(sum(amount), 0) as total, count(*) as rows')
            ->groupBy('type')
            ->get()
            ->keyBy('type');

        $accrued = (int) ($sumByType->get(WalletTransaction::TYPE_COMMISSION_ACCRUED)->total ?? 0);
        $reversed = abs((int) ($sumByType->get(WalletTransaction::TYPE_COMMISSION_REVERSED)->total ?? 0));

        return [
            'accrued_rial' => $accrued,
            'reversed_rial' => $reversed,
            'net_rial' => $accrued - $reversed,
            'commission_count' => (int) ($sumByType->get(WalletTransaction::TYPE_COMMISSION_ACCRUED)->rows ?? 0),
            'adjustments_rial' => (int) ($sumByType->get(WalletTransaction::TYPE_ADJUSTMENT)->total ?? 0),
            'paid_out_rial' => abs((int) ($sumByType->get(WalletTransaction::TYPE_WITHDRAWAL_HOLD)->total ?? 0)),
            // Attributed sales: one purchase per subscription accrual.
            'sales_count' => (int) WalletTransaction::query()
                ->where('wallet_id', $walletId)
                ->where('type', WalletTransaction::TYPE_COMMISSION_ACCRUED)
                ->distinct()
                ->count('subscription_id'),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function ledgerPayload(int $userId, int $limit = 25): array
    {
        $walletId = Wallet::forUser($userId)->id;

        return WalletTransaction::query()
            ->where('wallet_id', $walletId)
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (WalletTransaction $row): array => [
                'id' => $row->id,
                'type' => $row->type,
                'type_label' => $this->typeLabel((string) $row->type),
                'amount' => (int) $row->amount,
                'balance_after' => (int) $row->balance_after,
                'description' => $row->description,
                'subscription_id' => $row->subscription_id,
                'reference_type' => $row->reference_type,
                'reference_id' => $row->reference_id,
                'created_at' => $row->created_at?->toISOString(),
            ])
            ->all();
    }

    public function statusLabel(string $status): string
    {
        return match ($status) {
            WithdrawalRequest::STATUS_PENDING => 'در انتظار بررسی',
            WithdrawalRequest::STATUS_APPROVED => 'تأییدشده — در صف پرداخت',
            WithdrawalRequest::STATUS_PAID => 'پرداخت‌شده',
            WithdrawalRequest::STATUS_REJECTED => 'ردشده',
            WithdrawalRequest::STATUS_CANCELLED => 'لغوشده توسط طراح',
            default => $status,
        };
    }

    public function typeLabel(string $type): string
    {
        return match ($type) {
            WalletTransaction::TYPE_COMMISSION_ACCRUED => 'پورسانت خرید',
            WalletTransaction::TYPE_COMMISSION_REVERSED => 'برگشت پورسانت',
            WalletTransaction::TYPE_WITHDRAWAL_HOLD => 'نگه‌داشت مبلغ برداشت',
            WalletTransaction::TYPE_WITHDRAWAL_RELEASED => 'آزادسازی مبلغ برداشت',
            WalletTransaction::TYPE_WITHDRAWAL_PAID => 'پرداخت برداشت',
            WalletTransaction::TYPE_ADJUSTMENT => 'اصلاح دستی مدیر',
            default => $type,
        };
    }

    /** 'IR82 0540 1026 8002 0817 9090 02' — grouped for the copy button. */
    public function formattedSheba(string $sheba): string
    {
        $normalized = (string) Sheba::normalize($sheba);

        return trim(chunk_split($normalized, 4, ' '));
    }
}
