<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\MbtilesServer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;

/**
 * MapTileController — public vector-tile endpoint (pure PHP, zero Node.js).
 *
 * GET /api/map/tile/{z}/{x}/{y}[.mvt]
 *   Streams the gzip-compressed Mapbox Vector Tile from the Shortbread
 *   MBTiles archive. The bytes are passed through exactly as stored — no
 *   PHP-side decompression — so CPU cost per tile is a single indexed
 *   SQLite lookup plus a copy. `Content-Encoding: gzip` tells the client
 *   to decode transparently.
 *
 * GET /api/map/status
 *   Diagnostics for the admin "Map Infrastructure" tab and for the
 *   frontend's auto source-mode detection. Cached 60s.
 */
final class MapTileController extends Controller
{
    /** Tile payload magic numbers, used to detect broken/legacy archives. */
    private const GZIP_MAGIC = "\x1f\x8b";

    /** Max supported zoom — Shortbread 1.0 goes up to z14. */
    private const MAX_ZOOM = 14;

    public function tile(int $z, string $xIn, string $yIn): Response
    {
        // Tolerate "123.mvt" / "123.png" style extensions from raster-era clients.
        $x = (int) $xIn;
        $y = (int) $yIn;

        // Validate BEFORE any I/O: nothing user-supplied reaches SQL unvalidated.
        if ($z < 0 || $z > self::MAX_ZOOM || $x < 0 || $y < 0) {
            return response('', 404);
        }
        $max = 1 << $z;
        if ($x >= $max || $y >= $max) {
            return response('', 404);
        }

        try {
            // XYZ (slippy) → TMS (MBTiles) row flip.
            $tmsY = $max - 1 - $y;
            $blob = MbtilesServer::tile($z, $x, $tmsY);
        } catch (\Throwable) {
            // Archive missing/unreadable → let the frontend fall back online.
            return response('', 404);
        }

        if ($blob === null) {
            return response('', 404);
        }

        // Defensive: if an archive ever stores raw (uncompressed) MVT, do not
        // lie with a gzip header — serve it as-is instead.
        $isGzip = str_starts_with($blob, self::GZIP_MAGIC);
        $headers = [
            'Content-Type'  => 'application/vnd.mapbox-vector-tile',
            'Cache-Control' => 'public, max-age=86400, stale-while-revalidate=604800',
            'X-Tile-Source' => 'mbtiles-local',
            'X-Tile-ZXY'    => "{$z}/{$x}/{$y}",
        ];
        if ($isGzip) {
            $headers['Content-Encoding'] = 'gzip';
        }

        return response($blob, 200, $headers);
    }

    /** OSM raster endpoints, tried in order (first success wins). */
    private const RASTER_UPSTREAMS = [
        'https://tile.openstreetmap.org/%d/%d/%d.png',
        'https://a.tile.openstreetmap.org/%d/%d/%d.png',
        'https://b.tile.openstreetmap.org/%d/%d/%d.png',
    ];

    /** OSM usage policy requires an identifying User-Agent on every request. */
    private const RASTER_USER_AGENT = 'Golestani-Map/1.0 (https://incard.ir; contact@incard.ir)';

    /** OSM raster tiles go up to z19 (the raster fallback runs above the vector z14). */
    private const MAX_RASTER_ZOOM = 19;

    /**
     * GET /api/map/raster-tile/{z}/{x}/{y} — raster fallback, pure PHP.
     *
     * Serves OSM raster tiles through the Laravel HTTP client with a Redis
     * (or database, locally) cache in front, replacing the former Node.js
     * route handler in the Next.js app so the whole serving path is PHP.
     * Coordinates are validated BEFORE any I/O; a cache outage fails open
     * to the upstream instead of breaking tile serving.
     */
    public function rasterTile(int $z, string $xIn, string $yIn): Response
    {
        // Tolerate "403.png"-style extensions from legacy clients — cast truncates.
        $x = (int) $xIn;
        $y = (int) $yIn;

        if ($z < 0 || $z > self::MAX_RASTER_ZOOM || $x < 0 || $y < 0) {
            return response('', 404);
        }
        $max = 1 << $z;
        if ($x >= $max || $y >= $max) {
            return response('', 404);
        }

        $key = "map:raster:{$z}/{$x}/{$y}";

        try {
            $hit = cache()->get($key);
        } catch (\Throwable) {
            $hit = null; // cache outage must never break tile serving
        }
        if (is_array($hit) && isset($hit['body'], $hit['ct'])) {
            return response($hit['body'], 200, [
                'Content-Type'  => (string) $hit['ct'],
                'Cache-Control' => 'public, max-age=604800, stale-while-revalidate=86400',
                'X-Tile-Source' => 'osm-cache',
                'X-Tile-ZXY'    => "{$z}/{$x}/{$y}",
            ]);
        }

        foreach (self::RASTER_UPSTREAMS as $pattern) {
            try {
                $res = Http::withHeaders(['User-Agent' => self::RASTER_USER_AGENT])
                    ->timeout(4)
                    ->get(sprintf($pattern, $z, $x, $y));
            } catch (\Throwable) {
                continue; // try the next mirror
            }

            if (! $res->successful()) {
                continue;
            }

            $body = $res->body(); // binary-safe
            $ct   = $res->header('Content-Type') ?: 'image/png';

            try {
                cache()->put($key, ['body' => $body, 'ct' => $ct], now()->addDay());
            } catch (\Throwable) {
                // Best-effort caching — never block the response on it.
            }

            return response($body, 200, [
                'Content-Type'  => $ct,
                'Cache-Control' => 'public, max-age=604800, stale-while-revalidate=86400',
                'X-Tile-Source' => 'osm-upstream',
                'X-Tile-ZXY'    => "{$z}/{$x}/{$y}",
            ]);
        }

        // Every upstream failed (network outage / OSM unreachable) — serve a
        // tiny neutral grid tile so the map degrades gracefully instead of
        // showing errors. 200 + short browser cache, same contract as the
        // old Node.js proxy.
        return response(self::fallbackSvg(), 200, [
            'Content-Type'  => 'image/svg+xml',
            'Cache-Control' => 'public, max-age=86400',
            'X-Tile-Source' => 'fallback-offline',
            'X-Tile-ZXY'    => "{$z}/{$x}/{$y}",
        ]);
    }

    /** Neutral 256x256 grid SVG for complete network disconnection. */
    private static function fallbackSvg(): string
    {
        return <<<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#f8fafc"/>
  <path d="M0 0h256v256H0z" fill="none" stroke="#e2e8f0" stroke-width="1"/>
  <path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#f1f5f9" stroke-width="0.5"/>
</svg>
SVG;
    }

    public function status(): JsonResponse
    {
        $payload = cache()->remember('map:mbtiles:status', 60, function (): array {
            $path = MbtilesServer::resolvePath();
            if ($path === null) {
                return [
                    'mbtiles_present' => false,
                    'reason'          => MbtilesServer::lastError(),
                ];
            }

            try {
                $meta = MbtilesServer::metadata();
                // Probe one known Tehran tile (z10) to measure health end-to-end.
                $t0 = microtime(true);
                $probe = MbtilesServer::tile(10, 658, (1 << 10) - 1 - 403);
                $ms = (int) round((microtime(true) - $t0) * 1000);

                return [
                    'mbtiles_present'    => true,
                    'path'               => $path,
                    'size_bytes'         => (int) (filesize($path) ?: 0),
                    'format'             => $meta['format'] ?? null,
                    'vector_schema'      => $meta['Shortbread'] ?? ($meta['name'] ?? null),
                    'min_zoom'           => isset($meta['minzoom']) ? (int) $meta['minzoom'] : null,
                    'max_zoom'           => isset($meta['maxzoom']) ? (int) $meta['maxzoom'] : null,
                    'bounds'             => $meta['bounds'] ?? null,
                    'center'             => $meta['center'] ?? null,
                    'sample_tile_ok'     => $probe !== null,
                    'sample_tile_ms'     => $ms,
                ];
            } catch (\Throwable $e) {
                return [
                    'mbtiles_present' => false,
                    'reason'          => $e->getMessage(),
                ];
            }
        });

        return response()
            ->json($payload)
            ->header('Cache-Control', 'public, max-age=60');
    }
}
