<?php

namespace Tests\Security;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract Phase 7 security controls: XSS resistance.
 * Reject malicious payloads and never reflect them back in responses.
 */
class XssTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // These tests exercise validation/rejection, not throttling. Route-level
        // rate limiting is covered separately in RateLimitingTest.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    }

    public function test_script_payloads_in_phone_are_never_echoed_back(): void
    {
        $payloads = [
            '<script>alert(1)</script>',
            '<img src=x onerror=alert(1)>',
            '"><svg/onload=alert(1)>',
            'javascript:alert(1)',
        ];

        foreach ($payloads as $payload) {
            $response = $this->postJson('/api/auth/send-otp', ['phone' => $payload]);

            $response->assertStatus(422);
            $this->assertStringNotContainsString('<script>', $response->getContent());
            $this->assertStringNotContainsString('onerror', $response->getContent());
        }
    }

    public function test_script_payloads_in_code_are_rejected(): void
    {
        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => '09123456789',
            'code' => '<script>alert(1)</script>',
        ]);

        $response->assertStatus(422);
        $this->assertStringNotContainsString('<script>', $response->getContent());
    }
}
