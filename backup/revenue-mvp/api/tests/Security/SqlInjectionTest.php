<?php

namespace Tests\Security;

use App\Models\User;
use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract Phase 7 security controls: SQL Injection resistance.
 * All inputs flow through Eloquent/Query Builder with strict validation,
 * so payloads must be rejected at the validation layer before any query.
 */
class SqlInjectionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // These tests exercise validation/rejection, not throttling. Route-level
        // rate limiting is covered separately in RateLimitingTest.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    }

    public function test_injection_payloads_in_phone_are_rejected_on_send_otp(): void
    {
        $payloads = [
            "' OR 1=1 --",
            "09123456789' OR '1'='1",
            "'; DROP TABLE users; --",
            "09123456789' UNION SELECT 1,2,3 --",
            "1' OR '1'='1' /*",
            "09123456789'; SELECT pg_sleep(5)--",
        ];

        foreach ($payloads as $payload) {
            $this->postJson('/api/auth/send-otp', ['phone' => $payload])
                ->assertStatus(422)
                ->assertJsonValidationErrors(['phone']);
        }

        $this->assertDatabaseCount('users', 0);
    }

    public function test_injection_payloads_in_code_cannot_bypass_verification(): void
    {
        app(OtpService::class)->store('09123456789', '54321');

        $payloads = [
            "' OR '1'='1",
            "' OR 1=1 --",
            "12345' --",
            "' UNION SELECT NULL --",
        ];

        foreach ($payloads as $code) {
            $this->postJson('/api/auth/verify-otp', ['phone' => '09123456789', 'code' => $code])
                ->assertStatus(422)
                ->assertJsonValidationErrors(['code']);
        }

        $this->assertSame(0, User::count());
    }
}
