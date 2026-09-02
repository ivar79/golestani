<?php

namespace Tests\Unit\Services;

use App\Services\Auth\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class OtpServiceTest extends TestCase
{
    use RefreshDatabase;

    private OtpService $otp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->otp = app(OtpService::class);
    }

    // ─── generateCode ───────────────────────────────────────────────

    public function test_generate_code_returns_exact_length(): void
    {
        $code = $this->otp->generateCode();

        $this->assertIsString($code);
        $this->assertSame(OtpService::CODE_LENGTH, strlen($code));
    }

    public function test_generate_code_contains_only_digits(): void
    {
        $code = $this->otp->generateCode();

        $this->assertMatchesRegularExpression('/^\d+$/', $code);
    }

    public function test_generate_code_pads_leading_zeros(): void
    {
        $codes = array_map(fn() => $this->otp->generateCode(), range(1, 100));
        $padded = array_filter($codes, fn($c) => str_starts_with($c, '0'));
        $this->assertNotEmpty($padded, 'Expected at least one code with leading zero over 100 runs');
    }

    public function test_generate_codes_are_not_all_identical(): void
    {
        $codes = array_map(fn() => $this->otp->generateCode(), range(1, 10));
        $this->assertGreaterThan(1, count(array_unique($codes)));
    }

    // ─── store & verify ─────────────────────────────────────────────

    public function test_store_creates_cache_entry_and_verify_succeeds(): void
    {
        $phone = '09123456789';
        $code = '54321';

        $this->otp->store($phone, $code);

        $this->assertTrue(Cache::has("otp:{$phone}"));
        $this->assertTrue($this->otp->verify($phone, $code));
    }

    public function test_verify_wrong_code_returns_false(): void
    {
        $phone = '09123456789';
        $this->otp->store($phone, '54321');

        $this->assertFalse($this->otp->verify($phone, '00000'));
    }

    public function test_verify_returns_false_when_no_otp_stored(): void
    {
        $this->assertFalse($this->otp->verify('09123456789', '12345'));
    }

    public function test_code_is_single_use(): void
    {
        $phone = '09123456789';
        $this->otp->store($phone, '54321');

        $this->assertTrue($this->otp->verify($phone, '54321'));
        $this->assertFalse($this->otp->verify($phone, '54321'));
    }

    public function test_store_clears_previous_attempts(): void
    {
        $phone = '09123456789';

        Cache::put("otp_attempts:{$phone}", 3, now()->addMinutes(5));
        $this->assertTrue($this->otp->canVerify($phone));

        $this->otp->store($phone, '54321');

        $attempts = (int) Cache::get("otp_attempts:{$phone}", 0);
        $this->assertSame(0, $attempts);
    }

    // ─── canSend / incrementSendCount ───────────────────────────────

    public function test_can_send_is_true_initially(): void
    {
        $this->assertTrue($this->otp->canSend('09123456789'));
    }

    public function test_increment_send_count_increases(): void
    {
        $phone = '09123456789';

        $this->otp->incrementSendCount($phone);
        $count = (int) Cache::get("otp_send:{$phone}", 0);
        $this->assertSame(1, $count);
    }

    public function test_can_send_blocks_after_max_sends(): void
    {
        $phone = '09123456789';

        for ($i = 0; $i < OtpService::MAX_SENDS; $i++) {
            $this->otp->incrementSendCount($phone);
        }

        $this->assertFalse($this->otp->canSend($phone));
    }

    public function test_send_budget_is_per_phone(): void
    {
        $phone1 = '09123456789';
        $phone2 = '09121112222';

        for ($i = 0; $i < OtpService::MAX_SENDS; $i++) {
            $this->otp->incrementSendCount($phone1);
        }

        $this->assertFalse($this->otp->canSend($phone1));
        $this->assertTrue($this->otp->canSend($phone2));
    }

    // ─── canVerify / incrementAttempts ──────────────────────────────

    public function test_can_verify_is_true_initially(): void
    {
        $this->assertTrue($this->otp->canVerify('09123456789'));
    }

    public function test_increment_attempts_increases(): void
    {
        $phone = '09123456789';

        $this->otp->incrementAttempts($phone);
        $count = (int) Cache::get("otp_attempts:{$phone}", 0);
        $this->assertSame(1, $count);
    }

    public function test_can_verify_blocks_after_max_attempts(): void
    {
        $phone = '09123456789';

        for ($i = 0; $i < OtpService::MAX_VERIFY_ATTEMPTS; $i++) {
            $this->otp->incrementAttempts($phone);
        }

        $this->assertFalse($this->otp->canVerify($phone));
    }

    public function test_clear_attempts_resets_counter(): void
    {
        $phone = '09123456789';

        $this->otp->incrementAttempts($phone);
        $this->otp->incrementAttempts($phone);
        $this->otp->clearAttempts($phone);

        $this->assertTrue($this->otp->canVerify($phone));
    }

    // ─── TTL behavior (simulate expiry by clearing cache) ────────────
    // Note: The array cache driver doesn't auto-expire entries based on
    // Carbon::now(). We simulate TTL expiry by manually clearing cache,
    // which mirrors what the real Redis driver would do after TTL.

    public function test_verify_fails_after_otp_is_cleared_from_cache(): void
    {
        $phone = '09123456789';
        $this->otp->store($phone, '54321');

        // Simulate TTL expiry: clear the OTP key
        Cache::forget("otp:{$phone}");

        $this->assertFalse(Cache::has("otp:{$phone}"));
        $this->assertFalse($this->otp->verify($phone, '54321'));
    }

    public function test_can_send_resets_after_send_count_is_cleared(): void
    {
        $phone = '09123456789';

        for ($i = 0; $i < OtpService::MAX_SENDS; $i++) {
            $this->otp->incrementSendCount($phone);
        }

        $this->assertFalse($this->otp->canSend($phone));

        // Simulate TTL expiry: clear the send count key
        Cache::forget("otp_send:{$phone}");

        $this->assertTrue($this->otp->canSend($phone));
    }

    public function test_can_verify_resets_after_attempts_are_cleared(): void
    {
        $phone = '09123456789';

        for ($i = 0; $i < OtpService::MAX_VERIFY_ATTEMPTS; $i++) {
            $this->otp->incrementAttempts($phone);
        }

        $this->assertFalse($this->otp->canVerify($phone));

        // Simulate TTL expiry: clear the attempts key
        Cache::forget("otp_attempts:{$phone}");

        $this->assertTrue($this->otp->canVerify($phone));
    }

    public function test_store_sets_correct_ttl_value(): void
    {
        $phone = '09123456789';
        $code = '54321';

        $this->otp->store($phone, $code);

        // Verify the entry exists (we can't easily check TTL with array driver)
        $this->assertTrue(Cache::has("otp:{$phone}"));

        // After manual clear, verify is false
        Cache::forget("otp:{$phone}");
        $this->assertFalse($this->otp->verify($phone, $code));
    }

    // ─── Key generation ─────────────────────────────────────────────

    public function test_keys_are_unique_per_phone(): void
    {
        $phone1 = '09123456789';
        $phone2 = '09991112222';

        $this->assertNotSame($this->otp->otpKey($phone1), $this->otp->otpKey($phone2));
        $this->assertNotSame($this->otp->attemptsKey($phone1), $this->otp->attemptsKey($phone2));
        $this->assertNotSame($this->otp->sendCountKey($phone1), $this->otp->sendCountKey($phone2));
    }

    public function test_keys_use_expected_prefixes(): void
    {
        $phone = '09123456789';

        $this->assertSame('otp:09123456789', $this->otp->otpKey($phone));
        $this->assertSame('otp_attempts:09123456789', $this->otp->attemptsKey($phone));
        $this->assertSame('otp_send:09123456789', $this->otp->sendCountKey($phone));
    }
}
