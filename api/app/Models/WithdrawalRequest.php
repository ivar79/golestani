<?php

namespace App\Models;

use App\Support\Jalali;
use App\Support\Sheba;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * A designer's payout request — settled MANUALLY by an admin.
 *
 * No gateway call, no bank API, no automatic transfer exists anywhere in this
 * flow: the admin pays outside the system and records the tracking number in
 * `payment_reference`. The status machine is the whole product contract:
 *
 *   pending ──approve──▶ approved ──paid (payment_reference required)──▶ paid
 *      │                     │
 *      │                     └──reject (reason required)──▶ rejected
 *      └──cancel (by the designer)──▶ cancelled
 *
 * TERMINAL = paid | rejected | cancelled. Once a row is terminal it is frozen:
 * the model refuses ANY further update (paid/rejected are final per the
 * business rule, and a paid payout must never be re-pointed at another amount,
 * sheba or designer). Money movements are recorded as ledger rows, never by
 * editing this row.
 *
 * SHEBA/OWNER_NAME ARE SNAPSHOTS taken at submission time: editing the
 * registered bank account later must not rewrite where a paid request sent the
 * money.
 */
class WithdrawalRequest extends Model
{
    use HasFactory;

    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_PAID = 'paid';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_CANCELLED = 'cancelled';

    /** Terminal statuses — final and unchangeable. */
    public const TERMINAL_STATUSES = [self::STATUS_PAID, self::STATUS_REJECTED, self::STATUS_CANCELLED];

    /** Statuses that still hold money (one per designer at a time). */
    public const OPEN_STATUSES = [self::STATUS_PENDING, self::STATUS_APPROVED];

    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'requested_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'paid_at' => 'datetime',
            // The admin's ESTIMATE of the manual transfer (see the
            // 2026_10_15_000007 migration). Never the settlement itself.
            'expected_paid_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $request): void {
            $original = (string) $request->getOriginal('status');

            if (in_array($original, self::TERMINAL_STATUSES, true)) {
                throw new RuntimeException('درخواست برداشت در وضعیت پایانی است و قابل تغییر نیست.');
            }

            // Identity + money of a reviewed request are frozen too: only the
            // status transitions and admin metadata may change after submission.
            foreach (['user_id', 'amount', 'sheba', 'owner_name'] as $column) {
                if ($request->isDirty($column)) {
                    throw new RuntimeException("تغییر «{$column}» در درخواست برداشت مجاز نیست.");
                }
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'admin_id');
    }

    /** Still holding money (pending or approved) — at most one per designer. */
    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN_STATUSES, true);
    }

    /** Final: paid, rejected or cancelled. */
    public function isTerminal(): bool
    {
        return in_array($this->status, self::TERMINAL_STATUSES, true);
    }

    /**
     * The estimated transfer moment as a Jalali string ('۱۴۰۵/۰۷/۲۵'), for
     * notification texts. Null when no estimate was recorded.
     */
    public function expectedPaidJalali(): ?string
    {
        return Jalali::formatFa($this->expected_paid_at);
    }

    /** Masked sheba for anyone who is not the owner or an admin. */
    public function maskedSheba(): string
    {
        return (string) Sheba::mask($this->sheba);
    }
}
