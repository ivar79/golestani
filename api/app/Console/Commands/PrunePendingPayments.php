<?php

namespace App\Console\Commands;

use App\Models\PaymentTransaction;
use Illuminate\Console\Command;

/**
 * Recovery path: pending transactions older than the configured TTL can
 * never be safely activated (the gateway session is long gone), so they are
 * pruned to `expired`. Failure semantics: this NEVER touches paid/failed/
 * canceled rows and NEVER activates anything.
 */
class PrunePendingPayments extends Command
{
    protected $signature = 'payment:prune-pending {--hours= : Override the configured TTL in hours}';

    protected $description = 'Mark stale pending payment transactions as expired (no activation)';

    public function handle(): int
    {
        $hours = (int) ($this->option('hours') ?: config('zarinpal.pending_ttl_hours', 24));
        $cutoff = now()->subHours(max(1, $hours));

        $count = PaymentTransaction::where('status', PaymentTransaction::STATUS_PENDING)
            ->where('created_at', '<', $cutoff)
            ->update([
                'status' => PaymentTransaction::STATUS_EXPIRED,
                'failure_reason' => 'pending_ttl_exceeded',
            ]);

        $this->info("Expired {$count} stale pending transaction(s) older than {$hours}h.");

        return self::SUCCESS;
    }
}
