<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

/**
 * An online payment transaction (ZarinPal era).
 *
 * SECURITY: every money/business column (amount, currency, plan_id,
 * business_id) is a SERVER-side snapshot written once at init from the DB
 * plan + ownership-checked business. None of them are mass-assignable from
 * requests. State transitions go exclusively through the guarded methods
 * below — controllers never write `status` directly.
 *
 * Concurrency: markPaid()/markFailed()/markCanceled() run inside a DB
 * transaction with row-level locking (`lockForUpdate`) and re-check the
 * current state, so two concurrent callbacks with the same authority can
 * never double-activate or double-consume.
 *
 * States: pending → paid | failed | canceled | expired.
 */
class PaymentTransaction extends Model
{
    use HasFactory;

    public const STATUS_PENDING = 'pending';

    public const STATUS_PAID = 'paid';

    public const STATUS_FAILED = 'failed';

    public const STATUS_CANCELED = 'canceled';

    public const STATUS_EXPIRED = 'expired';

    protected $fillable = [];

    /** Columns that must NEVER come from requests; only the service writes them. */
    public const IMMUTABLE_COLUMNS = ['amount', 'currency', 'plan_id', 'business_id', 'user_id', 'status', 'authority', 'ref_id', 'subscription_id'];

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'verification_payload' => 'array',
            'paid_at' => 'datetime',
            'verified_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function subscription(): BelongsTo
    {
        return $this->belongsTo(Subscription::class);
    }

    /** Is this row still awaiting a provider result (non-terminal)? */
    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    /**
     * The charged amount in TOMAN — the display/report unit. Symmetric,
     * documented counterpart of Plan::priceRial(): the gateway amount is
     * stored in RIAL and this converts back exactly once (÷10, IRR only).
     * Deriving the subscription money snapshot from THIS value (not the
     * current plan price) keeps the freeze-at-init guarantee: a later plan
     * reprice can never rewrite what the subscriber actually paid.
     */
    public function amountToman(): int
    {
        if (strtoupper((string) $this->currency) === 'IRR') {
            return intdiv((int) $this->amount, 10);
        }

        return (int) $this->amount;
    }

    /** Has this transaction already produced its one allowed subscription? */
    public function isConsumed(): bool
    {
        return $this->subscription_id !== null;
    }

    /**
     * Atomically claim the pending→paid transition under a row lock.
     * Returns the FRESH row; when $freshStatus is false the caller already
     * knows the row is paid and must NOT re-run activation.
     *
     * @param  array{amount?:int, ref_id?:?string, card_pan_masked?:?string, payload?:array}  $data
     * @return array{row: self, claimed: bool}
     */
    public static function claimPaid(string $authority, array $data): array
    {
        return DB::transaction(function () use ($authority, $data): array {
            /** @var self|null $row */
            $row = static::query()->where('authority', $authority)->lockForUpdate()->first();
            if ($row === null) {
                return ['row' => (new self)->forceFill(['status' => self::STATUS_FAILED]), 'claimed' => false];
            }

            if ($row->status !== self::STATUS_PENDING) {
                return ['row' => $row, 'claimed' => false]; // replay → idempotent refusal
            }

            $row->forceFill([
                'status' => self::STATUS_PAID,
                'paid_at' => now(),
                'verified_at' => now(),
                'ref_id' => $data['ref_id'] ?? $row->ref_id,
                'card_pan_masked' => $data['card_pan_masked'] ?? $row->card_pan_masked,
                'verification_payload' => $data['payload'] ?? $row->verification_payload,
                'failure_reason' => null,
            ])->save();

            return ['row' => $row->refresh(), 'claimed' => true];
        });
    }

    /**
     * Atomically claim the pending→failed/canceled transition under a row
     * lock (verify failures, NOK callbacks, amount mismatches, provider
     * errors). Never touches non-pending rows (a paid row can never be
     * demoted, a failed row's reason is preserved).
     *
     * @return array{row: self, claimed: bool}
     */
    public static function claimTerminal(string $authority, string $status, string $reason): array
    {
        return DB::transaction(function () use ($authority, $status, $reason): array {
            /** @var self|null $row */
            $row = static::query()->where('authority', $authority)->lockForUpdate()->first();
            if ($row === null) {
                return ['row' => (new self)->forceFill(['status' => self::STATUS_FAILED]), 'claimed' => false];
            }

            if ($row->status !== self::STATUS_PENDING) {
                return ['row' => $row, 'claimed' => false];
            }

            $row->forceFill([
                'status' => $status,
                'failure_reason' => $reason,
            ])->save();

            return ['row' => $row->refresh(), 'claimed' => true];
        });
    }
}
