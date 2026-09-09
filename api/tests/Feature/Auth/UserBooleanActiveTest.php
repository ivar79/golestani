<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Feature coverage for the production-incident fix (SQLSTATE[42804]).
 *
 * SQLite (the phpunit.xml default) stores booleans as 0/1 integers and
 * accepts them natively, so these tests primarily guard behavior and the
 * raw stored value on SQLite. The PostgreSQL-specific binding proof lives
 * in PostgresIsActiveBooleanTest (skips without a pgsql test server).
 */
class UserBooleanActiveTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '09351234567';

    private const CODE = '13579';

    private function seedOtp(): void
    {
        app(OtpService::class)->store(self::PHONE, self::CODE);
        app(OtpService::class)->incrementSendCount(self::PHONE);
    }

    public function test_new_user_registration_stores_a_real_boolean_is_active(): void
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
        $this->assertTrue($user->is_active, 'Eloquent boolean cast must report true');

        // Raw driver-level value, bypassing every cast layer.
        $raw = DB::table('users')->where('phone', self::PHONE)->value('is_active');
        $this->assertSame(1, (int) $raw, 'Raw value must be truthy (SQLite 1 / pgsql true)');
        $this->assertNotSame('1', $raw, 'Must not be stored as a string');
    }

    public function test_verify_otp_returns_a_token_that_authenticates(): void
    {
        $this->seedOtp();

        $token = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::PHONE,
            'code' => self::CODE,
        ])->assertOk()->json('token');

        $this->assertIsString($token);
        $this->assertNotSame('', $token);

        $this->withToken($token)->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson(['phone' => self::PHONE]);
    }

    public function test_inactive_user_is_blocked_from_verification(): void
    {
        User::create(['phone' => self::PHONE, 'is_active' => false]);

        $this->seedOtp();

        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::PHONE,
            'code' => self::CODE,
        ])->assertStatus(403);

        $this->assertArrayNotHasKey('token', (array) $response->json());

        $raw = DB::table('users')->where('phone', self::PHONE)->value('is_active');
        $this->assertSame(0, (int) $raw, 'Raw value must be falsy (SQLite 0 / pgsql false)');
    }

    public function test_direct_model_create_keeps_boolean_semantics_both_ways(): void
    {
        $active = User::create(['phone' => '09350000001', 'is_active' => true]);
        $inactive = User::create(['phone' => '09350000002', 'is_active' => false]);

        $this->assertTrue($active->fresh()->is_active);
        $this->assertFalse($inactive->fresh()->is_active);

        $rawActive = DB::table('users')->where('phone', '09350000001')->value('is_active');
        $rawInactive = DB::table('users')->where('phone', '09350000002')->value('is_active');
        $this->assertSame(1, (int) $rawActive);
        $this->assertSame(0, (int) $rawInactive);
    }

    public function test_unexpected_server_errors_return_a_generic_json_message_to_api_clients(): void
    {
        // The generic-500 handler intentionally stands down while APP_DEBUG is
        // on (developers need details). Simulate the production value here.
        config(['app.debug' => false]);

        // Force an unexpected (non-HTTP) exception inside the auth flow.
        $this->swap(OtpService::class, new class extends OtpService
        {
            public function verify(string $phone, string $code): bool
            {
                throw new \RuntimeException('internal detail: insert into "users" ...');
            }
        });

        $this->seedOtp();

        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::PHONE,
            'code' => self::CODE,
        ]);

        $response->assertStatus(500)
            ->assertJson(['message' => 'خطای غیرمنتظره‌ای رخ داد. لطفاً بعداً دوباره تلاش کنید.']);

        $body = $response->getContent();
        $this->assertStringNotContainsString('insert into', $body, 'Raw SQL must never leak to the client');
        $this->assertStringNotContainsString('internal detail', $body, 'Exception message must never leak to the client');
    }
}
