<?php

namespace Tests\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * ADMIN IDENTITY GUARD (security requirement + international practice).
 *
 * The product must have exactly ONE class of administrator identity, created
 * OUT OF BAND by an operator — never a phone number baked into the repository,
 * never a seed/fixture that silently mints an admin, and never an in-app
 * promotion path that a already-privileged account could use to create extra
 * administrators.
 *
 * This mirrors the guidance the project follows:
 *  - NIST SP 800-53 AC-2 (account management) / AC-6(5) (restrict privileged
 *    accounts to defined personnel) — privileged accounts are inventoried and
 *    explicitly authorized, not created as a side effect of ordinary features.
 *  - NIST SP 800-63B-4 §3.1.3.3 (PSTN/SMS out-of-band authenticators are
 *    RESTRICTED) and OWASP ASVS 5.0.0 v5.0.0-6.6.1 (phone/SMS OTP must not be
 *    available for L3 applications) — hence admin logins never use the public
 *    OTP flow (see AdminOtpLoginBlockedTest) and admins have a dedicated
 *    password + one-time recovery-code path.
 *  - CIS Controls v8.1 5.4 (dedicated administrator accounts) / 6.5 (MFA for
 *    administrative access) and CWE-798 / CWE-259 (no hard-coded credentials
 *    or embedded administrator identities in source).
 *  - OWASP ASVS 5.0.0 v5.0.0-6.3.2 (no default accounts such as `admin`) and
 *    the OWASP Secrets Management Cheat Sheet (bootstrap the first
 *    administrator through a controlled, operator-run process).
 *
 * The static assertions below read the REAL source tree, so a future commit
 * that reintroduces a hardcoded admin number or a seeding path fails CI.
 */
class AdminIdentityGuardTest extends TestCase
{
    use RefreshDatabase;

    private function sourceFilesIn(string $relativeDirectory): array
    {
        $root = base_path($relativeDirectory);
        $files = [];

        if (is_dir($root)) {
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));

            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === 'php') {
                    $files[str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname())] = (string) file_get_contents($file->getPathname());
                }
            }
        }

        ksort($files);

        return $files;
    }

    /**
     * Every PHP file under api/, minus the given trees, keyed by a path
     * relative to api/ with forward slashes (stable across platforms).
     */
    private function phpFilesExcept(array $excluded): array
    {
        $root = base_path();
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST,
        );

        foreach ($iterator as $file) {
            /** @var \SplFileInfo $file */
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
            $first = explode('/', $relative)[0];

            if (in_array($first, $excluded, true)) {
                continue;
            }

            $files[$relative] = (string) file_get_contents($file->getPathname());
        }

        ksort($files);

        return $files;
    }

    /** Iranian mobile literal, e.g. 09123456789 / 09120000001. */
    private const PHONE_LITERAL = '/0?9[0-9]{9}/';

    public function test_the_admin_role_can_only_be_assigned_by_out_of_band_provisioning(): void
    {
        $assigners = [];

        // The WHOLE api/ tree is scanned — not just app/ and database/ — so an
        // operator script (api/storage/*.php), a deploy hook or a future
        // helper cannot quietly gain the ability to mint administrators.
        // tests/ and vendor/ are excluded (fixtures legitimately need admins).
        foreach ($this->phpFilesExcept(['tests', 'vendor', 'node_modules']) as $relative => $contents) {
            if (preg_match("/assignRole\\(\\s*'admin'\\s*\\)/", $contents) === 1) {
                $assigners[] = $relative;
            }
        }

        sort($assigners);

        $this->assertSame([
            'app/Console/Commands/ProvisionAdmin.php',
            'app/Console/Commands/ProvisionAdminFromEnv.php',
        ], $assigners, 'Only the two operator provisioning commands may grant the admin role.');
    }

    public function test_no_provisioning_command_or_seeder_hardcodes_an_administrator_identity(): void
    {
        foreach (['app/Console/Commands/ProvisionAdmin.php', 'app/Console/Commands/ProvisionAdminFromEnv.php'] as $path) {
            $contents = (string) file_get_contents(base_path($path));

            $this->assertSame(
                0,
                preg_match(self::PHONE_LITERAL, $contents),
                "{$path} must take the administrator phone from an argument or environment variable — never a literal.",
            );
        }

        // Seeders and factories must not contain phone literals either: test
        // data is generated (User::factory) or synthetic at call sites.
        foreach ($this->sourceFilesIn('database/seeders') as $path => $contents) {
            $this->assertSame(
                0,
                preg_match(self::PHONE_LITERAL, $contents),
                "{$path} must not embed a phone number.",
            );
        }
    }

    public function test_the_admin_seeder_creates_no_account_and_no_default_credentials(): void
    {
        $seeder = (string) file_get_contents(base_path('database/seeders/AdminUserSeeder.php'));

        foreach (['User::create', 'User::updateOrCreate', 'User::firstOrCreate', 'Hash::make', 'new User('] as $forbidden) {
            $this->assertStringNotContainsString(
                $forbidden,
                $seeder,
                'AdminUserSeeder must stay inert: no account, no password, no default admin.',
            );
        }
    }

    public function test_the_admin_api_cannot_promote_anyone_to_administrator(): void
    {
        $admin = User::factory()->create([
            'phone' => '09'.fake()->numerify('#########'),
            'password' => Hash::make('Admin@Golestani2026!'),
            'is_active' => true,
        ]);
        $admin->assignRole('admin');

        $target = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $target->assignRole('user');

        // Single-role payload (the admin UI dropdown) — attach attempt.
        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$target->id, ['roles' => ['admin']])
            ->assertStatus(422);

        // Explicit multi-role replace — same answer.
        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$target->id, ['roles' => ['user', 'admin']])
            ->assertStatus(422);

        $this->assertFalse($target->fresh()->hasRole('admin'), 'the admin API must never create a new administrator');
        $this->assertSame(1, User::whereHas('roles', fn ($query) => $query->where('name', 'admin'))->count());

        // Managing every OTHER role through the same endpoint still works.
        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$target->id, ['roles' => ['business_owner']])
            ->assertOk()
            ->assertJsonPath('roles.0.name', 'business_owner');
    }

    public function test_an_existing_administrator_is_never_demoted_or_duplicated_through_the_api(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########'), 'is_active' => true]);
        $admin->assignRole('admin');
        $second = User::factory()->create(['phone' => '09'.fake()->numerify('#########'), 'is_active' => true]);
        $second->assignRole('admin');

        // Re-sending the SAME admin role for an existing admin is a no-op, not
        // a privilege change (this keeps the admin-users UI usable).
        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$second->id, ['roles' => ['admin']])
            ->assertOk();

        $this->assertSame(2, User::whereHas('roles', fn ($query) => $query->where('name', 'admin'))->count());

        // Removing admin is only possible through the EXPLICIT multi-role
        // replace form (a one-value payload is "add this role", see
        // AdminController::updateUser), and it never opens a promotion path:
        // the same request cannot carry admin back for a non-admin.
        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$second->id, ['roles' => ['user', 'business_owner']])
            ->assertOk();

        $this->assertFalse($second->fresh()->hasRole('admin'));
        $this->assertTrue($admin->fresh()->hasRole('admin'));
    }
}
