<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * One APPEND-ONLY ledger row (دفتر کل). The money truth of the wallet system.
 *
 * IMMUTABILITY IS ENFORCED HERE, not by convention: `updating` and `deleting`
 * throw, so no controller, admin action, tinker session or future refactor can
 * rewrite or erase financial history. A correction is a NEW row with the
 * opposite amount (`commission_reversed`, `adjustment`) — exactly the rule
 * finance needs.
 *
 * IDEMPOTENCY: `idempotency_key` is unique in the database and is built ONLY
 * through the helpers below, which is what makes commission accrual
 * exactly-once across retries, replayed callbacks and repeated admin
 * approvals:
 *   - commission:payment:{payment_transaction_id}  → online purchase/renewal
 *   - commission:order:{subscription_id}           → manual (receipt) purchase
 *   - reverse:{the accrual key}                    → its one allowed reversal
 *
 * MONEY: integer RIAL, signed. `amount > 0` credits the designer, `amount < 0`
 * debits. `balance_after` is the wallet balance immediately after this row.
 */
class WalletTransaction extends Model
{
    use HasFactory;

    public const TYPE_COMMISSION_ACCRUED = 'commission_accrued';

    public const TYPE_WITHDRAWAL_HOLD = 'withdrawal_hold';

    public const TYPE_WITHDRAWAL_PAID = 'withdrawal_paid';

    public const TYPE_WITHDRAWAL_RELEASED = 'withdrawal_released';

    public const TYPE_COMMISSION_REVERSED = 'commission_reversed';

    public const TYPE_ADJUSTMENT = 'adjustment';

    /** The ledger has no `updated_at`: a row is written once and never changes. */
    public $timestamps = false;

    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'balance_after' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new RuntimeException('دفتر کل کیف پول فقط-ثبت است: ویرایش ردیف مالی مجاز نیست. برای اصلاح، تراکنش معکوس ثبت کنید.');
        });

        static::deleting(function (): void {
            throw new RuntimeException('دفتر کل کیف پول فقط-ثبت است: حذف ردیف مالی مجاز نیست.');
        });
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(Wallet::class);
    }

    public function subscription(): BelongsTo
    {
        return $this->belongsTo(Subscription::class);
    }

    public function paymentTransaction(): BelongsTo
    {
        return $this->belongsTo(PaymentTransaction::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Idempotency key of an ONLINE purchase (the gateway transaction is the purchase event). */
    public static function commissionKeyForPayment(int $paymentTransactionId): string
    {
        return "commission:payment:{$paymentTransactionId}";
    }

    /** Idempotency key of a MANUAL/receipt purchase (its subscription row is the purchase event). */
    public static function commissionKeyForOrder(int $subscriptionId): string
    {
        return "commission:order:{$subscriptionId}";
    }

    /** The single allowed reversal of one accrual row. */
    public static function reversalKeyFor(string $accrualKey): string
    {
        return "reverse:{$accrualKey}";
    }

    public function isCommissionAccrual(): bool
    {
        return $this->type === self::TYPE_COMMISSION_ACCRUED;
    }
}
