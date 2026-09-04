<?php

namespace App\Services\Auth;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

class OtpService
{
    public const CODE_LENGTH = 5;
    public const TTL_SECONDS = 120;
    public const MAX_VERIFY_ATTEMPTS = 5;
    public const ATTEMPTS_TTL_SECONDS = 900; // 15-minute lock-out window
    public const MAX_SENDS = 3;
    public const SENDS_TTL_SECONDS = 600; // 10-minute send window

    public function generateCode(): string
    {
        return str_pad(
            (string) random_int(0, 10 ** self::CODE_LENGTH - 1),
            self::CODE_LENGTH,
            '0',
            STR_PAD_LEFT,
        );
    }

    public function store(string $phone, string $code): void
    {
        Cache::put($this->otpKey($phone), Hash::make($code), now()->addSeconds(self::TTL_SECONDS));
        Cache::forget($this->attemptsKey($phone));
    }

    public function verify(string $phone, string $code): bool
    {
        $hash = Cache::get($this->otpKey($phone));

        if (! is_string($hash) || ! Hash::check($code, $hash)) {
            return false;
        }

        Cache::forget($this->otpKey($phone));

        return true;
    }

    public function canSend(string $phone): bool
    {
        return (int) Cache::get($this->sendCountKey($phone), 0) < self::MAX_SENDS;
    }

    public function incrementSendCount(string $phone): void
    {
        $key = $this->sendCountKey($phone);
        $count = (int) Cache::get($key, 0);

        Cache::put($key, $count + 1, now()->addSeconds(self::SENDS_TTL_SECONDS));
    }

    public function canVerify(string $phone): bool
    {
        return (int) Cache::get($this->attemptsKey($phone), 0) < self::MAX_VERIFY_ATTEMPTS;
    }

    public function incrementAttempts(string $phone): void
    {
        $key = $this->attemptsKey($phone);
        $count = (int) Cache::get($key, 0);

        Cache::put($key, $count + 1, now()->addSeconds(self::ATTEMPTS_TTL_SECONDS));
    }

    public function clearAttempts(string $phone): void
    {
        Cache::forget($this->attemptsKey($phone));
    }

    public function otpKey(string $phone): string
    {
        return "otp:{$phone}";
    }

    public function attemptsKey(string $phone): string
    {
        return "otp_attempts:{$phone}";
    }

    public function sendCountKey(string $phone): string
    {
        return "otp_send:{$phone}";
    }
}
