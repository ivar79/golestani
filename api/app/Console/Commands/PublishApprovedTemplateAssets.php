<?php

namespace App\Console\Commands;

use App\Models\CardTemplate;
use App\Models\TemplateAsset;
use App\Services\TemplateAssetService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Idempotent, retryable publication of the `submission` artwork referenced by
 * APPROVED templates.
 *
 * Approval already publishes the artwork of a newly approved submission; this
 * command exists for everything else:
 *
 *   - BACKFILL after deploying the private-disk fix: run
 *       php artisan template-assets:move-to-private
 *       php artisan template-assets:publish
 *     so templates approved BEFORE the fix keep rendering in the gallery.
 *   - RETRY when an approval-time copy was interrupted (object-store hiccup):
 *     the moderation response reports `publication.unpublished_count`, and
 *     this command is the retry path.
 *   - AUDIT with --dry-run: lists exactly which approved templates still have
 *     unpublished artwork, without changing anything.
 *
 * Safety:
 *   - Only scope=submission assets are ever copied; personal artwork stays
 *     private forever and system artwork is already public.
 *   - Pending/rejected/archived templates are never touched (approved only).
 *   - The private master is never deleted.
 *   - Exit code is FAILURE when something could not be published, so a retry
 *     is detectable in automation.
 */
class PublishApprovedTemplateAssets extends Command
{
    protected $signature = 'template-assets:publish {--dry-run : Report without copying anything}';

    protected $description = 'Publish submission artwork referenced by approved templates (idempotent, retryable).';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $templates = CardTemplate::query()
            ->where('status', 'approved')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get();

        $published = 0;
        $already = 0;
        $skipped = 0;
        $unpublished = [];

        foreach ($templates as $template) {
            $designJson = is_string($template->design_json)
                ? $template->design_json
                : json_encode($template->design_json);

            if ($dryRun) {
                foreach (TemplateAssetService::imagePathsFromDesign($designJson) as $path) {
                    $asset = TemplateAsset::query()->where('path', $path)->first();
                    if ($asset === null || $asset->scope !== 'submission') {
                        $skipped++;

                        continue;
                    }
                    if (Storage::disk(TemplateAssetService::DISK)->exists($path)) {
                        $already++;

                        continue;
                    }
                    $this->line("[dry-run] template #{$template->id} ({$template->slug}) would publish {$path}");
                    $published++;
                }

                continue;
            }

            $result = TemplateAssetService::publishSubmissionAssets($designJson);
            $published += count($result['published']);
            $already += $result['already'];
            $skipped += $result['skipped'];

            foreach ($result['published'] as $path) {
                $this->line("[published] template #{$template->id} ({$template->slug}): {$path}");
            }
            foreach ($result['unpublished'] as $path) {
                $unpublished[] = $path;
                $this->error("[unpublished] template #{$template->id} ({$template->slug}): {$path} — still private, retry after checking the private disk");
            }
        }

        $this->info(sprintf(
            'Done. templates=%d published=%d already=%d skipped=%d unpublished=%d',
            $templates->count(), $published, $already, $skipped, count($unpublished)
        ).($dryRun ? ' (dry-run — nothing changed)' : ''));

        return $unpublished === [] ? self::SUCCESS : self::FAILURE;
    }
}
