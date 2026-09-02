<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class EdgeCaseTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // Remove route-level throttle for most tests (not testing rate limiting here)
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    }

    // ─── OTP edge cases ─────────────────────────────────────────────

    public function test_send_otp_does_not_create_user_before_verify(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();

        $this->assertDatabaseMissing('users', ['phone' => '09123456789']);
    }

    public function test_verify_creates_user_with_default_user_role(): void
    {
        app(OtpService::class)->store('09123456789', '12345');
        app(OtpService::class)->incrementSendCount('09123456789');

        $this->postJson('/api/auth/verify-otp', [
            'phone' => '09123456789',
            'code' => '12345',
        ])->assertOk();

        $user = User::where('phone', '09123456789')->first();
        $this->assertNotNull($user);
        $this->assertTrue($user->hasRole('user'));
        $this->assertTrue($user->is_active);
    }

    public function test_verify_existing_user_does_not_change_role(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('business_owner');

        app(OtpService::class)->store('09123456789', '12345');
        app(OtpService::class)->incrementSendCount('09123456789');

        $this->postJson('/api/auth/verify-otp', [
            'phone' => '09123456789',
            'code' => '12345',
        ])->assertOk();

        $fresh = $user->fresh();
        $this->assertTrue($fresh->hasRole('business_owner'));
        $this->assertFalse($fresh->hasRole('user'));
    }

    public function test_inactive_user_is_rejected_even_with_valid_code(): void
    {
        User::create(['phone' => '09123456789', 'is_active' => false]);

        app(OtpService::class)->store('09123456789', '12345');
        app(OtpService::class)->incrementSendCount('09123456789');

        $this->postJson('/api/auth/verify-otp', [
            'phone' => '09123456789',
            'code' => '12345',
        ])->assertStatus(403);
    }

    public function test_phone_with_plus_prefix_is_rejected(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '+989123456789'])
            ->assertStatus(422);
    }

    public function test_phone_with_wrong_length_is_rejected(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '091234567'])
            ->assertStatus(422);

        $this->postJson('/api/auth/send-otp', ['phone' => '091234567890'])
            ->assertStatus(422);
    }

    public function test_empty_phone_is_rejected(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => ''])
            ->assertStatus(422);
    }

    public function test_persian_digits_are_normalized_in_send_otp(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '۰۹۱۲۳۴۵۶۷۸۹'])
            ->assertOk();
    }

    public function test_arabic_digits_are_normalized_in_send_otp(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '٠٩١٢٣٤٥٦٧٨٩'])
            ->assertOk();
    }

    public function test_persian_digits_are_normalized_in_verify_otp(): void
    {
        app(OtpService::class)->store('09123456789', '12345');
        app(OtpService::class)->incrementSendCount('09123456789');

        $this->postJson('/api/auth/verify-otp', [
            'phone' => '۰۹۱۲۳۴۵۶۷۸۹',
            'code' => '۱۲۳۴۵',
        ])->assertOk();
    }

    // ─── Token behavior ─────────────────────────────────────────────

    public function test_me_returns_user_data(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');
        $token = $user->createToken('test')->plainTextToken;

        $this->withToken($token)->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonStructure(['id', 'phone', 'roles', 'created_at']);
    }

    public function test_me_without_token_returns_401(): void
    {
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_logout_revokes_token(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $token = $user->createToken('test')->plainTextToken;

        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();

        $this->app->make('auth')->forgetGuards();

        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_logout_without_token_returns_401(): void
    {
        $this->postJson('/api/auth/logout')->assertUnauthorized();
    }

    // ─── Concurrent same-phone logins ───────────────────────────────

    public function test_two_different_codes_for_same_phone_last_wins(): void
    {
        // First OTP
        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();
        $firstHash = Cache::get('otp:09123456789');

        // Second OTP (resend)
        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();
        $secondHash = Cache::get('otp:09123456789');

        // They should be different hashes (different codes)
        $this->assertNotSame($firstHash, $secondHash);
    }

    // ─── Health endpoint ────────────────────────────────────────────

    public function test_health_endpoint_returns_ok(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJson(['status' => 'ok']);
    }
}
