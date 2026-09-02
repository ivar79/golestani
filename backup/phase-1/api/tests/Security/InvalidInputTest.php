<?php

namespace Tests\Security;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract Phase 7 security controls: Input validation.
 * Every malformed input must be rejected with 422 — never 500.
 */
class InvalidInputTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // These tests exercise validation/rejection, not throttling. Route-level
        // rate limiting is covered separately in RateLimitingTest.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    }

    public function test_send_otp_rejects_malformed_phones(): void
    {
        $invalid = [
            '0912345678',
            '091234567890',
            '19123456789',
            '+989123456789',
            '09123 45678',
            '091234567a',
        ];

        foreach ($invalid as $phone) {
            $this->postJson('/api/auth/send-otp', ['phone' => $phone])->assertStatus(422);
        }
    }

    public function test_verify_otp_rejects_malformed_codes(): void
    {
        $invalid = ['1234', '123456', 'abcde', '12 45', '12.45'];

        foreach ($invalid as $code) {
            $this->postJson('/api/auth/verify-otp', ['phone' => '09123456789', 'code' => $code])->assertStatus(422);
        }

        $this->postJson('/api/auth/verify-otp', ['phone' => '09123456789'])->assertStatus(422);
        $this->postJson('/api/auth/verify-otp', ['code' => '12345'])->assertStatus(422);
    }

    public function test_numeric_phone_type_is_rejected(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => 9123456789])->assertStatus(422);
    }

    public function test_empty_payload_is_rejected(): void
    {
        $this->postJson('/api/auth/send-otp', [])->assertStatus(422);
        $this->postJson('/api/auth/verify-otp', [])->assertStatus(422);
    }
}
