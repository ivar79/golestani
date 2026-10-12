<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * ADMINISTRATOR ACCOUNTS MUST NOT LOG IN WITH OTP (security requirement).
 *
 * The admin surface is deliberately higher-value than the public one, so its
 * session must come from the dedicated password flow (POST /api/auth/admin/login,
 * plus the one-time recovery code path) — never from an SMS code that can be
 * read off a phone that has been lost, cloned or handed over, and never from a
 * phone-recycling scenario.
 *
 * AuthController::verifyOtp() refuses a verified OTP for an admin account. That
 * guard existed in code but had NO test, which is exactly how a later refactor
 * could silently reopen it; these tests pin it (and the non-admin path it must
 * not break).
 */
class AdminOtpLoginBlockedTest extends TestCase
{
    use RefreshDatabase;

    private const ADMIN_PHONE = '09121111111';

    private const USER_PHONE = '09122222222';

    private const CODE = '54321';

    private const ADMIN_PASSWORD = 'Admin@Golestani2026!';

    private function admin(): User
    {
        $user = User::create([
            'phone' => self::ADMIN_PHONE,
            'name' => 'مدیر سامانه',
            'password' => Hash::make(self::ADMIN_PASSWORD),
            'is_active' => true,
        ]);
        $user->assignRole('admin');

        return $user;
    }

    private function tokenCount(User $user): int
    {
        return $user->tokens()->count();
    }

    /** A valid, correctly-stored OTP — the strongest possible attack input. */
    private function storeValidCode(string $phone): void
    {
        app(OtpService::class)->store($phone, self::CODE);
    }

    public function test_a_correct_otp_never_issues_an_admin_session(): void
    {
        $admin = $this->admin();
        $this->storeValidCode(self::ADMIN_PHONE);

        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::ADMIN_PHONE,
            'code' => self::CODE,
        ]);

        $response->assertForbidden();
        $response->assertJsonMissingPath('token');
        $response->assertJsonMissingPath('user');

        $this->assertSame(0, $this->tokenCount($admin), 'OTP must not mint a token for an administrator.');
        $this->assertTrue($admin->fresh()->hasRole('admin'));
    }

    public function test_repeated_otp_attempts_cannot_walk_an_admin_into_a_session(): void
    {
        $admin = $this->admin();

        foreach ([self::CODE, '11111', self::CODE] as $code) {
            // Fresh store each round: the point is that no code, correct or
            // not, ever yields a token for this account.
            $this->storeValidCode(self::ADMIN_PHONE);

            $response = $this->postJson('/api/auth/verify-otp', ['phone' => self::ADMIN_PHONE, 'code' => $code]);

            // 403 = verified code refused for an admin; 422 = bad/expired code;
            // 429 = the attempt budget tripped. None of them may be a 200.
            $this->assertContains($response->getStatusCode(), [403, 422, 429]);
        }

        $this->assertSame(0, $this->tokenCount($admin));
    }

    public function test_an_admin_phone_cannot_be_registered_through_the_otp_flow(): void
    {
        // No admin exists for this number yet: OTP verification must not create
        // an account that later gets promoted (role assignment stays a
        // server-side, out-of-band operation).
        $this->storeValidCode(self::ADMIN_PHONE);

        $this->postJson('/api/auth/verify-otp', ['phone' => self::ADMIN_PHONE, 'code' => self::CODE])
            ->assertOk();

        $created = User::where('phone', self::ADMIN_PHONE)->firstOrFail();
        $this->assertFalse($created->hasRole('admin'), 'OTP registration must never yield the admin role.');
        $this->assertTrue($created->hasRole('user'));
    }

    public function test_the_guard_does_not_break_normal_user_otp_login(): void
    {
        $user = User::create(['phone' => self::USER_PHONE, 'is_active' => true]);
        $user->assignRole('user');
        $this->storeValidCode(self::USER_PHONE);

        $this->postJson('/api/auth/verify-otp', ['phone' => self::USER_PHONE, 'code' => self::CODE])
            ->assertOk()
            ->assertJsonPath('user.roles.0', 'user')
            ->assertJsonStructure(['token']);

        $this->assertSame(1, $this->tokenCount($user));
    }

    public function test_the_password_flow_remains_the_admins_only_session_path(): void
    {
        $admin = $this->admin();

        // OTP: refused.
        $this->storeValidCode(self::ADMIN_PHONE);
        $this->postJson('/api/auth/verify-otp', ['phone' => self::ADMIN_PHONE, 'code' => self::CODE])
            ->assertForbidden();
        $this->assertSame(0, $this->tokenCount($admin));

        // Dedicated admin login: allowed (that is the intended path).
        $this->postJson('/api/auth/admin/login', [
            'identifier' => self::ADMIN_PHONE,
            'password' => self::ADMIN_PASSWORD,
        ])
            ->assertOk()
            ->assertJsonStructure(['token', 'user']);

        $this->assertSame(1, $this->tokenCount($admin));
        $this->assertSame('admin-token', $admin->tokens()->first()->name);
    }

    public function test_a_non_admin_cannot_use_the_admin_password_endpoint(): void
    {
        $user = User::create([
            'phone' => self::USER_PHONE,
            'password' => Hash::make(self::ADMIN_PASSWORD),
            'is_active' => true,
        ]);
        $user->assignRole('user');

        $this->postJson('/api/auth/admin/login', [
            'identifier' => self::USER_PHONE,
            'password' => self::ADMIN_PASSWORD,
        ])->assertForbidden();

        $this->assertSame(0, $this->tokenCount($user));
    }
}
