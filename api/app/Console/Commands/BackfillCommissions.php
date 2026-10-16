<?php

namespace App\Console\Commands;

use App\Models\PaymentTransaction;
use App\Models\Subscription;
use App\Models\WalletTransaction;
use App\Services\Wallet\CommissionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * `commissions:backfill` — rebuild designer commissions that were never
 * written.
 *
 * WHY IT EXISTS: accrual runs at payment confirmation and is wrapped in
 * `accrueQuietly()`, so a commission problem NEVER rolls back the activation
 * it accompanies. That is the right trade-off for money that reached the
 * platform, but it means a failed accrual leaves no trace on the
 * subscription — only in the log. This command is the repair path.
 *
 * IDEMPOTENT BY CONSTRUCTION: it replays every CONFIRMED purchase event
 * through the same service that accrues them, and the ledger's unique
 * idempotency key turns an already-paid event into a no-op. Running it twice
 * (or ten times) can never double-pay.
 *
 * PURCHASE EVENTS replayed here:
 *   - online: every `paid` payment_transaction (the event key is the payment)
 *   - manual: every subscription an admin actually activated (started_at set,
 *     not rejected) — its row IS the receipt-confirmed purchase
 *
 * `--dry-run` reports what WOULD be created without writing anything.
 */
class BackfillCommissions extends Command
{
    protected $signature = 'commissions:backfill {--dry-run : فقط گزارش کن و چیزی ثبت نکن} {--chunk=200}';

    protected $description = 'بازسازی پورسانت‌های جاافتادهٔ طراحان از روی خریدهای تأییدشده (ایدمپوتنت)';

    public function handle(CommissionService $commissions): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunk = max(1, (int) $this->option('chunk'));

        $stats = ['created' => 0, 'already' => 0, 'ineligible' => 0, 'skipped' => 0, 'failed' => 0];
        $reasons = [];

        $count = function (string $reason) use (&$reasons): void {
            $reasons[$reason] = ($reasons[$reason] ?? 0) + 1;
        };

        // ---- 1. Online payments -----------------------------------------
        PaymentTransaction::query()
            ->where('status', PaymentTransaction::STATUS_PAID)
            ->with(['subscription.plan', 'subscription.business.designer', 'user'])
            ->orderBy('id')
            ->chunkById($chunk, function ($payments) use ($commissions, $dryRun, &$stats, $count): void {
                foreach ($payments as $payment) {
                    $subscription = $payment->subscription;
                    if ($subscription === null) {
                        $stats['skipped']++;
                        $count('payment_without_subscription');

                        continue;
                    }

                    $this->process($commissions, $subscription, $payment, $dryRun, $stats, $count);
                }
            });

        // ---- 2. Manual (receipt) subscriptions --------------------------
        // Subscriptions whose money came through the gateway are EXCLUDED: their
        // purchase event is the payment replayed above, and replaying them here
        // under the order key would pay the same purchase twice.
        Subscription::query()
            ->whereNotIn('id', PaymentTransaction::query()
                ->whereNotNull('subscription_id')
                ->where('status', PaymentTransaction::STATUS_PAID)
                ->select('subscription_id'))
            ->whereNotNull('started_at')
            // A rejected receipt never became a purchase; an expired one did
            // (it simply ran out of time), so it is replayed too.
            ->where('status', '!=', 'rejected')
            ->with(['plan', 'business.designer'])
            ->orderBy('id')
            ->chunkById($chunk, function ($subscriptions) use ($commissions, $dryRun, &$stats, $count): void {
                foreach ($subscriptions as $subscription) {
                    $this->process($commissions, $subscription, null, $dryRun, $stats, $count);
                }
            });

        $this->newLine();
        $this->table(['نتیجه', 'تعداد'], [
            ['ثبت‌شده', $stats['created'].($dryRun ? ' (شبیه‌سازی)' : '')],
            ['قبلاً ثبت‌شده', $stats['already']],
            ['واجد شرایط نبود', $stats['ineligible']],
            ['بدون رویداد خرید', $stats['skipped']],
            ['خطا', $stats['failed']],
        ]);

        if ($reasons !== []) {
            $this->line('دلایل عدم ثبت:');
            foreach ($reasons as $reason => $amount) {
                $this->line("  - {$reason}: {$amount}");
            }
        }

        if ($dryRun) {
            $this->warn('حالت شبیه‌سازی: هیچ ردیفی در دفتر کل نوشته نشد.');
        }

        return self::SUCCESS;
    }

    /** Accrue one purchase event, or explain why it does not qualify. */
    private function process(
        CommissionService $commissions,
        Subscription $subscription,
        ?PaymentTransaction $payment,
        bool $dryRun,
        array &$stats,
        callable $count,
    ): void {
        try {
            $quote = $commissions->quote($subscription, $payment);

            if (! $quote['eligible']) {
                $stats['ineligible']++;
                $count($quote['reason']);

                return;
            }

            if (WalletTransaction::query()->where('idempotency_key', $quote['key'])->exists()) {
                $stats['already']++;

                return;
            }

            if ($dryRun) {
                $stats['created']++;

                return;
            }

            $row = $commissions->accrueQuietly($subscription, $payment);

            if ($row === null) {
                $stats['failed']++;
                $count('accrual_returned_null');

                return;
            }

            $stats['created']++;
        } catch (Throwable $e) {
            // One bad row must not stop the repair of the others.
            $stats['failed']++;
            $count('exception: '.$e::class);
            Log::error('wallet.commission.backfill_row_failed', [
                'subscription_id' => $subscription->id,
                'payment_transaction_id' => $payment?->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
