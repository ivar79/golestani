<?php

namespace App\Services\Sms\Listeners;

/**
 * Captures the OTP at the exact moment it is issued.
 *
 * The stored OTP is a bcrypt hash in the cache, so the plaintext code is
 * unrecoverable afterwards. This listener taps the send() call and remembers
 * the last issued code for dev tooling (php artisan otp:show). It keeps the
 * code in process memory only — nothing is persisted, logged, or exposed over
 * HTTP, and the otp:show command refuses to print it outside demo mode.
 */
class LastIssuedOtp
{
    public ?string $phone = null;

    public ?string $code = null;

    public ?int $issuedAt = null;

    public function handle(string $phone, string $message): void
    {
        if (preg_match('/\b(\d{5})\b/u', $message, $m) !== 1) {
            return;
        }

        $this->phone = $phone;
        $this->code = $m[1];
        $this->issuedAt = time();
    }

    public function forPhone(string $phone): ?string
    {
        return $this->phone === $phone ? $this->code : null;
    }
}
