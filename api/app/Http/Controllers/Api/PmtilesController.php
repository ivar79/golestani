<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * PmtilesController — static-file serving for the single-file PMTiles archive
 * (Phase 1 of the PMTiles migration).
 *
 * PMTiles needs HTTP byte ranges: the client reads a fixed-size header, then
 * a compact JSON directory, then 16–32 KB tile chunks — all with Range
 * requests. PHP-CGI cannot pass through Range headers on static files, so a
 * route → Laravel handler is the portable answer (same trick as the old
 * `.htaccess` passthrough, but visible in code and deployable to Railway).
 *
 * GET /api/map/pmtiles — full file or one 206 slice per Range request.
 *
 * Safety: the path comes exclusively from config (services.mbtiles_path /
 * PMTILES_PATH); no user input ever reaches the filesystem. Public like the
 * other /map endpoints — the archive is open ODbL derivative data.
 */
final class PmtilesController extends Controller
{
    /** 512-byte PMTiles v3 header: magic, version, offsets, lengths. */
    private const HEADER_BYTES = 512;

    public function show(): Response
    {
        $path = (string) config('services.pmtiles_path', '');

        if ($path === '' || !is_file($path)) {
            abort(404, 'PMTiles archive is not configured or missing');
        }

        $size  = (int) filesize($path);
        $mtime = (int) filemtime($path);
        $etag  = '"pmtiles-'.md5("{$path}|{$size}|{$mtime}").'"';

        $headers = [
            'Content-Type'  => 'application/vnd.pmtiles+v2.0',
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'public, max-age=3600',
            'ETag'          => $etag,
            'Access-Control-Allow-Origin'      => '*',
            'Access-Control-Allow-Methods'     => 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers'     => 'Range, Origin, Accept, Content-Type',
            'Access-Control-Expose-Headers'    => 'Accept-Ranges, Content-Range, Content-Length, ETag',
        ];

        // Conditional GET: browser/canvas caches may hold a full copy.
        if (request()->header('If-None-Match') === $etag) {
            return response('', 304, $headers);
        }

        $range = (string) request()->header('Range', '');

        // No Range header (or an unsupported unit) → answer with the whole file.
        if ($range === '' || !str_starts_with($range, 'bytes=')) {
            return response()->file($path, $headers);
        }

        // Normalize the "bytes=…" specification exactly as the protomaps client
        // produces it — a single absolute or suffix range, no lists.
        $spec = trim(explode(',', substr($range, 6))[0]);
        $spec = preg_replace('/-bytes$/', '', $spec) ?? $spec;

        // Suffix range: "bytes=-N" → the last N bytes.
        if ($spec !== '' && $spec[0] === '-') {
            $length = (int) substr($spec, 1);
            if ($length <= 0 || $length === 0 && $spec !== '-0') {
                return $this->rangeNotSatisfiable($size, $headers);
            }
            $length = min($length, $size);
            return $this->slice($path, $size - $length, $length, $size, $headers);
        }

        // Absolute range: "bytes=A-B" (B optional → open-ended).
        if (!preg_match('/^(\d+)(?:-(\d*))?$/', $spec, $m)) {
            return $this->rangeNotSatisfiable($size, $headers);
        }

        $start = (int) $m[1];
        $end   = isset($m[2]) && $m[2] !== '' ? min((int) $m[2], $size - 1) : $size - 1;

        if ($start > $end || $start >= $size) {
            return $this->rangeNotSatisfiable($size, $headers);
        }

        return $this->slice($path, $start, $end - $start + 1, $size, $headers);
    }

    /** One 206 slice, streamed in 1 MB chunks so memory stays flat. */
    private function slice(string $path, int $start, int $length, int $size, array $headers): StreamedResponse
    {
        $headers['Content-Range'] = "bytes {$start}-".($start + $length - 1)."/{$size}";

        return response()->stream(function () use ($path, $start, $length): void {
            if (ob_get_level() > 0) {
                ob_end_flush();
            }
            $fh = fopen($path, 'rb');
            if ($fh === false) {
                return;
            }
            try {
                fseek($fh, $start);
                $remaining = $length;
                $chunk = 1024 * 1024;
                while ($remaining > 0 && !feof($fh)) {
                    $data = fread($fh, min($chunk, $remaining));
                    if ($data === false || $data === '') {
                        break;
                    }
                    echo $data;
                    flush();
                    $remaining -= strlen($data);
                }
            } finally {
                fclose($fh);
            }
        }, 206, $headers);
    }

    private function rangeNotSatisfiable(int $size, array $headers): BinaryFileResponse|Response
    {
        $headers['Content-Range'] = "bytes */{$size}";

        return response('', 416, $headers);
    }
}
