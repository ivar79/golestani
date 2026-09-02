<?php

namespace Tests\Security;

use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract Phase 7 security controls: Rate Limiting.
 * send-otp: 3 per 10 minutes | verify-otp: 5 per 15 minutes (per phone).
 */
class RateLimitingTest extends TestCase
{
    use RefreshDatabase;

    public function test_send_otp_throttles_after_three_requests(): void
    {
        foreach (range(1, 3) as $i) {
            $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();
        }

        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertStatus(429);
    }

    public function test_verify_otp_locks_after_five_failed_attempts(): void
    {
        app(OtpService::class)->store('09123456789', '54321');

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/auth/verify-otp', ['phone' => '09123456789', 'code' => '00000'])->assertStatus(422);
        }

        $this->postJson('/api/auth/verify-otp', ['phone' => '09123456789', 'code' => '00000'])->assertStatus(429);
    }

    public function test_service_level_send_budget_is_per_phone(): void
    {
        $otp = app(OtpService::class);

        foreach (range(1, 3) as $i) {
            $otp->incrementSendCount('09123456789');
        }

        $this->assertFalse($otp->canSend('09123456789'));
        $this->assertTrue($otp->canSend('09121112222'));
    }
}
