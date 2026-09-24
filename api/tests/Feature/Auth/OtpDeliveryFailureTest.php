<?php

namespace Tests\Feature\Auth;

use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Support\Digits;
use Illuminate\Support\Facades\Cache;
use RuntimeException;
use Tests\TestCase;

class OtpDeliveryFailureTest extends TestCase
{
    private const PHONE = '09123456789';

    public function test_provider_failure_returns_503_and_rolls_back_the_code(): void
    {
        // A throwing provider simulates timeout/5xx/rejection from a real gateway.
        $this->app->bind(SmsServiceInterface::class, function () {
            return new class implements SmsServiceInterface
            {
                public function send(string $phone, string $message): bool
                {
                    throw new RuntimeException('provider down');
                }
            };
        });

        $response = $this->postJson('/api/auth/send-otp', ['phone' => self::PHONE]);

        $response->assertStatus(503)
            ->assertJsonPath('message', 'ارسال پیامک موقتاً ممکن نیست. لطفاً چند لحظه دیگر دوباره تلاش کنید.');

        // No usable OTP left in the cache.
        $otpKey = 'otp:'.self::PHONE;
        $this->assertNull(Cache::get($otpKey));

        // The send budget was refunded (0 remaining, not 1): the user can
        // immediately retry without burning their 10-minute window.
        $this->assertSame(0, (int) Cache::get('otp_send:'.self::PHONE, 0));
    }

    public function test_user_can_retry_after_a_failed_send(): void
    {
        $fails = true;
        $this->app->bind(SmsServiceInterface::class, function () use (&$fails) {
            return new class($fails) implements SmsServiceInterface
            {
                public function __construct(private bool &$fails) {}

                public function send(string $phone, string $message): bool
                {
                    if ($this->fails) {
                        throw new RuntimeException('provider down');
                    }

                    return true;
                }
            };
        });

        $this->postJson('/api/auth/send-otp', ['phone' => self::PHONE])->assertStatus(503);

        $fails = false;

        $this->postJson('/api/auth/send-otp', ['phone' => self::PHONE])->assertOk();
    }

    public function test_log_driver_success_path_is_unchanged(): void
    {
        // Default test env uses the log driver: success must keep the old shape.
        $response = $this->postJson('/api/auth/send-otp', ['phone' => self::PHONE]);

        $response->assertOk()
            ->assertJsonPath('message', 'کد ارسال شد')
            ->assertJsonPath('expires_in', 120);

        $this->assertNotNull(Cache::get('otp:'.self::PHONE));
    }
}
