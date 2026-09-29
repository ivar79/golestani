<?php

namespace App\Console\Commands;

use App\Models\Subscription;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * One-time, idempotent maintenance command: migrates receipt files from the
 * public disk to the PRIVATE receipts disk.
 *
 * Deployment notes:
 *   - Run once after deploying the private-receipts code: php artisan receipts:move-to-private
 *   - Safe to re-run: already-migrated rows are skipped; missing source files
 *     are logged and skipped (never fatal); re-transfers delete any stray
 *     public copy so the public URL can never keep working.
 *   - Intentionally NOT part of a database migration: a filesystem outage or
 *     read-only deployment volume must never block schema changes.
 */
class MoveReceiptsToPrivateDisk extends Command
{
    protected $signature = 'receipts:move-to-private {--dry-run : Report without changing anything}';

    protected $description = 'Move subscription receipt files from the public disk to the private receipts disk (idempotent).';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $moved = 0;
        $missing = 0;
        $skipped = 0;

        Subscription::whereNotNull('receipt_path')
            ->where('receipt_path', '!=', '')
            ->orderBy('id')
            ->each(function (Subscription $subscription) use (&$moved, &$missing, &$skipped, $dryRun): void {
                $path = (string) $subscription->receipt_path;

                // Idempotency marker: new-format paths live under receipts/.
                if (str_starts_with($path, 'receipts/')) {
                    if (Storage::disk('receipts')->exists($path)) {
                        $skipped++;

                        return;
                    }
                    // receipts/ path recorded but file absent: let the download
                    // endpoint handle the graceful 404; nothing to migrate.
                    $this->line("[missing-private] sub #{$subscription->id}: {$path}");
                    $missing++;

                    return;
                }

                // Legacy public-disk path (e.g. subscriptions/receipts/xxx.pdf).
                if (! Storage::disk('public')->exists($path)) {
                    $this->line("[missing-public] sub #{$subscription->id}: {$path} — skipped (download will 404 gracefully)");
                    $missing++;

                    return;
                }

                $target = 'receipts/'.basename($path);

                if ($dryRun) {
                    $this->line("[dry-run] sub #{$subscription->id}: {$path} -> {$target}");
                    $moved++;

                    return;
                }

                $stream = Storage::disk('public')->readStream($path);
                abort_if($stream === null, 1, "Cannot read {$path}");
                // writeStream (not putStream): the adapter's underlying driver
                // expects writeStream for writing a resource.
                Storage::disk('receipts')->writeStream($target, $stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }

                // Verify BEFORE deleting the public copy (no data loss window).
                if (! Storage::disk('receipts')->exists($target)) {
                    $this->error("[failed] sub #{$subscription->id}: copy to private disk failed — public file kept");

                    return;
                }

                Storage::disk('public')->delete($path);
                $subscription->forceFill(['receipt_path' => $target])->save();
                $moved++;
                $this->line("[moved] sub #{$subscription->id}: {$path} -> {$target}");
            });

        $this->info("Done. moved={$moved} skipped={$skipped} missing={$missing}".($dryRun ? ' (dry-run — nothing changed)' : ''));

        return self::SUCCESS;
    }
}
