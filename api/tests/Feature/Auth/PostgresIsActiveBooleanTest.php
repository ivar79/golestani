<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\OtpService;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\Connection;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PDO;

/**
 * PostgreSQL integration coverage for the production-incident fix
 * (SQLSTATE[42804] "is_active is of type boolean but expression is of
 * type integer").
 *
 * These tests run REAL SQL against a PostgreSQL/PostGIS server and prove:
 *  1. users.is_active has the physical type "boolean" (information_schema),
 *  2. verify-otp registration inserts successfully and stores a true
 *     boolean (pg_typeof = boolean) — through the boolean-safe binding,
 *  3. inactive users are still rejected with 403.
 *
 * They are skipped unless a test server is configured via env:
 *    PGSQL_TEST_HOST / PGSQL_TEST_PORT / PGSQL_TEST_DATABASE
 *    PGSQL_TEST_USERNAME / PGSQL_TEST_PASSWORD
 * Locally, the docker-compose PostGIS container satisfies this:
 *    set PGSQL_TEST_HOST=127.0.0.1  (database/user/password as in compose)
 * CI/deploy can point these at a disposable Neon branch.
 *
 * Each run migrates inside a fresh, uniquely named schema and drops it
 * afterwards, so the target database's public schema is never touched.
 *
 * @group pgsql-integration
 */
class PostgresIsActiveBooleanTest extends BaseTestCase
{
    private string $schema = '';

    private function testConnectionConfigured(): bool
    {
        return (bool) env('PGSQL_TEST_HOST');
    }

    private function it(): Connection
    {
        return DB::connection('pgsql_it');
    }

    protected function setUp(): void
    {
        if (! $this->testConnectionConfigured()) {
            $this->markTestSkipped('PGSQL_TEST_HOST not configured — skipping PostgreSQL integration tests.');
        }

        parent::setUp();

        // Fresh, uniquely named schema per run (SQL-safe: letters + digits).
        $this->schema = 'it_bool_'.str_replace('-', '', (string) str()->ulid());

        config()->set('database.connections.pgsql_it', [
            'driver' => 'pgsql',
            'host' => env('PGSQL_TEST_HOST'),
            'port' => env('PGSQL_TEST_PORT', '5432'),
            'database' => env('PGSQL_TEST_DATABASE', 'golestani'),
            'username' => env('PGSQL_TEST_USERNAME', 'golestani'),
            'password' => env('PGSQL_TEST_PASSWORD', 'secret'),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => [$this->schema, 'public'],
            'sslmode' => env('PGSQL_TEST_SSLMODE', 'prefer'),
            // Same option the production pgsql connection uses — this is
            // exactly the configuration that triggered the 42804 incident.
            'options' => extension_loaded('pdo_pgsql') ? array_filter([
                PDO::ATTR_EMULATE_PREPARES => true,
            ]) : [],
        ]);

        // All Eloquent models below (users, roles, tokens...) resolve through
        // the default connection: point it at the isolated test schema.
        config()->set('database.default', 'pgsql_it');

        $this->it()->statement('CREATE SCHEMA IF NOT EXISTS "'.$this->schema.'"');

        Artisan::call('migrate', ['--database' => 'pgsql_it', '--force' => true]);

        // Roles are required by assignRole('user') during registration.
        $this->seed(RoleSeeder::class);
    }

    protected function tearDown(): void
    {
        // When the test server is not configured, setUp() skips before the
        // app boots ($this->app === null) — tearDown still runs, so the
        // facade calls below must be guarded.
        if ($this->app !== null) {
            if ($this->testConnectionConfigured() && $this->schema !== '') {
                try {
                    $this->it()->statement('DROP SCHEMA IF EXISTS "'.$this->schema.'" CASCADE');
                } catch (\Throwable) {
                    // Never mask test results with teardown issues.
                }

                // The default connection was repointed in setUp; restore it so
                // any in-process work after this class uses the normal test
                // database again.
                config()->set('database.default', 'sqlite');
                DB::purge('pgsql_it');
            }
        }

        parent::tearDown();
    }

    private function seedOtp(string $phone, string $code): void
    {
        app(OtpService::class)->store($phone, $code);
        app(OtpService::class)->incrementSendCount($phone);
    }

    public function test_is_active_column_is_a_real_boolean_with_true_default(): void
    {
        $column = $this->it()->selectOne(
            'SELECT data_type, column_default
               FROM information_schema.columns
              WHERE table_schema = ? AND table_name = ? AND column_name = ?',
            [$this->schema, 'users', 'is_active']
        );

        $this->assertNotNull($column, 'users.is_active must exist');
        $this->assertSame('boolean', $column->data_type, 'Physical column type must be boolean, not integer');
        $this->assertStringContainsString('true', strtolower((string) $column->column_default));
    }

    public function test_otp_registration_inserts_and_stores_boolean_true_in_postgres(): void
    {
        $phone = '09361112233';
        $this->seedOtp($phone, '24680');

        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => $phone,
            'code' => '24680',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['token', 'token_type', 'user' => ['id', 'phone', 'roles']]);

        $row = $this->it()->selectOne(
            'SELECT is_active, pg_typeof(is_active)::text AS t FROM users WHERE phone = ?',
            [$phone]
        );

        $this->assertNotNull($row, 'User row must exist after registration');
        $this->assertSame('boolean', $row->t, 'pg_typeof must report boolean — the value must NOT be stored as an integer');
        $this->assertTrue((bool) $row->is_active, 'New user must be active (boolean true)');

        // Eloquent cast on top of the real boolean.
        $this->assertTrue(User::where('phone', $phone)->firstOrFail()->is_active);
    }

    public function test_inactive_postgres_user_is_rejected_with_403(): void
    {
        $phone = '09364445566';
        $this->seedOtp($phone, '11223');

        // Insert with an explicit false boolean through the same binding path.
        User::create(['phone' => $phone, 'is_active' => false]);

        $this->postJson('/api/auth/verify-otp', [
            'phone' => $phone,
            'code' => '11223',
        ])->assertStatus(403);

        $raw = $this->it()->selectOne(
            'SELECT is_active FROM users WHERE phone = ?',
            [$phone]
        );

        $this->assertFalse((bool) $raw->is_active);
    }
}
