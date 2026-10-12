<?php

namespace Tests\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * E2E FIXTURE LOADER — credential and blast-radius guards.
 *
 * `storage/e2e_setup.php` used to ship a fixed phone number plus a fixed,
 * reusable password (CWE-798: use of hard-coded credentials). Anyone with the
 * repository could read those values, and any environment where the script was
 * executed would reuse the same credential indefinitely.
 *
 * The rules pinned here:
 *  - no credential or identity literal lives in the script (static scan);
 *  - configuration comes from the environment and its absence FAILS CLOSED
 *    (no partial write, no default credential);
 *  - the script refuses to run outside local/testing/staging;
 *  - the fixture account is a business_owner and can never become an admin;
 *  - re-running it is idempotent (refresh, not duplicate).
 */
class E2eFixtureScriptGuardTest extends TestCase
{
    use RefreshDatabase;

    private const SCRIPT = 'storage/e2e_setup.php';

    private const OWNER_PHONE = '09335550101';

    private const OWNER_PASSWORD = 'E2e-Owner-Password!2026';

    protected function tearDown(): void
    {
        putenv('E2E_OWNER_PHONE');
        putenv('E2E_OWNER_PASSWORD');
        putenv('E2E_BUSINESS_PHONE');

        parent::tearDown();
    }

    /**
     * Run the script the way the operator does (inside a booted app). The
     * script's progress echoes are buffered so they do not pollute test output.
     */
    private function loadScript(): void
    {
        // The script is a plain include (documented: php artisan tinker
        // storage/e2e_setup.php) — requiring it here exercises the REAL file.
        ob_start();

        try {
            require base_path(self::SCRIPT);
        } finally {
            ob_end_clean();
        }
    }

    private function withEnvironment(array $values): void
    {
        putenv('E2E_OWNER_PHONE');
        putenv('E2E_OWNER_PASSWORD');
        putenv('E2E_BUSINESS_PHONE');

        foreach ($values as $key => $value) {
            putenv($key.'='.$value);
        }
    }

    public function test_the_script_contains_no_credential_or_identity_literal(): void
    {
        $source = (string) file_get_contents(base_path(self::SCRIPT));

        $this->assertDoesNotMatchRegularExpression(
            '/0?9[0-9]{9}/',
            $source,
            'the script must not embed a phone number.'
        );

        $this->assertStringNotContainsString("'password' => '", $source);
        $this->assertStringNotContainsString('E2ePass', $source);
        $this->assertStringNotContainsString('exit(', $source, 'failures must throw so tests can assert them');

        // Every piece of configuration must be read from the environment.
        foreach (['E2E_OWNER_PHONE', 'E2E_OWNER_PASSWORD', 'E2E_BUSINESS_PHONE'] as $variable) {
            $this->assertStringContainsString($variable, $source);
        }
    }

    /**
     * The sandbox-payment helper shares the owner identity contract: it must
     * read E2E_OWNER_PHONE instead of embedding a number, and it must refuse
     * to run rather than fall back to "any business owner" (which, on a shared
     * database, could target a real account).
     */
    public function test_the_sandbox_payment_helper_reads_the_owner_from_the_environment(): void
    {
        $source = (string) file_get_contents(base_path('storage/e2e_sandbox_payment.php'));

        $this->assertDoesNotMatchRegularExpression('/0?9[0-9]{9}/', $source);
        $this->assertStringContainsString('E2E_OWNER_PHONE', $source);
        $this->assertStringNotContainsString("User::role('business_owner')->first()", $source, 'no fallback to an arbitrary owner');
        $this->assertStringContainsString("config('zarinpal.env') !== 'sandbox'", $source, 'production must stay refused');
    }

    public function test_it_fails_closed_without_environment_credentials(): void
    {
        $this->withEnvironment([]);

        try {
            $this->loadScript();
            $this->fail('missing configuration must abort the script');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('E2E_OWNER_PHONE', $e->getMessage());
        }

        $this->assertSame(0, User::where('phone', self::OWNER_PHONE)->count(), 'nothing may be written without configuration');
    }

    public function test_a_short_password_is_refused_before_any_write(): void
    {
        $this->withEnvironment([
            'E2E_OWNER_PHONE' => self::OWNER_PHONE,
            'E2E_OWNER_PASSWORD' => 'too-short',
        ]);

        try {
            $this->loadScript();
            $this->fail('a short password must abort the script');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('E2E_OWNER_PASSWORD', $e->getMessage());
        }

        $this->assertSame(0, User::where('phone', self::OWNER_PHONE)->count());
    }

    public function test_it_refuses_to_run_outside_local_testing_and_staging(): void
    {
        $this->withEnvironment([
            'E2E_OWNER_PHONE' => self::OWNER_PHONE,
            'E2E_OWNER_PASSWORD' => self::OWNER_PASSWORD,
        ]);

        $original = config('app.env');
        config(['app.env' => 'production']);

        try {
            $this->loadScript();
            $this->fail('production must be refused');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('refuses to run', $e->getMessage());
        } finally {
            config(['app.env' => $original]);
        }

        $this->assertSame(0, User::where('phone', self::OWNER_PHONE)->count());
    }

    public function test_it_creates_only_a_business_owner_and_is_idempotent(): void
    {
        $this->withEnvironment([
            'E2E_OWNER_PHONE' => self::OWNER_PHONE,
            'E2E_OWNER_PASSWORD' => self::OWNER_PASSWORD,
            'E2E_BUSINESS_PHONE' => '02100000000',
        ]);

        $this->loadScript();

        $owner = User::where('phone', self::OWNER_PHONE)->firstOrFail();
        $this->assertTrue($owner->hasRole('business_owner'));
        $this->assertFalse($owner->hasRole('admin'), 'the E2E fixture must never create an administrator');
        $this->assertTrue(Hash::check(self::OWNER_PASSWORD, (string) $owner->password));
        $this->assertDatabaseHas('businesses', ['slug' => 'e2e-test-biz', 'user_id' => $owner->id]);

        // Second run refreshes, never duplicates.
        $this->loadScript();

        $this->assertSame(1, User::where('phone', self::OWNER_PHONE)->count());
        $this->assertSame(1, \App\Models\Business::where('slug', 'e2e-test-biz')->count());
    }
}
