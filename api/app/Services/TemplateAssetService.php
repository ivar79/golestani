<?php

namespace App\Services;

use App\Models\TemplateAsset;
use Illuminate\Http\UploadedFile;
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
 */
class TemplateAssetService
{
    public const DISK = 'public';

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
        'max:' . self::MAX_KILOBYTES,
        'dimensions:max_width=6000,max_height=6000',
    ];

    /** Register an already-on-disk file (import command path). */
    public static function register(string $relativePath, string $scope, ?int $ownerId, string $mime): TemplateAsset
    {
        $info = @getimagesize(Storage::disk(self::DISK)->path($relativePath));

        return TemplateAsset::updateOrCreate(
            ['path' => $relativePath],
            [
                'scope' => $scope,
                'owner_id' => $ownerId,
                'mime' => $mime,
                'width' => is_array($info) ? (int) $info[0] : 0,
                'height' => is_array($info) ? (int) $info[1] : 0,
                'bytes' => (int) Storage::disk(self::DISK)->size($relativePath),
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

        $folder = $scope === 'personal' || $scope === 'submission'
            ? "templates/users/{$ownerId}"
            : 'templates/uploaded';

        // Server-generated immutable filename with a version suffix; masters
        // are never overwritten.
        $name = 'art-' . bin2hex(random_bytes(8)) . '-v1.' . $ext;
        $relative = $file->storeAs($folder, $name, self::DISK);
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
        return '/storage/' . $path;
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
}
