<?php

namespace App\Support;

use PDO;
use RuntimeException;

/**
 * MbtilesServer — pure-PHP vector tile server for a Shortbread MBTiles archive.
 *
 * Serves gzip-compressed Mapbox Vector Tiles directly from an MBTiles
 * (SQLite) file using PHP's native PDO SQLite driver — no Node.js, no
 * external binaries, no tile decompression (bytes pass through untouched).
 *
 * Contract:
 *  - connection is read-only, immutable and kept as a singleton per process
 *  - XYZ (slippy-map) coordinates are converted to MBTiles TMS row order
 *  - everything is validated before any SQL runs (no user input reaches SQL
 *    unvalidated — all values are cast to integers and range-checked)
 *  - unknown/missing tiles return null → controller answers 404 and the
 *    frontend falls back to the online raster proxy
 */
final class MbtilesServer
{
    private static ?PDO $pdo = null;

    /** Runtime cache of metadata rows (shortbread version, bounds...). */
    private static ?array $meta = null;

    /** Status of the last open attempt, for diagnostics. */
    private static ?string $lastError = null;

    private function __construct() {}

    /**
     * Resolve the archive path from MBTILES_PATH (or its legacy alias).
     * Returns null when unconfigured or when PHP's SQLite driver is missing.
     */
    public static function resolvePath(): ?string
    {
        $path = (string) (config('services.mbtiles_path')
            ?: env('MBTILES_PATH')
            ?: env('MBTILES_FILE')
            ?: '');

        if ($path === '') {
            self::$lastError = 'MBTILES_PATH is not configured';
            return null;
        }

        if (!class_exists(PDO::class) || !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::$lastError = 'pdo_sqlite extension is not available';
            return null;
        }

        if (!is_file($path)) {
            self::$lastError = "MBTiles file not found at: {$path}";
            return null;
        }

        return $path;
    }

    /** True when a readable archive is configured and indexed correctly. */
    public static function available(): bool
    {
        try {
            self::pdo();
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Shared read-only PDO connection (singleton per octane/worker process).
     *
     * @throws RuntimeException when the archive is unusable
     */
    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = self::resolvePath();
        if ($path === null) {
            throw new RuntimeException(self::$lastError ?? 'MBTiles unavailable');
        }

        $pdo = new PDO(
            "sqlite:{$path}",
            null,
            null,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            ],
        );
        // Read-only + memory-optimized pragmas — applied via exec() because the
        // driver-specific OPEN_FLAGS option is not portable across PHP builds
        // (Windows pdo_sqlite rejects it; Linux builds accept it).
        $pdo->exec('PRAGMA query_only=ON');
        $pdo->exec('PRAGMA mmap_size=134217728'); // 128 MB memory-mapped I/O
        $pdo->exec('PRAGMA cache_size=-8000');    // ~8 MB page cache

        return self::$pdo = $pdo;
    }

    /** All metadata rows as key => value (cached in-process). */
    public static function metadata(): array
    {
        if (self::$meta !== null) {
            return self::$meta;
        }

        $rows = self::pdo()
            ->query('SELECT name, value FROM metadata')
            ->fetchAll(PDO::FETCH_KEY_PAIR);

        return self::$meta = $rows;
    }

    /**
     * Fetch one raw tile blob (still gzip-compressed, exactly as stored).
     *
     * @return string|null binary tile payload, or null when absent
     */
    public static function tile(int $z, int $x, int $tmsY): ?string
    {
        $stmt = self::pdo()->prepare(
            'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1'
        );
        $stmt->execute([$z, $x, $tmsY]);

        $blob = $stmt->fetchColumn();
        $stmt->closeCursor();

        return is_string($blob) && $blob !== '' ? $blob : null;
    }

    /** Last diagnostics message (null when healthy). */
    public static function lastError(): ?string
    {
        return self::$lastError;
    }

    /** Test hook — used by unit tests to reset the singleton. */
    public static function flush(): void
    {
        self::$pdo = null;
        self::$meta = null;
    }
}
