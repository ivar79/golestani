<?php

namespace App\Services;

use App\Models\InternalNotification;
use App\Models\Subscription;
use App\Services\Payments\PaymentService;
use Illuminate\Support\Carbon;

/**
 * BATCH settlement sweep — the ONE implementation of "expire everything that
 * is past due and promote what was waiting behind it".
 *
 * WHY THIS EXISTS (Phase 5 finding A): the sweep used to live inside the
 * artisan command only, so the deployed environment could only settle a
 * subscription if something ran Laravel's scheduler — and on the free Render
 * web service nothing does. The sweep is now a service with THREE entry
 * points that all share this exact code:
 *
 *   1. `php artisan subscriptions:expire`  (Render cron job, local dev, ops)
 *   2. `POST /api/internal/cron/expire-subscriptions` — token-guarded HTTP
 *      trigger, so a FREE external scheduler (Vercel Cron, GitHub Actions)
 *      can run the real sweep against the deployed API.
 *   3. Lazily via FeatureGate::settleLifecycle() on a per-business basis.
 *
 * Idempotency lives in SubscriptionLifecycle::markExpired() (row lock +
 * status re-read + firstOrCreate notification), so overlapping runs — retries,
 * simultaneous triggers, a scheduler racing a user request — can never
 * double-expire a row or emit a duplicate notification. The sweep itself is
 * therefore safe to call at any frequency.
 */
class SubscriptionSweep
{
    public function __construct(private SubscriptionLifecycle $lifecycle, private PaymentService $payments)
    {
    }

    /**
     * Expire every past-due subscription and promote any scheduled successor.
     * Returns the number of rows actually transitioned by THIS run.
     */
    public function run(?Carbon $now = null): int
    {
        $now ??= Carbon::now();
        $expired = 0;
        $payments = $this->payments;

        // The predicate AND the per-row transition live in SubscriptionLifecycle
        // so this sweep and the lazy read path (FeatureGate) can never disagree
        // about what "expired" means or what the owner is told.
        SubscriptionLifecycle::applyPastDue(
            Subscription::with('business:id,user_id,name', 'plan:id,name'),
            $now,
        )
            ->chunkById(100, function ($subscriptions) use (&$expired, $now, $payments): void {
                foreach ($subscriptions as $subscription) {
                    if ($this->lifecycle->markExpired($subscription)) {
                        $expired++;
                    }

                    $business = $subscription->business;
                    if ($business === null) {
                        continue;
                    }

                    // DOWNGRADE PROMOTION: a paid scheduled subscription waiting
                    // behind the row we just settled becomes active now (the
                    // lazy path in FeatureGate is the correctness guarantee; this
                    // is the batch safety net).
                    $promoted = $payments->promoteDueScheduled($business, $now);
                    if ($promoted !== null && $promoted->business?->user_id) {
                        InternalNotification::firstOrCreate(
                            [
                                'user_id' => $promoted->business->user_id,
                                'type' => 'subscription_scheduled_activated',
                                'related_type' => Subscription::class,
                                'related_id' => $promoted->id,
                            ],
                            [
                                'title' => 'پلن جدید فعال شد',
                                'message' => "پلن زمان‌بندی‌شده {$promoted->plan_name} برای کسب‌وکار {$promoted->business->name} فعال شد.",
                            ],
                        );
                    }
                }
            });

        return $expired;
    }

    /** Does ANY subscription in the installation need settlement right now? */
    public function hasAnyDue(?Carbon $now = null): bool
    {
        $now ??= Carbon::now();

        return SubscriptionLifecycle::applyPastDue(Subscription::query(), $now)->exists();
    }
}
