<?php

namespace App\Services;

use App\Models\Business;
use App\Models\InternalNotification;
use App\Models\Subscription;
use Illuminate\Contracts\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * Subscription END-OF-LIFE settlement — the ONE place that turns a past-due
 * subscription row into an `expired` row and notifies its owner.
 *
 * WHY THIS EXISTS (Phase 5 finding): the nightly `subscriptions:expire`
 * command was the only writer of `status = expired` (and of the
 * `subscription_expired` internal notification). Access control has always
 * been cron-free — FeatureGate resolves the ACTIVE subscription from
 * `expires_at` against the server clock — but the STORED status, the owner +
 * admin dashboards and the notification all lagged behind whenever no
 * scheduler ran in the deployed environment. A declared schedule that nothing
 * executes is not a working expiry.
 *
 * Design rules:
 *  - Idempotent: expiring an already-expired row is a no-op and the
 *    notification is created with firstOrCreate on
 *    (user_id, type, related_type, related_id), so any number of concurrent
 *    requests, repeats of the artisan sweep, or a lazy read racing the sweep
 *    can never produce a second notification.
 *  - Never early: a row is only expired once it is genuinely past its end —
 *    timestamp rows use `expires_at <= now()` (second precision), legacy
 *    day-granular rows use `end_date < today` (a row ending today is still
 *    valid). Nothing is notified before that boundary.
 *  - Never destructive: payment history, ownership, snapshots and admin
 *    notes are untouched; only `status` changes.
 *  - Shared by both entry points: ExpireSubscriptions (batch sweep) and
 *    FeatureGate::settleLifecycle() (lazy, request-triggered) call the SAME
 *    methods, so the two can never drift apart in behaviour or message copy.
 */
class SubscriptionLifecycle
{
    /**
     * Narrow a `subscriptions` query to the ACTIVE rows that are past due —
     * the exact predicate both entry points must agree on.
     */
    public static function applyPastDue(Builder $query, Carbon $now): Builder
    {
        $today = $now->copy()->startOfDay();

        return $query
            ->where('status', 'active')
            ->where(function (Builder $q) use ($now, $today): void {
                // Timestamp lifecycle: precise expiry sweep for rows that
                // carry expires_at (online payments + new activations).
                $q->where(function (Builder $t) use ($now): void {
                    $t->whereNotNull('expires_at')->where('expires_at', '<=', $now);
                })
                    // Legacy day-granular rows keep the old sweep rule.
                    ->orWhere(function (Builder $d) use ($today): void {
                        $d->whereNull('expires_at')->whereNotNull('end_date')->whereDate('end_date', '<', $today);
                    });
            });
    }

    /** Does this business have any row that needs settlement right now? (cheap, unlocked probe) */
    public function hasSettlementDue(Business $business, ?Carbon $now = null): bool
    {
        $now ??= Carbon::now();

        return self::applyPastDue($business->subscriptions()->getQuery(), $now)->exists();
    }

    /**
     * Expire every past-due row of one business. Returns how many rows were
     * flipped. Safe to call on every request: the probe makes the common case
     * a single indexed SELECT, and the write path is idempotent.
     */
    public function expirePastDueFor(Business $business, ?Carbon $now = null): int
    {
        $now ??= Carbon::now();
        $expired = 0;

        $rows = self::applyPastDue($business->subscriptions()->getQuery(), $now)->orderBy('id')->get();

        foreach ($rows as $subscription) {
            if ($this->markExpired($subscription)) {
                $expired++;
            }
        }

        return $expired;
    }

    /**
     * Flip ONE subscription to expired and notify its owner exactly once.
     * Returns true when this call performed the transition.
     *
     * The row is re-read under a lock so a lazy request and the nightly sweep
     * (or two concurrent requests) serialise: whoever loses the race sees a
     * non-active status and returns false without writing or notifying.
     */
    public function markExpired(Subscription $subscription): bool
    {
        $transitioned = false;

        \Illuminate\Support\Facades\DB::transaction(function () use ($subscription, &$transitioned): void {
            /** @var Subscription|null $fresh */
            $fresh = Subscription::query()->whereKey($subscription->getKey())->lockForUpdate()->first();

            if ($fresh === null || $fresh->status !== 'active') {
                return; // already settled (or gone) — nothing to do, no notification
            }

            $fresh->update(['status' => 'expired']);
            $transitioned = true;

            $business = $fresh->business;
            if ($business?->user_id) {
                InternalNotification::firstOrCreate(
                    [
                        'user_id' => $business->user_id,
                        'type' => 'subscription_expired',
                        'related_type' => Subscription::class,
                        'related_id' => $fresh->id,
                    ],
                    [
                        'title' => 'اشتراک منقضی شد',
                        'message' => "اشتراک {$fresh->plan?->name} برای کسب‌وکار {$business->name} منقضی شده است.",
                    ],
                );
            }
        });

        return $transitioned;
    }
}
