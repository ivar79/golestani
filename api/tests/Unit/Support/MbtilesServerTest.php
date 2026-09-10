<?php

namespace Tests\Unit\Support;

use App\Support\MbtilesServer;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\TestCase;

/**
 * Exercises MbtilesServer against the real Shortbread archive when it is
 * available (MBTILES_PATH set + pdo_sqlite loaded) — e.g. in local dev and
 * CI where the archive is present at the repo root. Skips otherwise, so the
 * suite stays green on hosts without the 650 MB archive.
 */
#[RequiresPhpExtension('pdo_sqlite')]
final class MbtilesServerTest extends TestCase
{
    private ?string $backupPath = null;

    protected function setUp(): void
    {
        parent::setUp();
        MbtilesServer::flush();

        $this->backupPath = (string) (getenv('MBTILES_PATH') ?: '');
        $candidate = dirname(__DIR__, 3) . '/../iran-shortbread-1.0.mbtiles';
        if ($this->backupPath === '' && is_file($auto = dirname(__DIR__, 3) . '/iran-shortbread-1.0.mbtiles')) {
            $this->backupPath = $auto;
        } elseif ($this->backupPath === '' && is_file($candidate)) {
            $this->backupPath = $candidate;
        }

        if ($this->backupPath === '' || !is_file($this->backupPath)) {
            $this->markTestSkipped('MBTILES_PATH is not set and the archive is not at the repo root — skipping live-archive tests.');
        }
        putenv("MBTILES_PATH={$this->backupPath}");
        config(['services.mbtiles_path' => $this->backupPath]);
    }

    protected function tearDown(): void
    {
        if ($this->backupPath !== null && $this->backupPath !== '') {
            putenv("MBTILES_PATH={$this->backupPath}");
        }
        config(['services.mbtiles_path' => null]);
        MbtilesServer::flush();
        parent::tearDown();
    }

    public function test_resolves_and_reads_metadata_from_real_archive(): void
    {
        $path = MbtilesServer::resolvePath();

        $this->assertNotNull($path, 'resolvePath() should find the archive: ' . (MbtilesServer::lastError() ?? ''));
        $this->assertFileExists($path);

        $meta = MbtilesServer::metadata();
        $this->assertSame('pbf', $meta['format'] ?? null);
        $this->assertSame('14', (string) ($meta['maxzoom'] ?? '14'));
    }

    public function test_reads_a_known_tehran_tile_at_z10(): void
    {
        // Tehran (35.6892, 51.3890) → XYZ z10 (658, 403) → TMS row 620.
        $blob = MbtilesServer::tile(10, 658, (1 << 10) - 1 - 403);

        $this->assertNotNull($blob, 'Known Tehran z10 tile must exist in the archive');
        $this->assertGreaterThan(1000, strlen($blob), 'A z10 metropolitan tile should be more than 1 KB');
        // Shortbread stores gzip-compressed MVT.
        $this->assertSame("\x1f\x8b", substr($blob, 0, 2), 'Tile payload must be gzip-compressed MVT');
    }

    public function test_missing_tile_returns_null_without_throwing(): void
    {
        // An ocean tile far outside the archive bounds (lon < 44°E) is absent.
        $blob = MbtilesServer::tile(10, 0, 0);

        $this->assertNull($blob);
    }

    public function test_singleton_connection_is_reused(): void
    {
        $first = MbtilesServer::tile(10, 658, (1 << 10) - 1 - 403);
        $firstPdo = MbtilesServer::pdo();
        $second = MbtilesServer::tile(10, 658, (1 << 10) - 1 - 403);
        $secondPdo = MbtilesServer::pdo();

        $this->assertNotNull($first);
        $this->assertNotNull($second);
        $this->assertSame($firstPdo, $secondPdo, 'PDO connection must be a per-process singleton');
    }
}
