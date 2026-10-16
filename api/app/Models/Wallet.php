<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\QueryException;

/**
 * A designer's wallet — exactly ONE row per user (`user_id` is unique).
 *
 * MONEY: integer RIAL. Both balances are SIGNED on purpose: reversing a
 * commission whose payout already left the wallet may legitimately push the
 * designer into debt, and the debt must be visible (to the admin) and repaid
 * out of the next commissions rather than silently clamped to zero.
 *
 * WRITE RULE: no controller and no endpoint may touch `balance` /
 * `pending_balance` directly. Every mutation goes through
 * App\Services\Wallet\WalletLedger, which locks this row inside a
 * DB::transaction and appends the matching wallet_transactions row — the two
 * can therefore never disagree.
 *
 * Nothing here is mass-assignable (`$fillable = []`), matching
 * PaymentTransaction: the values are server-computed, never request values.
 */
class Wallet extends Model
{
    use HasFactory;

    protected $fillable = [];

    /**
     * A brand-new wallet answers 0/0 before it is even saved, mirroring the
     * DB defaults: services may compute `withdrawable()` on a freshly created
     * wallet without a refresh round-trip (and never see null arithmetic).
     */
    protected $attributes = ['balance' => 0, 'pending_balance' => 0];

    protected function casts(): array
    {
        return [
            'balance' => 'integer',
            'pending_balance' => 'integer',
        ];
    }

    /** Columns only the wallet services may write. */
    public const IMMUTABLE_COLUMNS = ['user_id', 'balance', 'pending_balance'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class);
    }

    /**
     * «قابل برداشت» — what the designer may REQUEST next.
     *
     *   balance ≤ 0  → that number itself. A DEBT (created by reversing a
     *                  commission that was already paid out) is reported as the
     *                  negative value it is; clamping it to zero would hide the
     *                  debt from the designer and from the admin report.
     *   balance > 0  → balance − pending_balance, floored at zero. The money in
     *                  flight (an open request) is already held out of `balance`,
     *                  so the difference can go negative for a request that ate
     *                  the whole balance — nothing more is requestable, and the
     *                  raw negative would be a figure nobody can ask for.
     *
     * Note that an open request blocks new submissions anyway (one open request
     * per designer), so this accessor is the display/report contract; the
     * authoritative balance check in WithdrawalService::submit always runs with
     * `pending_balance = 0`.
     */
    public function withdrawable(): int
    {
        $balance = (int) $this->balance;

        if ($balance <= 0) {
            return $balance;
        }

        return max(0, $balance - (int) $this->pending_balance);
    }

    /**
     * The wallet of a user (created empty on first access).
     *
     * Deliberately NOT firstOrCreate(): the money models keep `$fillable = []`
     * and the app runs with strict mass-assignment, so `user_id` is written
     * with forceFill. A concurrent double-create is resolved by the unique
     * index on `user_id` (the loser re-reads the winner's row) instead of
     * letting two wallets exist for one designer.
     */
    public static function forUser(int $userId): self
    {
        $wallet = static::query()->where('user_id', $userId)->first();
        if ($wallet !== null) {
            return $wallet;
        }

        try {
            $wallet = new self;
            $wallet->forceFill(['user_id' => $userId])->save();

            return $wallet;
        } catch (QueryException) {
            return static::query()->where('user_id', $userId)->firstOrFail();
        }
    }
}
