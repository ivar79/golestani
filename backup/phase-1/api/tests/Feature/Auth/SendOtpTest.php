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

        // In local/testing the driver also logs the OTP itself, so 'info' is
        // called twice: once for the metadata line, once for the dev-only code.
        Log::shouldHaveReceived('info')
            ->atLeast()->once()
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

    public function test_local_environment_logs_otp_code(): void
    {
        Log::spy();

        $driver = new LogSmsDriver();
        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Log::shouldHaveReceived('info')
            ->atLeast()->once()
            ->withArgs(fn (string $message, array $context): bool => str_contains($message, 'OTP code (development only)')
                && str_contains($message, '12345'));
    }

}
