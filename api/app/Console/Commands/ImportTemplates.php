<?php

namespace App\Console\Commands;

use App\Models\TemplateAsset;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Publishes template artwork (optimized derivatives produced by the asset
 * pipeline) into public storage and registers every file in the ASSET
 * REGISTRY with scope=system.
 *
 * Masters live in storage/templates/master (never referenced by documents);
 * optimized/thumbnail derivatives are what design_json srcs point at —
 * always as stable `storage/templates/...` paths the validator and the
 * /api/media proxy already accept.
 */
class ImportTemplates extends Command
{
    protected $signature = 'templates:import {--fresh : Re-register all system assets}';

    protected $description = 'Register system template artwork into public storage and the asset registry';

    public function handle(): int
    {
        $disk = Storage::disk('public');
        $registered = 0;

        foreach (['optimized', 'thumbnails', 'uploaded'] as $folder) {
            foreach ($disk->allFiles("templates/{$folder}") as $relative) {
                if (str_contains($relative, '..')) {
                    continue;
                }
                $mime = $disk->mimeType($relative) ?: 'application/octet-stream';
                TemplateAsset::updateOrCreate(
                    ['path' => $relative],
                    [
                        'scope' => 'system',
                        'owner_id' => null,
                        'mime' => $mime,
                        'bytes' => (int) $disk->size($relative),
                        'width' => 0,
                        'height' => 0,
                    ]
                );
                $registered++;
            }
        }

        $this->info("Registered {$registered} system template asset(s) in the registry.");

        return self::SUCCESS;
    }
}
