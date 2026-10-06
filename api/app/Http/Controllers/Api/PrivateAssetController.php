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
 */
class PrivateAssetController extends Controller
{
    public function show(Request $request, string $path): StreamedResponse
    {
        $asset = TemplateAssetService::resolve(
            'storage/' . $path,
            ['personal', 'submission'],
            (int) $request->user()?->id
        );
        abort_if($asset === null, 404, 'فایل یافت نشد.');

        $disk = Storage::disk(TemplateAssetService::DISK);
        abort_unless($disk->exists($asset->path), 404, 'فایل یافت نشد.');

        return $disk->response($asset->path, null, [
            'Content-Type' => $asset->mime,
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
