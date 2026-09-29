<?php

namespace App\Console\Commands;

use App\Models\InternalNotification;
use App\Models\Subscription;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class ExpireSubscriptions extends Command
{
    protected $signature = 'subscriptions:expire';

    protected $description = 'Expire ended subscriptions and notify business owners';

    public function handle(): int
    {
        $today = Carbon::today();
        $expired = 0;

        Subscription::with('business:id,user_id,name', 'plan:id,name')
            ->where('status', 'active')
            ->where(function ($q) use ($today): void {
                // Timestamp lifecycle: precise expiry sweep for rows that
                // carry expires_at (online payments + new admin activations).
                $q->where(function ($t): void {
                    $t->whereNotNull('expires_at')->where('expires_at', '<=', now());
                })
                // Legacy day-granular rows keep the old sweep rule.
                    ->orWhere(function ($d) use ($today): void {
                        $d->whereNull('expires_at')->whereNotNull('end_date')->whereDate('end_date', '<', $today);
                    });
            })
            ->chunkById(100, function ($subscriptions) use (&$expired): void {
                foreach ($subscriptions as $subscription) {
                    $subscription->update(['status' => 'expired']);
                    $business = $subscription->business;
                    if ($business?->user_id) {
                        InternalNotification::firstOrCreate(
                            [
                                'user_id' => $business->user_id,
                                'type' => 'subscription_expired',
                                'related_type' => Subscription::class,
                                'related_id' => $subscription->id,
                            ],
                            [
                                'title' => 'اشتراک منقضی شد',
                                'message' => "اشتراک {$subscription->plan?->name} برای کسب‌وکار {$business->name} منقضی شده است.",
                            ],
                        );
                    }
                    $expired++;

                    // DOWNGRADE PROMOTION: if a paid scheduled subscription is
                    // waiting behind the row we just expired, promote it now
                    // (safety net — the lazy path in FeatureGate already makes
                    // correctness independent of this cron).
                    $promoted = app(\App\Services\Payments\PaymentService::class)
                        ->promoteDueScheduled($business, now());
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

        $this->info("Expired {$expired} subscription(s).");

        return self::SUCCESS;
    }
}
