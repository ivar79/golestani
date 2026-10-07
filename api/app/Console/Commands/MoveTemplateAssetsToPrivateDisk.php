<?php

namespace App\Console\Commands;

use App\Models\TemplateAsset;
use App\Services\TemplateAssetService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * One-time, idempotent maintenance command: moves LEGACY personal/submission
 * template artwork from the web-served public disk to the private disk.
 *
 * Deployment notes:
 *   - Run once after deploying this fix:
 *       php artisan template-assets:move-to-private
 *   - Then re-publish the artwork of already-approved designer templates:
 *       php artisan template-assets:publish
 *     (Approval publishes new submissions automatically; the two commands
 *     together close the hole for EXISTING data without touching the DB.)
 *   - Safe to re-run: rows already on the private disk are skipped; rows with
 *     a stray public copy get that copy removed; missing source files are
 *     reported and never fatal.
 *   - Verify-before-delete: the public file is deleted only after the private
 *     copy has been written AND confirmed to exist.
 *   - Intentionally NOT a database migration: a filesystem problem must never
 *     block schema changes.
 */
class MoveTemplateAssetsToPrivateDisk extends Command
{
    protected $signature = 'template-assets:move-to-private {--dry-run : Report without changing anything}';

    protected $description = 'Move personal/submission template artwork from the public disk to the private disk (idempotent).';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $public = Storage::disk(TemplateAssetService::DISK);
        $private = Storage::disk(TemplateAssetService::PRIVATE_DISK);

        $moved = 0;
        $skipped = 0;
        $missing = 0;

        TemplateAsset::query()
            ->whereIn('scope', TemplateAssetService::PRIVATE_SCOPES)
            ->orderBy('id')
            ->each(function (TemplateAsset $asset) use ($public, $private, $dryRun, &$moved, &$skipped, &$missing): void {
                $path = (string) $asset->path;

                // Only the private namespace is ours to relocate.
                if (! TemplateAssetService::isPrivatePath($path)) {
                    $this->line("[skip-namespace] asset #{$asset->id}: {$path}");
                    $skipped++;

                    return;
                }

                if (! $public->exists($path)) {
                    if ($private->exists($path)) {
                        $skipped++; // already migrated — the normal steady state

                        return;
                    }
                    $this->line("[missing-public] asset #{$asset->id}: {$path} — nothing to move");
                    $missing++;

                    return;
                }

                // A private copy already exists: the public one is a stray.
                if ($private->exists($path)) {
                    if ($dryRun) {
                        $this->line("[dry-run] asset #{$asset->id}: remove stray public copy {$path}");
                        $moved++;

                        return;
                    }
                    $public->delete($path);
                    $moved++;
                    $this->line("[public-copy-removed] asset #{$asset->id}: {$path}");

                    return;
                }

                if ($dryRun) {
                    $this->line("[dry-run] asset #{$asset->id}: {$path} → private disk");
                    $moved++;

                    return;
                }

                $stream = $public->readStream($path);
                if ($stream === null) {
                    $this->error("[failed] asset #{$asset->id}: cannot read {$path} — public copy kept");
                    $missing++;

                    return;
                }
                // writeStream (not putStream): the adapter's driver expects a
                // resource handle when streaming.
                $private->writeStream($path, $stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }

                // Verify BEFORE deleting the public copy (no data-loss window).
                if (! $private->exists($path)) {
                    $this->error("[failed] asset #{$asset->id}: private copy not verified — public file kept");
                    $missing++;

                    return;
                }

                $public->delete($path);
                $moved++;
                $this->line("[moved] asset #{$asset->id}: {$path}");
            });

        $this->info("Done. moved={$moved} skipped={$skipped} missing={$missing}".($dryRun ? ' (dry-run — nothing changed)' : ''));

        return self::SUCCESS;
    }
}
