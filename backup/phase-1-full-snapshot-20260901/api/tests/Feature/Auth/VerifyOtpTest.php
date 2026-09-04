<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class VerifyOtpTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '09123456789';
    private const CODE = '54321';

    private function seedOtp(): void
    {
        app(OtpService::class)->store(self::PHONE, self::CODE);
        app(OtpService::class)->incrementSendCount(self::PHONE);
    }

    public function test_valid_code_returns_bearer_token_and_creates_user_with_default_role(): void
    {
        $this->seedOtp();

        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::PHONE,
            'code' => self::CODE,
        ]);

        $response->assertOk()
            ->assertJsonStructure(['token', 'token_type', 'user' => ['id', 'phone', 'roles']])
            ->assertJson(['token_type' => 'Bearer']);

        $user = User::where('phone', self::PHONE)->firstOrFail();
        $this->assertTrue($user->hasRole('user'));
        $this->assertTrue($user->is_active);

        $this->withToken((string) $response->json('token'))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson(['phone' => self::PHONE]);
    }

    public function test_wrong_code_fails_and_does_not_create_user(): void
    {
        $this->seedOtp();

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => '00000'])
            ->assertStatus(422);

        $this->assertTrue(User::where('phone', self::PHONE)->doesntExist());
    }

    public function test_account_locks_after_five_failed_attempts_even_with_correct_code(): void
    {
        $this->seedOtp();

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => '00000'])
                ->assertStatus(422);
        }

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertStatus(429);
    }

    public function test_expired_code_is_rejected(): void
    {
        $this->seedOtp();

        // Simulate TTL expiry by clearing the OTP cache key
        Cache::forget("otp:" . self::PHONE);

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertStatus(422);
    }

    public function test_existing_user_keeps_roles_and_gets_new_token(): void
    {
        $user = User::create(['phone' => self::PHONE, 'is_active' => true]);
        $user->assignRole('business_owner');

        $this->seedOtp();

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertOk();

        $fresh = $user->fresh();
        $this->assertTrue($fresh->hasRole('business_owner'));
        $this->assertFalse($fresh->hasRole('user'));
    }

    public function test_inactive_user_is_rejected(): void
    {
        User::create(['phone' => self::PHONE, 'is_active' => false]);

        $this->seedOtp();

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])
            ->assertStatus(403);
    }

    public function test_code_is_single_use(): void
    {
        $this->seedOtp();

        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])->assertOk();
        $this->postJson('/api/auth/verify-otp', ['phone' => self::PHONE, 'code' => self::CODE])->assertStatus(422);
    }
}
