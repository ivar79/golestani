<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Optimize the source artwork (masters, dropped into
 * storage/templates/master by the maintainer) into the editor derivatives:
 *
 *   templates/optimized/<name>-v1.webp   1050×600  (document src target)
 *   templates/thumbnails/<name>-v1.webp  420px wide (gallery thumbnails)
 *
 * Masters are NEVER touched or overwritten; derivatives are versioned
 * (running with --v2 produces -v2 files so older documents keep resolving
 * their -v1 references — the immutable-asset contract).
 *
 * GD (present in the api container) does the resize; the encoder prefers
 * WebP and falls back to high-quality JPEG when the GD build lacks WebP
 * support (the deployed container's GD does). No new dependency is added.
 */
class OptimizeTemplateArt extends Command
{
    protected $signature = 'templates:optimize-art
        {--v=1 : Version suffix for the generated derivatives}
        {--force : Re-generate even if the derivative exists}';

    protected $description = 'Generate optimized/thumbnail WebP derivatives from template master artwork';

    private const TARGET_W = 1050;

    private const TARGET_H = 600;

    private const THUMB_W = 420;

    private const QUALITY = 82;

    public function handle(): int
    {
        $version = max(1, (int) $this->option('v'));
        $disk = Storage::disk('public');
        $masters = $disk->files('templates/master');
        if ($masters === []) {
            $this->warn('No master artwork found in storage/templates/master.');

            return self::SUCCESS;
        }

        $made = 0;
        foreach ($masters as $master) {
            $name = pathinfo($master, PATHINFO_FILENAME);
            $ext = function_exists('imagewebp') ? 'webp' : 'jpg';
            $optPath = "templates/optimized/{$name}-v{$version}.{$ext}";
            $thumbPath = "templates/thumbnails/{$name}-v{$version}.{$ext}";

            if (! $this->option('force') && $disk->exists($optPath) && $disk->exists($thumbPath)) {
                $this->line("skip {$name} (exists)");
                continue;
            }

            $data = $disk->get($master);
            $img = @imagecreatefromstring($data);
            if ($img === false) {
                $this->error("unreadable master: {$master}");
                continue;
            }

            $this->cover($img, self::TARGET_W, self::TARGET_H);
            $disk->put($optPath, $this->encode($img));

            $this->cover($img, self::THUMB_W, (int) round(self::THUMB_W * self::TARGET_H / self::TARGET_W));
            $disk->put($thumbPath, $this->encode($img));

            imagedestroy($img);
            $kb = (int) round(strlen((string) $disk->get($optPath)) / 1024);
            $this->info("{$name}: optimized ({$kb}KB) + thumbnail");
            $made++;
        }

        $this->info("{$made} derivative set(s) generated. Run php artisan templates:import to register them.");

        return self::SUCCESS;
    }

    /** Encode with the best available GD encoder; the extension follows. */
    private function encode(\GdImage $img): string
    {
        ob_start();
        if (function_exists('imagewebp')) {
            imagewebp($img, null, self::QUALITY);
        } else {
            imagejpeg($img, null, self::QUALITY);
        }

        return (string) ob_get_clean();
    }

    /** Center-crop + resize to exactly cover the target box. */
    private function cover(\GdImage $img, int $targetW, int $targetH): void
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = max($targetW / $w, $targetH / $h);
        $cropW = (int) round($targetW / $scale);
        $cropH = (int) round($targetH / $scale);
        $srcX = (int) (($w - $cropW) / 2);
        $srcY = (int) (($h - $cropH) / 2);

        $out = imagecreatetruecolor($targetW, $targetH);
        imagecopyresampled($out, $img, 0, 0, $srcX, $srcY, $targetW, $targetH, $cropW, $cropH);
        imagedestroy($img);
    }
}
