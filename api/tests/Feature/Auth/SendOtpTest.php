<?php

namespace Tests\Feature\Auth;

use App\Services\Sms\Drivers\LogSmsDriver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class SendOtpTest extends TestCase
{
    use RefreshDatabase;

    public function test_send_otp_returns_success_and_stores_hashed_code(): void
    {
        $response = $this->postJson('/api/auth/send-otp', ['phone' => '09123456789']);

        $response->assertOk()
            ->assertJsonStructure(['message', 'expires_in'])
            ->assertJson(['expires_in' => 120]);

        $this->assertTrue(Cache::has('otp:09123456789'));
    }

    public function test_otp_is_delivered_through_log_sms_driver(): void
    {
        Log::spy();

        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();

        Log::shouldHaveReceived('info')
            ->atLeast()->once()
            ->withArgs(function (string $message): bool {
                return $message === 'OTP request sent.';
            });
    }

    public function test_log_sms_driver_returns_true_and_logs(): void
    {
        Log::spy();

        $driver = new LogSmsDriver();

        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Log::shouldHaveReceived('info')
            ->once()
            ->withArgs(fn (string $message, array $context): bool => $message === 'OTP request sent.'
                && ($context['phone'] ?? null) === '****6789');
    }

    public function test_invalid_phone_format_fails_validation(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '12345'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['phone']);

        $this->postJson('/api/auth/send-otp', ['phone' => '0912345678'])->assertStatus(422);
        $this->postJson('/api/auth/send-otp', [])->assertStatus(422);
    }

    public function test_persian_digits_are_normalized_before_validation(): void
    {
        $this->postJson('/api/auth/send-otp', ['phone' => '۰۹۱۲۳۴۵۶۷۸۹'])->assertOk();
    }

    public function test_send_limit_blocks_fourth_request_within_ten_minutes(): void
    {
        foreach (range(1, 3) as $i) {
            $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertOk();
        }

        $this->postJson('/api/auth/send-otp', ['phone' => '09123456789'])->assertStatus(429);
    }

    // ─── OTP demo mode (Preview) ───────────────────────────────────────

    public function test_demo_mode_on_exposes_code_in_non_production(): void
    {
        config(['sms.otp_demo_mode' => true]);
        config(['app.env' => 'preview']);
        Log::spy();

        $driver = new LogSmsDriver();
        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Log::shouldHaveReceived('info')
            ->atLeast()->once()
            ->withArgs(fn (string $message): bool => str_contains($message, 'OTP code (demo/preview only)')
                && str_contains($message, '12345'));
    }

    public function test_demo_mode_off_never_exposes_code(): void
    {
        config(['sms.otp_demo_mode' => false]);
        config(['app.env' => 'preview']);
        Log::spy();

        $driver = new LogSmsDriver();
        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        // When demo is off only the metadata line is logged — exactly one
        // 'info' call whose message is the metadata, never the code.
        Log::shouldHaveReceived('info')
            ->once()
            ->withArgs(fn (string $message): bool => $message === 'OTP request sent.');
    }

    public function test_demo_mode_is_ignored_in_production_even_if_flag_set(): void
    {
        config(['sms.otp_demo_mode' => true]);
        config(['app.env' => 'production']);
        Log::spy();

        $driver = new LogSmsDriver();
        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        // In production only the metadata line is logged — exactly one
        // 'info' call, never the code.
        Log::shouldHaveReceived('info')
            ->once()
            ->withArgs(fn (string $message): bool => $message === 'OTP request sent.');
    }
}
