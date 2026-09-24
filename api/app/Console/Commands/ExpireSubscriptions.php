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
            ->whereNotNull('end_date')
            ->whereDate('end_date', '<', $today)
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
                }
            });

        $this->info("Expired {$expired} subscription(s).");
        return self::SUCCESS;
    }
}
