<?php

namespace Tests\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * ADMIN EMERGENCY RECOVERY CODE — full lifecycle (security requirement 4).
 *
 * The recovery code is the ONLY way back into an administrator account when
 * the password is lost or the server-side owner cannot log in, so its
 * lifecycle is a security control of its own:
 *
 *  - issued ONLY by an operator-run console command, and only for an account
 *    that already holds the admin role (no self-service issuance);
 *  - stored HASHED — the plaintext exists exactly once, in the operator's
 *    terminal, and is never persisted or logged by the application;
 *  - SINGLE USE — a successful login consumes it immediately (the column is
 *    cleared), so a leaked code cannot be replayed;
 *  - REPLACEABLE — issuing a new code invalidates the previous one;
 *  - a failure never issues a session, and a successful recovery revokes the
 *    admin's previous sessions (single-session semantics).
 *
 * Standards this pins: NIST SP 800-63B-4 §4.2.1.1 ("a successfully used saved
 * recovery code SHALL be invalidated and a new one issued"; look-up secrets
 * stored hashed), OWASP ASVS 5.0.0 v5.0.0-6.5.1 (one-time secrets usable only
 * once) and v5.0.0-6.4.4 (identity proofing on lost-factor recovery).
 */
class AdminRecoveryCodeTest extends TestCase
{
    use RefreshDatabase;

    private function admin(?string $password = 'Admin@Golestani2026!'): User
    {
        $user = User::factory()->create([
            'phone' => '09'.fake()->numerify('#########'),
            'password' => $password === null ? null : Hash::make($password),
            'is_active' => true,
        ]);
        $user->assignRole('admin');

        return $user;
    }

    /** Run the real command and read the one-time code off its output. */
    private function issueCode(string $phone): string
    {
        Artisan::call('admin:recovery-code', ['phone' => $phone]);
        $output = Artisan::output();

        $this->assertMatchesRegularExpression(
            '/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/',
            $output,
            'the operator must receive the code exactly once'
        );

        preg_match('/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/', $output, $matches);

        return $matches[0];
    }

    public function test_the_command_refuses_unknown_and_non_admin_accounts(): void
    {
        $this->artisan('admin:recovery-code', ['phone' => '09120000001'])->assertFailed();

        $plain = User::factory()->create(['phone' => '09120000002']);
        $plain->assignRole('user');
        $this->artisan('admin:recovery-code', ['phone' => $plain->phone])->assertFailed();

        $this->assertNull($plain->fresh()->recovery_code, 'a non-admin must never receive a recovery code');
    }

    public function test_the_code_is_stored_hashed_and_never_persisted_in_plaintext(): void
    {
        $admin = $this->admin();

        $code = $this->issueCode($admin->phone);
        $stored = (string) $admin->fresh()->recovery_code;

        $this->assertNotSame('', $stored);
        $this->assertStringNotContainsString($code, $stored, 'the code must not be stored in plaintext');
        $this->assertTrue(Hash::check($code, $stored), 'the stored value must be a verifiable hash');
    }

    public function test_the_code_works_exactly_once_and_is_cleared_after_use(): void
    {
        $admin = $this->admin();
        $code = $this->issueCode($admin->phone);

        $token = $this->postJson('/api/auth/verify-recovery', [
            'phone' => $admin->phone,
            'code' => $code,
        ])->assertOk()->json('token');

        $this->assertNotEmpty($token);
        $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/auth/me')->assertOk();

        $this->assertNull($admin->fresh()->recovery_code, 'the used code must be consumed');

        // Replay: the same code can never be used again.
        $this->postJson('/api/auth/verify-recovery', [
            'phone' => $admin->phone,
            'code' => $code,
        ])->assertStatus(422);
    }

    public function test_issuing_a_new_code_invalidates_the_previous_one(): void
    {
        $admin = $this->admin();

        $old = $this->issueCode($admin->phone);
        $new = $this->issueCode($admin->phone);

        $this->assertNotSame($old, $new);

        $this->postJson('/api/auth/verify-recovery', ['phone' => $admin->phone, 'code' => $old])
            ->assertStatus(422);

        $this->postJson('/api/auth/verify-recovery', ['phone' => $admin->phone, 'code' => $new])
            ->assertOk()
            ->assertJsonStructure(['token']);
    }

    public function test_a_wrong_code_never_issues_a_session(): void
    {
        $admin = $this->admin();
        $this->issueCode($admin->phone);

        $this->postJson('/api/auth/verify-recovery', [
            'phone' => $admin->phone,
            'code' => 'AAAA-BBBB-CCCC',
        ])->assertStatus(422);

        $this->assertSame(0, $admin->tokens()->count());
        $this->assertNotNull($admin->fresh()->recovery_code, 'a failed attempt must not consume the code');
    }

    public function test_recovery_works_for_an_admin_whose_password_is_unusable(): void
    {
        // The real scenario the code exists for: the password is lost/unknown.
        $admin = $this->admin(password: null);
        $code = $this->issueCode($admin->phone);

        $this->postJson('/api/auth/admin/login', ['identifier' => $admin->phone, 'password' => 'anything'])
            ->assertStatus(422);

        $this->postJson('/api/auth/verify-recovery', ['phone' => $admin->phone, 'code' => $code])
            ->assertOk()
            ->assertJsonPath('token_type', 'Bearer');
    }

    public function test_a_recovered_admin_can_rotate_the_password_and_log_in_with_it(): void
    {
        $admin = $this->admin(password: null);
        $code = $this->issueCode($admin->phone);

        $this->postJson('/api/auth/verify-recovery', ['phone' => $admin->phone, 'code' => $code])->assertOk();

        // Operator-side rotation (the documented path: php artisan admin:provision).
        // Prompt order mirrors the command: confirm the rotation FIRST, then
        // the new password twice (both hidden).
        $this->artisan('admin:provision', ['phone' => $admin->phone])
            ->expectsConfirmation('Rotate this admin password, revoke its tokens and recovery code?', 'yes')
            ->expectsQuestion('New password (at least 16 characters)', 'BrandNewAdminPass!2026')
            ->expectsQuestion('Repeat new password', 'BrandNewAdminPass!2026')
            ->assertSuccessful();

        $this->postJson('/api/auth/admin/login', [
            'identifier' => $admin->phone,
            'password' => 'BrandNewAdminPass!2026',
        ])->assertOk()->assertJsonStructure(['token']);

        // Rotation also cleared the (already consumed) recovery code.
        $this->assertNull($admin->fresh()->recovery_code);
    }
}
