<?php

namespace App\Services;

use App\Models\TemplateAsset;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Template asset pipeline: upload → verify → register → reference.
 *
 * SECURITY CONTRACT:
 *   - Extension allowlist AND real content inspection (getimagesize) — a
 *     renamed .exe or a polyglot never registers, whatever its extension.
 *   - Filenames are SERVER-GENERATED; client names never touch the disk.
 *   - Size ≤ 5MB, dimensions ≤ 6000px (mirrors BusinessMedia rules).
 *   - Every stored file gets an IMMUTABLE registry row; the registry is the
 *     canonical authority template validators resolve `src` against. Rows
 *     are never deleted — deleting a template never deletes an asset an
 *     existing card may still reference (Asset lifecycle ≠ Template lifecycle).
 *   - Masters are preserved untouched; optimized/thumbnail derivatives carry
 *     a version suffix and are never overwritten.
 *
 * STORAGE LOCATION (audit finding `private-template-asset-public-disk`):
 *   Scope decides the DISK, not just the folder.
 *
 *     system      → the web-served `public` disk (intentionally public).
 *     personal    → the PRIVATE disk, never linked into public/ and never
 *     submission    reachable through a static URL. Reads go through the
 *                   ownership-checked PrivateAssetController or, for an
 *                   APPROVED gallery submission, through the published copy
 *                   created by publishSubmissionAssets().
 *
 *   Publishing is an explicit, admin-driven, idempotent step that runs AFTER
 *   moderation approves a designer template — so review-stage artwork is
 *   never publicly readable, and a filesystem problem can never roll back or
 *   block a moderation decision (retry with `template-assets:publish`).
 */
class TemplateAssetService
{
    /** The web-served disk: system artwork that is public by design. */
    public const DISK = 'public';

    /** Private disk for personal/submission artwork (no storage:link target). */
    public const PRIVATE_DISK = 'template_assets';

    /** Scopes whose files may NEVER be publicly reachable without publication. */
    public const PRIVATE_SCOPES = ['personal', 'submission'];

    /** Path namespace owned by private scopes. */
    public const PRIVATE_PATH_PREFIX = 'templates/users/';

    /** Public URL prefixes accepted in documents (the /api/media proxy contract). */
    public const SRC_PREFIXES = ['storage/templates/', '/storage/templates/'];

    private const ALLOWED = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
    ];

    public const MAX_KILOBYTES = 5120;

    /** Laravel validation rules mirroring the storeUpload contract. */
    public const UPLOAD_RULES = [
        'file', 'image', 'mimes:jpg,jpeg,png,webp',
        'mimetypes:image/jpeg,image/png,image/webp',
        'max:'.self::MAX_KILOBYTES,
        'dimensions:max_width=6000,max_height=6000',
    ];

    /** Does this scope live on the private disk? */
    public static function isPrivateScope(string $scope): bool
    {
        return in_array($scope, self::PRIVATE_SCOPES, true);
    }

    /** The disk a scope's files live on (the ONLY place scope→disk is decided). */
    public static function diskFor(string $scope): string
    {
        return self::isPrivateScope($scope) ? self::PRIVATE_DISK : self::DISK;
    }

    /** Is this registry path inside the private namespace? */
    public static function isPrivatePath(string $path): bool
    {
        return str_starts_with(ltrim($path, '/'), self::PRIVATE_PATH_PREFIX);
    }

    /** Register an already-on-disk file (import command path). */
    public static function register(string $relativePath, string $scope, ?int $ownerId, string $mime): TemplateAsset
    {
        $disk = self::diskFor($scope);
        $info = @getimagesize(Storage::disk($disk)->path($relativePath));

        return TemplateAsset::updateOrCreate(
            ['path' => $relativePath],
            [
                'scope' => $scope,
                'owner_id' => $ownerId,
                'mime' => $mime,
                'width' => is_array($info) ? (int) $info[0] : 0,
                'height' => is_array($info) ? (int) $info[1] : 0,
                'bytes' => (int) Storage::disk($disk)->size($relativePath),
            ]
        );
    }

    /**
     * Store + verify + register an uploaded file for a template write path.
     *
     * @return TemplateAsset the registry row; its `path` is what design_json
     *                       references (as /storage/{path}).
     */
    public static function storeUpload(UploadedFile $file, string $scope, int $ownerId): TemplateAsset
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: '');
        abort_unless(array_key_exists($ext, self::ALLOWED), 422, 'فرمت تصویر مجاز نیست (PNG/JPG/WebP).');
        abort_unless($file->isValid(), 422, 'فایل آپلودی نامعتبر است.');
        abort_unless($file->getSize() <= self::MAX_KILOBYTES * 1024, 422, 'حجم تصویر بیش از ۵ مگابایت است.');

        // Real content check: getimagesize decodes the actual image header.
        $info = @getimagesize($file->getRealPath());
        abort_if($info === false, 422, 'محتوای فایل یک تصویر معتبر نیست.');
        abort_unless(in_array($info['mime'], self::ALLOWED, true), 422, 'نوع واقعی تصویر مجاز نیست.');
        abort_unless($info[0] > 0 && $info[0] <= 6000 && $info[1] > 0 && $info[1] <= 6000, 422, 'ابعاد تصویر بیش از ۶۰۰۰ پیکسل است.');

        // SVG or any non-raster can never arrive here: the extension + real
        // mime allowlist excludes it (user-controlled SVG is never served).

        $folder = self::isPrivateScope($scope)
            ? self::PRIVATE_PATH_PREFIX.$ownerId
            : 'templates/uploaded';

        // Server-generated immutable filename with a version suffix; masters
        // are never overwritten.
        $name = 'art-'.bin2hex(random_bytes(8)).'-v1.'.$ext;
        // Private scopes go to the private disk — a static /storage URL for a
        // personal/submission file simply does not exist (root cause fix).
        $relative = $file->storeAs($folder, $name, self::diskFor($scope));
        abort_if($relative === false, 500, 'ذخیره تصویر قالب ناموفق بود.');

        return self::register($relative, $scope, $ownerId, self::ALLOWED[$ext]);
    }

    /**
     * Normalize a document `src` to the registry path form (or null).
     * The registry path KEEPS its templates/ prefix (e.g.
     * templates/users/42/art-…-v1.png) — only the storage/ URL prefix and a
     * leading slash are stripped.
     */
    public static function pathFromSrc(string $src): ?string
    {
        $candidate = ltrim($src, '/');
        if (! str_starts_with($candidate, 'storage/templates/')) {
            return null;
        }

        return substr($candidate, strlen('storage/'));
    }

    /** Public src form for a registry path (used when building documents). */
    public static function srcForPath(string $path): string
    {
        return '/storage/'.$path;
    }

    /**
     * Resolve an image src against the registry.
     *
     * @param  list<string>  $allowedScopes
     * @param  int|null  $ownerId  required for personal/submission scopes
     */
    public static function resolve(?string $src, array $allowedScopes, ?int $ownerId): ?TemplateAsset
    {
        if ($src === null || $src === '') {
            return null;
        }
        $path = self::pathFromSrc($src);
        if ($path === null || str_contains($path, '..')) {
            return null;
        }

        // Path namespace is defense in depth; the REGISTRY is the boundary.
        // Only the templates/** namespace is even eligible for resolution.
        if (! str_starts_with($path, 'templates/')) {
            return null;
        }

        $asset = TemplateAsset::query()->where('path', $path)->first();
        if ($asset === null || ! in_array($asset->scope, $allowedScopes, true)) {
            return null;
        }
        if ($asset->scope !== 'system' && $ownerId !== null && (int) $asset->owner_id !== $ownerId) {
            return null; // not yours — whatever you know about the path
        }

        return $asset;
    }

    /**
     * Every registry path referenced by image layers of a stored document.
     *
     * @return list<string>
     */
    public static function imagePathsFromDesign(?string $designJson): array
    {
        if ($designJson === null || $designJson === '') {
            return [];
        }
        $decoded = json_decode($designJson, true);
        if (! is_array($decoded) || ! isset($decoded['layers']) || ! is_array($decoded['layers'])) {
            return [];
        }

        $paths = [];
        foreach ($decoded['layers'] as $layer) {
            if (! is_array($layer) || ($layer['kind'] ?? null) !== 'image') {
                continue;
            }
            $src = $layer['src'] ?? null;
            if (! is_string($src)) {
                continue;
            }
            $path = self::pathFromSrc($src);
            if ($path !== null) {
                $paths[] = $path;
            }
        }

        return array_values(array_unique($paths));
    }

    /**
     * Publish the `submission` artwork referenced by an APPROVED template.
     *
     * Copies each referenced submission asset from the private disk onto the
     * public disk at the SAME relative path (so the document `src`, the
     * registry row and every already-rendered card keep resolving unchanged),
     * then verifies the copy. It is:
     *
     *   - idempotent: an asset already published is skipped;
     *   - non-destructive: the private master is NEVER deleted, so the owner's
     *     authorized endpoint keeps working and a retry is always possible;
     *   - scope-safe: personal assets are never published (skipped), and
     *     system assets are already public (skipped);
     *   - failure-safe: nothing throws. Assets whose source is missing or
     *     whose copy did not verify are returned as `unpublished` so the state
     *     stays detectable and retryable (`php artisan template-assets:publish`).
     *
     * @return array{published: list<string>, unpublished: list<string>, already: int, skipped: int}
     */
    public static function publishSubmissionAssets(?string $designJson): array
    {
        $result = ['published' => [], 'unpublished' => [], 'already' => 0, 'skipped' => 0];

        foreach (self::imagePathsFromDesign($designJson) as $path) {
            $asset = TemplateAsset::query()->where('path', $path)->first();
            if ($asset === null) {
                // Unregistered path: the template validator refuses these, so
                // this is data drift, not a publication candidate.
                $result['unpublished'][] = $path;

                continue;
            }
            if ($asset->scope !== 'submission') {
                // personal → stays private forever; system → already public.
                $result['skipped']++;

                continue;
            }
            if (Storage::disk(self::DISK)->exists($path)) {
                $result['already']++;

                continue;
            }
            if (! Storage::disk(self::PRIVATE_DISK)->exists($path)) {
                $result['unpublished'][] = $path;

                continue;
            }

            try {
                $stream = Storage::disk(self::PRIVATE_DISK)->readStream($path);
                if ($stream === null) {
                    $result['unpublished'][] = $path;

                    continue;
                }
                Storage::disk(self::DISK)->writeStream($path, $stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }

                // Verify BEFORE reporting success (callers may surface this).
                if (! Storage::disk(self::DISK)->exists($path)) {
                    $result['unpublished'][] = $path;

                    continue;
                }
            } catch (\Throwable $e) {
                // Object-store hiccup: approval must never fail because of it.
                Log::warning('template.asset_publish_failed', ['path' => $path, 'error' => $e->getMessage()]);
                $result['unpublished'][] = $path;

                continue;
            }

            $result['published'][] = $path;
        }

        return $result;
    }
}
