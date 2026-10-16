<?php

namespace App\Services\Wallet;

use App\Models\Wallet;
use App\Models\WalletTransaction;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * THE ONLY writer of wallet balances and ledger rows.
 *
 * Every public method does exactly one thing: inside a DB::transaction, LOCK
 * the wallet row (`lockForUpdate`), apply the money movement, and append the
 * matching append-only ledger row. Balances and ledger therefore cannot
 * disagree, and two concurrent writers on the same wallet serialize instead of
 * interleaving a read-modify-write.
 *
 * IDEMPOTENCY CONTRACT: every method takes an `idempotencyKey`, unique in the
 * database. If a row with that key already exists the call is a no-op and
 * returns NULL — so a retried callback, a repeated admin click or a re-run of
 * `commissions:backfill` can never move money twice. A non-null return means
 * THIS call created the row.
 *
 * LEDGER ARITHMETIC (documented once, relied on everywhere):
 *   balance          = Σ ledger.amount            (all types)
 *   pending_balance  = Σ open withdrawal_requests.amount
 *   withdrawable     = balance − pending_balance
 *
 * `withdrawal_hold` moves money balance → pending (−A / +A), so the payout
 * itself (`withdrawal_paid`) has NO balance effect: the money already left
 * `balance` when it was held. Its ledger row is the audit stamp (amount 0,
 * the paid sum lives on the request row) — which is exactly why the first
 * invariant above stays true.
 */
final class WalletLedger
{
    /**
     * Commission earned (positive) — the designer's share of a confirmed
     * purchase. Reversals are posted with a negative delta, never by editing
     * this row.
     */
    public function accrue(int $userId, string $key, int $amountRial, array $context = []): ?WalletTransaction
    {
        if ($amountRial <= 0) {
            throw new RuntimeException('مبلغ پورسانت باید مثبت باشد.');
        }

        return $this->post($userId, WalletTransaction::TYPE_COMMISSION_ACCRUED, $key, $amountRial, 0, $context);
    }

    /** Hold money for an open withdrawal request: balance −A, pending +A. */
    public function hold(int $userId, string $key, int $amountRial, array $context = []): ?WalletTransaction
    {
        return $this->post($userId, WalletTransaction::TYPE_WITHDRAWAL_HOLD, $key, -$amountRial, $amountRial, $context);
    }

    /** The designer cancelled (or an admin rejected) the request: balance +A, pending −A. */
    public function release(int $userId, string $key, int $amountRial, array $context = []): ?WalletTransaction
    {
        return $this->post($userId, WalletTransaction::TYPE_WITHDRAWAL_RELEASED, $key, $amountRial, -$amountRial, $context);
    }

    /**
     * The admin paid the request MANUALLY outside the system: pending −A and
     * the balance is untouched (already debited at hold time). `amount` in the
     * ledger is 0 for exactly this reason.
     */
    public function confirmPayout(int $userId, string $key, int $amountRial, array $context = []): ?WalletTransaction
    {
        return $this->post($userId, WalletTransaction::TYPE_WITHDRAWAL_PAID, $key, 0, -$amountRial, $context);
    }

    /**
     * Reverse an accrued commission (subscription rejected/refunded). The
     * delta is negative, so the designer's balance MAY go below zero — that
     * debt is shown to the admin and repaid out of the next commissions.
     */
    public function reverse(int $userId, string $key, int $negativeAmountRial, array $context = []): ?WalletTransaction
    {
        if ($negativeAmountRial >= 0) {
            throw new RuntimeException('مبلغ برگشت پورسانت باید منفی باشد.');
        }

        return $this->post($userId, WalletTransaction::TYPE_COMMISSION_REVERSED, $key, $negativeAmountRial, 0, $context);
    }

    /** Admin correction. Signed by nature; the reason is mandatory at the API layer. */
    public function adjust(int $userId, string $key, int $amountRial, array $context = []): ?WalletTransaction
    {
        if ($amountRial === 0) {
            throw new RuntimeException('مبلغ اصلاح نمی‌تواند صفر باشد.');
        }

        return $this->post($userId, WalletTransaction::TYPE_ADJUSTMENT, $key, $amountRial, 0, $context);
    }

    /**
     * The single write path. Returns NULL when the event was already applied
     * (idempotency key present) — never a partial or duplicated movement.
     *
     * @param  array{subscription_id?:?int, payment_transaction_id?:?int, reference_type?:?string, reference_id?:?int, description?:?string, created_by?:?int}  $context
     */
    private function post(int $userId, string $type, string $key, int $balanceDelta, int $pendingDelta, array $context): ?WalletTransaction
    {
        try {
            return DB::transaction(function () use ($userId, $type, $key, $balanceDelta, $pendingDelta, $context): ?WalletTransaction {
                // Serialize every writer on this wallet (and create it if this is
                // the designer's very first event).
                Wallet::forUser($userId);

                /** @var Wallet $wallet */
                $wallet = Wallet::query()->where('user_id', $userId)->lockForUpdate()->firstOrFail();

                if (WalletTransaction::query()->where('idempotency_key', $key)->exists()) {
                    return null; // already applied — retry-safe no-op
                }

                $wallet->forceFill([
                    'balance' => (int) $wallet->balance + $balanceDelta,
                    'pending_balance' => (int) $wallet->pending_balance + $pendingDelta,
                ])->save();

                $row = new WalletTransaction;
                $row->forceFill([
                    'wallet_id' => $wallet->id,
                    'type' => $type,
                    'amount' => $balanceDelta,
                    'balance_after' => (int) $wallet->balance,
                    'idempotency_key' => $key,
                    'reference_type' => $context['reference_type'] ?? null,
                    'reference_id' => $context['reference_id'] ?? null,
                    'subscription_id' => $context['subscription_id'] ?? null,
                    'payment_transaction_id' => $context['payment_transaction_id'] ?? null,
                    'description' => $context['description'] ?? null,
                    'created_by' => $context['created_by'] ?? null,
                    'created_at' => now(),
                ]);
                $row->save();

                return $row;
            });
        } catch (QueryException $e) {
            // A racing writer inserted the same key between our check and our
            // insert: that is the idempotency guarantee working, not an error.
            if (WalletTransaction::query()->where('idempotency_key', $key)->exists()) {
                Log::info('wallet.ledger.duplicate_key_suppressed', ['key' => $key, 'user_id' => $userId]);

                return null;
            }

            throw $e;
        }
    }
}
