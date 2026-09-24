<?php

namespace App\Console\Commands;

use App\Models\BusinessCard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class MigratePrintFilesToPrivate extends Command
{
    /**
     * Phase 4 security: print files used to live on the public disk
     * (storage/app/public/cards/print_files/...). This one-shot command
     * moves every stored print file to the PRIVATE card_files disk and
     * rewrites the stored paths. Idempotent: files already on the private
     * disk are skipped, so re-running is safe.
     */
    protected $signature = 'cards:migrate-print-files {--dry-run : List what would be moved without changing anything}';

    protected $description = 'Move print files from the public disk to the private card_files disk and rewrite stored paths';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $public = Storage::disk('public');
        $private = Storage::disk('card_files');

        $cards = BusinessCard::whereNotNull('print_file_path')->get();
        if ($cards->isEmpty()) {
            $this->info('هیچ فایل چاپی ذخیره‌شده‌ای یافت نشد.');

            return self::SUCCESS;
        }

        $moved = 0;
        $alreadyPrivate = 0;
        $missing = 0;

        foreach ($cards as $card) {
            $path = (string) $card->print_file_path;

            if ($private->exists($path)) {
                $alreadyPrivate++;
                continue;
            }

            if (! $public->exists($path)) {
                $missing++;
                $this->warn("فایل یافت نشد: {$path} (کارت #{$card->id})");
                continue;
            }

            if ($dryRun) {
                $this->line("انتقال: {$path} (کارت #{$card->id})");
                $moved++;

                continue;
            }

            $stream = $public->readStream($path);
            try {
                $private->writeStream($path, $stream);
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }

            if ($private->exists($path)) {
                $public->delete($path);
                $moved++;
                $this->info("منتقل شد: {$path} (کارت #{$card->id})");
            } else {
                $this->error("نوشتن روی دیسک خصوصی ناموفق بود: {$path}");
            }
        }

        $this->table(
            ['نتیجه', 'تعداد'],
            [
                ['منتقل‌شده', $moved],
                ['از قبل خصوصی', $alreadyPrivate],
                ['مفقود روی دیسک عمومی', $missing],
            ]
        );

        return self::SUCCESS;
    }
}
