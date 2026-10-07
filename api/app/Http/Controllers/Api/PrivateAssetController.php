<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TemplateAssetService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * OWNERSHIP-CHECKED serving of PRIVATE template assets.
 *
 * The public media proxy refuses the templates/users/ namespace entirely —
 * knowing a private path (or its id) must never be enough. This endpoint is
 * the ONLY door: authenticated, and only for assets whose registry row is
 * scoped personal|submission AND owned by the requester (admin passes).
 *
 * The files themselves live on the PRIVATE disk (TemplateAssetService::
 * PRIVATE_DISK), which is not linked into public/ and has no static route —
 * so even a request that bypasses this controller cannot read them (audit
 * finding `private-template-asset-public-disk`).
 */
class PrivateAssetController extends Controller
{
    public function show(Request $request, string $path): StreamedResponse
    {
        // Canonical form only: no duplicate slashes, no backslashes, no
        // percent-encoded traversal. `resolve()` already refuses `..` and any
        // namespace outside templates/; this rejects look-alike paths so they
        // can never be normalized into a valid one by a downstream layer.
        abort_if(preg_match('#[\\\\]|//|%2e|%2f#i', $path) === 1, 404, 'فایل یافت نشد.');

        $asset = TemplateAssetService::resolve(
            'storage/'.$path,
            ['personal', 'submission'],
            (int) $request->user()?->id
        );
        abort_if($asset === null, 404, 'فایل یافت نشد.');

        // Defense in depth: a `system` (public) row can never be served from
        // here, and a private row can never be served from the public disk.
        abort_unless(TemplateAssetService::isPrivateScope($asset->scope), 404, 'فایل یافت نشد.');
        abort_unless(TemplateAssetService::isPrivatePath($asset->path), 404, 'فایل یافت نشد.');

        $disk = Storage::disk(TemplateAssetService::diskFor($asset->scope));
        abort_unless($disk->exists($asset->path), 404, 'فایل یافت نشد.');

        return $disk->response($asset->path, null, [
            'Content-Type' => $asset->mime,
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
