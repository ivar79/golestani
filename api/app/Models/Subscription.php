<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A Subscription is an EVENT that happened to a business: it references a
 * plan but carries its OWN money snapshot (price/currency/duration, frozen
 * at request time) and — after admin activation — its own entitlement
 * snapshot (POLICY snapshot_entitlements), so future plan edits never
 * retroactively change existing subscribers.
 *
 * REBUY/UPGRADE/DOWNGRADE model: a business has AT MOST ONE `active`
 * subscription (extended in place by same-plan renewal payments — many
 * payment_transactions rows may point at this one row) and AT MOST ONE
 * `scheduled` subscription (a paid plan change waiting for the current
 * lifetime to end; it grants NOTHING until promoted at its started_at).
 *
 * SECURITY: plan_id, plan_name, price_amount, price_currency, duration_days
 * and entitlements are never accepted from client input. store() copies them
 * from the DB plan; moderate()/PaymentService write the entitlement snapshot
 * server-side.
 *
 * TIME LIFECYCLE (source of truth = timestamps, never a counter):
 *   - started_at / expires_at are UTC timestamps written ONCE at activation
 *     (PaymentService or admin moderate()).
 *   - remaining time is DERIVED at read time: expires_at − now. Nothing in
 *     the DB decrements — refresh, multiple devices, cron failure, restarts
 *     or timezones can never drift it.
 *   - effective_status: when now >= expires_at an `active` row is no longer
 *     entitled, even before the nightly sweep flips its stored status.
 *   - Legacy rows without timestamps fall back to end_date end-of-day
 *     (previous day-granular behaviour, preserved exactly).
 */
class Subscription extends Model
{
    use HasFactory;

    protected $fillable = ['business_id', 'plan_id', 'status', 'receipt_reference', 'receipt_path', 'receipt_name', 'receipt_mime', 'start_date', 'end_date', 'admin_note'];

    /** Statuses beyond the original receipt-era enum (payment era). */
    public const STATUS_SCHEDULED = 'scheduled';

    protected $appends = ['effective_status', 'remaining_seconds'];

    protected function casts(): array
    {
        return ['start_date' => 'date', 'end_date' => 'date', 'entitlements' => 'array', 'started_at' => 'datetime', 'expires_at' => 'datetime'];
    }

    /** Money snapshot values, falling back to the (current) plan for legacy rows. */
    public function moneySnapshot(): array
    {
        return ['plan_name' => $this->plan_name ?? $this->plan?->name, 'price_amount' => $this->price_amount ?? $this->plan?->price, 'price_currency' => $this->price_currency ?? $this->plan?->currency ?? 'IRR', 'duration_days' => $this->duration_days ?? $this->plan?->duration_days];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    /* -----------------------------------------------------------------
     | Time lifecycle (derived — never stored, never decremented)
     * ----------------------------------------------------------------- */

    /** The authoritative end-of-life timestamp: expires_at, or end-of-day of end_date for legacy rows. */
    public function lifetimeEndsAt(): ?Carbon
    {
        return $this->expires_at ?? $this->end_date?->copy()->endOfDay();
    }

    /** The authoritative start timestamp: started_at, or the legacy start_date. */
    public function lifetimeStartedAt(): ?Carbon
    {
        return $this->started_at ?? $this->start_date;
    }

    /**
     * True while the subscription still grants entitlements right NOW
     * (server clock). An `active` row whose lifetime has passed is NOT valid —
     * access control must never trust a stale `active` flag alone.
     */
    public function isCurrentlyActive(): bool
    {
        if ($this->status !== 'active') {
            return false;
        }
        $endsAt = $this->lifetimeEndsAt();

        return $endsAt === null || $endsAt->isFuture();
    }

    /** Derived status: `expired` the instant the lifetime passes, without any cron. */
    public function getEffectiveStatusAttribute(): string
    {
        if ($this->status === 'active' && ! $this->isCurrentlyActive()) {
            return 'expired';
        }

        return $this->status;
    }

    /** True while this row is a paid change waiting for its start time. */
    public function isScheduled(): bool
    {
        return $this->status === self::STATUS_SCHEDULED;
    }

    /** Derived remaining seconds (expires_at − now, floored at 0). Read-only. */
    public function getRemainingSecondsAttribute(): ?int
    {
        $endsAt = $this->lifetimeEndsAt();
        if ($endsAt === null) {
            return null;
        }

        return max(0, (int) now()->diffInSeconds($endsAt, false));
    }
}
