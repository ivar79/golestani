<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Session-lifecycle regression (decision 2026-10-07):
 *
 *  - OTP verify is MULTI-SESSION: a second login (new tab / new device) must
 *    NOT revoke the first token. Revoking here logged every parallel session
 *    out at its next request — the "unexpectedly logged out" engine.
 *  - Admin password login stays SINGLE-SESSION by design (high-value
 *    account): a new admin login revokes all previous admin tokens.
 *  - Recovery login keeps its single-session emergency semantics.
 *  - Logout deletes ONLY the current token.
 *
 * Exposure stays capped everywhere by the 7-day Sanctum expires_at.
 *
 * NOTE: these tests authenticate with REAL bearer tokens (withToken), never
 * TestCase::actingAs (Sanctum::actingAs bypasses the token table entirely,
 * which would hide every revocation regression this file exists to catch).
 */
class TokenLifecycleRegressionTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '09123456789';
    private const CODE = '54321';

    private function seedOtp(?string $phone = null): void
    {
        app(OtpService::class)->store($phone ?? self::PHONE, self::CODE);
        app(OtpService::class)->incrementSendCount($phone ?? self::PHONE);
    }

    /**
     * Authenticated call with a REAL bearer token. ForgetGuards first: the
     * RequestGuard memoizes its user across requests inside one test process,
     * which would bypass the DB token lookup and hide every revocation
     * (production boots a fresh app per request, so only tests need this).
     */
    private function authed(string $token): \Illuminate\Testing\TestResponse
    {
        $this->app->make('auth')->forgetGuards();

        return $this->withToken($token)->getJson('/api/auth/me');
    }

    private function me(string $token): \Illuminate\Testing\TestResponse
    {
        return $this->authed($token);
    }

    public function test_second_otp_login_does_not_revoke_the_first_token(): void
    {
        $this->seedOtp();

        $first = $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertOk()
            ->json('token');

        // New code, same account — a second tab/device logging in again.
        $this->seedOtp();
        $second = $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertOk()
            ->json('token');

        $this->assertNotSame($first, $second);

        // BOTH sessions must stay alive.
        $this->me((string) $first)->assertOk();
        $this->me((string) $second)->assertOk();
    }

    public function test_logout_still_deletes_only_the_current_token(): void
    {
        $this->seedOtp();

        $first = $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertOk()->json('token');

        $this->seedOtp();
        $second = $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertOk()->json('token');

        $this->app->make('auth')->forgetGuards();
        $this->withToken((string) $second)->postJson('/api/auth/logout')->assertOk();

        $this->me((string) $second)->assertStatus(401);
        $this->me((string) $first)->assertOk('logout must not touch sibling sessions');

        // The remaining session can still log out cleanly afterwards.
        $this->app->make('auth')->forgetGuards();
        $this->withToken((string) $first)->postJson('/api/auth/logout')->assertOk();
        $this->me((string) $first)->assertStatus(401);
    }

    public function test_admin_password_login_still_revokes_previous_admin_tokens(): void
    {
        $admin = User::factory()->create([
            'phone' => '09'.fake()->numerify('#########'),
            'password' => bcrypt('secret-password'),
        ]);
        $admin->assignRole('admin');

        $first = $this->postJson('/api/auth/admin/login', [
            'identifier' => $admin->phone,
            'password' => 'secret-password',
        ])->assertOk()->json('token');

        $this->me((string) $first)->assertOk();

        $second = $this->postJson('/api/auth/admin/login', [
            'identifier' => $admin->phone,
            'password' => 'secret-password',
        ])->assertOk()->json('token');

        $this->me((string) $second)->assertOk();
        $this->me((string) $first)->assertStatus(401, 'admin stays single-session');
    }

    public function test_recovery_login_still_revokes_previous_tokens(): void
    {
        $admin = User::factory()->create([
            'phone' => '09'.fake()->numerify('#########'),
            'password' => bcrypt('secret-password'),
            'recovery_code' => bcrypt('recovery-code-1'),
        ]);
        $admin->assignRole('admin');

        // Admins are BLOCKED from OTP login by policy (dedicated admin login
        // only), so the first session comes from the password login; recovery
        // must revoke it — single-session semantics for admin surfaces.
        $first = $this->postJson('/api/auth/admin/login', [
            'identifier' => $admin->phone,
            'password' => 'secret-password',
        ])->assertOk()->json('token');

        $this->me((string) $first)->assertOk();

        $second = $this->postJson('/api/auth/verify-recovery', [
            'phone' => $admin->phone,
            'code' => 'recovery-code-1',
        ])->assertOk()->json('token');

        $this->me((string) $second)->assertOk();
        $this->me((string) $first)->assertStatus(401, 'recovery stays single-session');
    }
}
