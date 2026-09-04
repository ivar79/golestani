<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Post-deploy database validation (PostGIS + geom index).
 *
 * Verifies that the deployed database actually satisfies the geo requirements
 * that migrations set up:
 *
 *   1. The connection is PostgreSQL.
 *   2. The `postgis` extension is installed (version 3.x or newer).
 *   3. The `businesses.geom` column exists with type `geometry(Point,4326)`.
 *   4. The `businesses_geom_gist` GiST index exists.
 *   5. Every row with lat/lng also has a filled `geom` (backfill completed).
 *
 * Exits non-zero when a hard requirement is missing so CI / Render deploy
 * hooks can fail loudly. Warnings (soft issues) print but do not fail.
 *
 * Usage:
 *   php artisan db:validate-postgis            # human output
 *   php artisan db:validate-postgis --json     # machine-readable (CI)
 */
class ValidatePostgis extends Command
{
    /** The name and signature of the console command. */
    protected $signature = 'db:validate-postgis
                            {--json : Output machine-readable JSON instead of styled text}';

    /** The console command description. */
    protected $description = 'Validate PostGIS extension, geom column, GiST index and backfill after deploy';

    /** @var array<int, array{check:string, status:string, detail:string}> */
    private array $results = [];

    public function handle(): int
    {
        try {
            DB::connection()->getPdo();
        } catch (\Throwable $e) {
            $this->record('database connection', 'fail', 'could not connect: '.$e->getMessage());

            return $this->finish();
        }

        $driver = DB::connection()->getDriverName();

        if ($driver !== 'pgsql') {
            $this->record('pgsql driver', 'skip', "connection driver is '{$driver}' — geo checks only apply to PostgreSQL");

            return $this->finish();
        }

        $this->checkPostgisExtension();
        $this->checkGeomColumn();
        $this->checkGeomIndex();
        $this->checkBackfill();

        return $this->finish();
    }

    private function checkPostgisExtension(): void
    {
        $row = DB::selectOne(
            "SELECT extversion FROM pg_extension WHERE extname = 'postgis' LIMIT 1"
        );

        if ($row === null) {
            $this->record('postgis extension', 'fail', 'extension is NOT installed — run migration 2026_08_28_000004_enable_postgis_extension');

            return;
        }

        $version = (string) $row->extversion;
        $major = (int) strtok($version, '.');

        if ($major < 3) {
            $this->record('postgis extension', 'warn', "version {$version} is old — 3.x recommended (ST_MakePoint etc. still fine, but test radius queries)");
            return;
        }

        $this->record('postgis extension', 'pass', "version {$version}");
    }

    private function checkGeomColumn(): void
    {
        $row = DB::selectOne(
            "SELECT type, srid FROM geometry_columns
             WHERE f_table_name = 'businesses' AND f_geometry_column = 'geom'
             LIMIT 1"
        );

        if ($row === null) {
            $this->record('businesses.geom column', 'fail', 'column missing from geometry_columns — run migration 2026_09_01_000001_add_geom_to_businesses_table');
            return;
        }

        $type = (string) $row->type;
        $srid = (int) $row->srid;

        if (strcasecmp($type, 'Point') !== 0 || $srid !== 4326) {
            $this->record('businesses.geom column', 'fail', "expected geometry(Point,4326), found geometry({$type},{$srid})");
            return;
        }

        $this->record('businesses.geom column', 'pass', 'geometry(Point,4326)');
    }

    private function checkGeomIndex(): void
    {
        $row = DB::selectOne(
            "SELECT 1 FROM pg_indexes
             WHERE indexname = 'businesses_geom_gist' AND tablename = 'businesses'
             LIMIT 1"
        );

        if ($row === null) {
            $this->record('businesses_geom_gist index', 'fail', 'GiST index missing — radius search will be slow; run migration 2026_09_01_000001');
            return;
        }

        $this->record('businesses_geom_gist index', 'pass', 'GiST index present');
    }

    private function checkBackfill(): void
    {
        try {
            $row = DB::selectOne(
                'SELECT COUNT(*) AS missing FROM businesses
                 WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL'
            );
        } catch (\Throwable $e) {
            // latitude/longitude columns may not exist on very old schemas — not fatal here.
            $this->record('geom backfill', 'skip', 'could not check backfill: '.$e->getMessage());
            return;
        }

        $missing = (int) $row->missing;

        if ($missing > 0) {
            $this->record('geom backfill', 'warn', "{$missing} row(s) have lat/lng but NULL geom — re-run the UPDATE in migration 2026_09_01_000001 or a backfill command");
            return;
        }

        $this->record('geom backfill', 'pass', 'all rows with lat/lng have geom populated');
    }

    /**
     * @param string $status one of: pass, fail, warn, skip
     */
    private function record(string $check, string $status, string $detail): void
    {
        $this->results[] = compact('check', 'status', 'detail');

        if ($this->option('json')) {
            return; // machine-readable mode prints a single JSON payload at the end
        }

        $style = match ($status) {
            'pass' => ['<fg=green>✔</>', $detail],
            'fail' => ['<fg=red;options=bold>✘</>', $detail],
            'warn' => ['<fg=yellow>▲</>', $detail],
            default => ['<fg=cyan>–</>', $detail],
        };

        $this->line(sprintf('  %s %-28s %s', $style[0], $check, $style[1]));
    }

    private function finish(): int
    {
        if ($this->option('json')) {
            $this->line(json_encode([
                'ok' => ! in_array('fail', array_column($this->results, 'status'), true),
                'checks' => $this->results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $failed = in_array('fail', array_column($this->results, 'status'), true);

        if (! $this->option('json')) {
            if ($failed) {
                $this->newLine();
                $this->error('Database geo validation FAILED — see ✘ items above.');
            } elseif (in_array('warn', array_column($this->results, 'status'), true)) {
                $this->newLine();
                $this->warn('Database geo validation passed with warnings (▲) — review before release.');
            } else {
                $this->newLine();
                $this->info('Database geo validation passed ✔');
            }
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
