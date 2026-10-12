<?php

namespace App\Console\Commands;

use App\Services\SubscriptionSweep;
use Illuminate\Console\Command;

class ExpireSubscriptions extends Command
{
    protected $signature = 'subscriptions:expire';

    protected $description = 'Expire ended subscriptions and notify business owners';

    public function handle(SubscriptionSweep $sweep): int
    {
        // The actual transition logic lives in SubscriptionSweep so the artisan
        // sweep, the token-guarded HTTP trigger (POST /api/internal/cron/…)
        // and the lazy read path share ONE implementation (Phase 5 finding A).
        $expired = $sweep->run();

        $this->info("Expired {$expired} subscription(s).");

        return self::SUCCESS;
    }
}
