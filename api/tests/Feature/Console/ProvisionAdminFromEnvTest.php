<?php

namespace Tests\Feature\Console;

use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Tests for `admin:provision-from-env` (ProvisionAdminFromEnv) — the
 * non-interactive staging admin provisioning used by the GitHub Actions
 * workflow (no shell access on the Render free plan).
 *
 * Inputs come exclusively from environment variables; these tests save and
 * restore the process environment around each case.
 */
class ProvisionAdminFromEnvTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '09121111111';

    private const PASSWORD = 'Staging@Admin2026!x';

    /** @var array<string, string|false> */
    private array $envBackup = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->envBackup = [
            'ADMIN_PHONE' => getenv('ADMIN_PHONE'),
            'ADMIN_PASSWORD' => getenv('ADMIN_PASSWORD'),
            'ADMIN_EMAIL' => getenv('ADMIN_EMAIL'),
        ];
    }

    protected function tearDown(): void
    {
        foreach ($this->envBackup as $name => $value) {
            if ($value === false) {
                putenv($name); // unset
            } else {
                putenv($name.'='.$value);
            }
        }

        parent::tearDown();
    }

    private function setEnv(string $phone = self::PHONE, string $password = self::PASSWORD, ?string $email = null): void
    {
        putenv('ADMIN_PHONE='.$phone);
        putenv('ADMIN_PASSWORD='.$password);

        if ($email === null) {
            putenv('ADMIN_EMAIL'); // unset
        } else {
            putenv('ADMIN_EMAIL='.$email);
        }
    }

    // ─── Validation gates ───────────────────────────────────────────────

    public function test_rejects_missing_or_malformed_phone(): void
    {
        $this->setEnv(phone: '12345');

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('ADMIN_PHONE')
            ->assertExitCode(1);

        $this->assertDatabaseCount('users', 0);
    }

    public function test_rejects_short_password(): void
    {
        $this->setEnv(password: 'short');

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('ADMIN_PASSWORD')
            ->assertExitCode(1);

        $this->assertDatabaseCount('users', 0);
    }

    public function test_rejects_invalid_email(): void
    {
        $this->setEnv(email: 'not-an-email');

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('ADMIN_EMAIL')
            ->assertExitCode(1);

        $this->assertDatabaseCount('users', 0);
    }

    // ─── Creation ───────────────────────────────────────────────────────

    public function test_creates_an_active_admin_with_default_email(): void
    {
        $this->setEnv();

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('created')
            ->assertExitCode(0);

        $user = User::where('phone', self::PHONE)->firstOrFail();
        $this->assertTrue($user->is_active);
        $this->assertSame('admin@golestani.ir', $user->email);
        $this->assertSame('مدیر سامانه', $user->name);
        $this->assertTrue(Hash::check(self::PASSWORD, (string) $user->password));
        $this->assertTrue($user->hasRole('admin'));
        $this->assertNull($user->recovery_code);
    }

    public function test_creation_writes_an_audit_event(): void
    {
        $this->setEnv();

        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $user = User::where('phone', self::PHONE)->firstOrFail();
        $this->assertDatabaseHas('audit_events', [
            'event' => 'admin.credentials_provisioned',
            'subject_type' => 'user',
            'subject_id' => $user->id,
        ]);
    }

    public function test_created_admin_can_log_in_via_the_admin_login_endpoint(): void
    {
        $this->setEnv();

        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $this->postJson('/api/auth/admin/login', [
            'identifier' => self::PHONE,
            'password' => self::PASSWORD,
        ])
            ->assertOk()
            ->assertJsonPath('user.roles.0', 'admin');
    }

    // ─── Idempotent rotation ────────────────────────────────────────────

    public function test_second_run_rotates_the_password_without_duplicating(): void
    {
        $this->setEnv();
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $newPassword = 'Rotated@Admin2026!y';
        $this->setEnv(password: $newPassword);

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('rotated')
            ->assertExitCode(0);

        $this->assertSame(1, User::where('phone', self::PHONE)->count());
        $user = User::where('phone', self::PHONE)->firstOrFail();
        $this->assertTrue(Hash::check($newPassword, (string) $user->password));
        $this->assertFalse(Hash::check(self::PASSWORD, (string) $user->password));
        $this->assertTrue($user->hasRole('admin'));

        // The rotation event is recorded alongside the creation event.
        $this->assertDatabaseHas('audit_events', [
            'event' => 'admin.credentials_rotated',
            'subject_id' => $user->id,
        ]);
    }

    public function test_rotation_revokes_existing_tokens(): void
    {
        $this->setEnv();
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $user = User::where('phone', self::PHONE)->firstOrFail();
        $user->createToken('old-session');
        $this->assertGreaterThan(0, $user->tokens()->count());

        $this->setEnv(password: 'Rotated@Admin2026!z');
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $this->assertSame(0, $user->tokens()->count());
    }

    public function test_run_without_existing_user_does_not_touch_other_rows(): void
    {
        // A role row must exist for assignRole even before RoleSeeder runs;
        // the command itself guards with firstOrCreate.
        $this->setEnv();
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $this->assertSame(1, Role::where('name', 'admin')->count());
        $this->assertSame(1, DB::table('role_user')->count());
    }

    // ─── Safety: never promote or clobber non-admin accounts ────────────

    public function test_refuses_to_promote_an_existing_non_admin_phone(): void
    {
        $plain = User::create([
            'phone' => self::PHONE,
            'password' => Hash::make('SomeRegularUser2026!'),
            'is_active' => true,
        ]);
        $plain->assignRole('user');

        $this->setEnv();

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('not an admin')
            ->assertExitCode(1);

        // The existing account must be untouched.
        $plain->refresh();
        $this->assertTrue(Hash::check('SomeRegularUser2026!', (string) $plain->password));
        $this->assertTrue($plain->hasRole('user'));
        $this->assertFalse($plain->hasRole('admin'));
    }

    public function test_refuses_to_take_over_an_email_owned_by_another_account(): void
    {
        $owner = User::create([
            'email' => 'taken@golestani.ir',
            'phone' => '09122222222',
            'password' => Hash::make('AnotherUser2026!a'),
            'is_active' => true,
        ]);
        $owner->assignRole('user');

        $this->setEnv(email: 'taken@golestani.ir');

        $this->artisan('admin:provision-from-env')
            ->expectsOutputToContain('ADMIN_EMAIL')
            ->assertExitCode(1);

        $owner->refresh();
        $this->assertTrue(Hash::check('AnotherUser2026!a', (string) $owner->password));
        $this->assertDatabaseMissing('users', ['phone' => self::PHONE]);
    }

    public function test_rotation_of_existing_admin_keeps_their_email(): void
    {
        $this->setEnv(email: 'custom@golestani.ir');
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        // Rotate without ADMIN_EMAIL set — the email must stay as-is.
        $this->setEnv(password: 'Rotated@Admin2026!w');
        $this->artisan('admin:provision-from-env')->assertExitCode(0);

        $user = User::where('phone', self::PHONE)->firstOrFail();
        $this->assertSame('custom@golestani.ir', $user->email);
    }
}
