<?php

namespace Tests\Feature\Console;

use App\Services\Sms\Listeners\LastIssuedOtp;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class OtpShowTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '09123456789';

    protected function setUp(): void
    {
        parent::setUp();

        // Hermetic: pin demo mode on and a non-production env regardless of
        // the host machine's .env values.
        config([
            'sms.otp_demo_mode' => true,
            'app.env' => 'local',
            'sms.driver' => 'log',
        ]);
    }

    // ─── Safety gate ────────────────────────────────────────────────────

    public function test_refuses_to_show_code_in_production_even_when_demo_flag_is_true(): void
    {
        config(['app.env' => 'production']);

        $this->artisan('otp:show', ['phone' => self::PHONE])
            ->expectsOutputToContain('never exposed')
            ->assertExitCode(1);
    }

    public function test_refuses_to_show_code_when_demo_mode_disabled(): void
    {
        config(['sms.otp_demo_mode' => false]);

        $this->artisan('otp:show', ['phone' => self::PHONE])
            ->expectsOutputToContain('never exposed')
            ->assertExitCode(1);
    }

    public function test_rejects_malformed_phone_numbers(): void
    {
        $this->artisan('otp:show', ['phone' => '12345'])
            ->expectsOutputToContain('Invalid Iranian mobile number')
            ->assertExitCode(1);
    }

    // ─── No code issued ─────────────────────────────────────────────────

    public function test_reports_failure_when_no_otp_was_issued(): void
    {
        $this->artisan('otp:show', ['phone' => self::PHONE])
            ->expectsOutputToContain('No OTP has been issued')
            ->assertExitCode(1);
    }

    public function test_does_not_leak_codes_issued_for_other_phones(): void
    {
        $last = app(LastIssuedOtp::class);
        $last->handle('09121112222', 'کد تأیید شما: 11111');

        $this->artisan('otp:show', ['phone' => self::PHONE])
            ->expectsOutputToContain('No OTP has been issued')
            ->assertExitCode(1);
    }

    // ─── Happy path ─────────────────────────────────────────────────────

    public function test_shows_the_last_code_issued_through_the_sms_pipeline(): void
    {
        // Full HTTP flow: the send-otp endpoint issues a code through the
        // real service container (driver + tee wrapper + listener).
        $this->postJson('/api/auth/send-otp', ['phone' => self::PHONE])->assertOk();

        $this->artisan('otp:show', ['phone' => self::PHONE])
            ->expectsOutputToContain('Latest OTP for')
            ->assertExitCode(0);

        // The printed digits must be exactly the ones stored in the cache.
        $last = app(LastIssuedOtp::class);
        $code = $last->forPhone(self::PHONE);
        $this->assertMatchesRegularExpression('/^\d{5}$/', (string) $code);
        $this->assertTrue(Cache::has("otp:".self::PHONE));
    }

    public function test_issue_option_generates_and_shows_a_fresh_working_code(): void
    {
        $this->artisan('otp:show', ['phone' => self::PHONE, '--issue' => true])
            ->expectsOutputToContain('Latest OTP for')
            ->assertExitCode(0);

        $code = app(LastIssuedOtp::class)->forPhone(self::PHONE);
        $this->assertMatchesRegularExpression('/^\d{5}$/', (string) $code);

        // The issued code must actually verify against the stored hash.
        $response = $this->postJson('/api/auth/verify-otp', [
            'phone' => self::PHONE,
            'code' => $code,
        ]);
        $response->assertOk();
    }
}
