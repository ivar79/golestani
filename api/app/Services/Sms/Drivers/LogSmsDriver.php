<?php

namespace App\Services\Sms\Drivers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use Illuminate\Support\Facades\Log;

/**
 * Log driver: writes delivery metadata. In "demo" mode (Preview only) it also
 * makes the OTP itself observable so a reviewing client can complete login
 * without a real SMS gateway.
 *
 * The OTP is NEVER exposed in production: demo logging requires BOTH the
 * explicit OTP_DEMO_MODE flag AND a non-production environment. In production
 * the driver logs delivery metadata only, exactly as before.
 */
class LogSmsDriver implements SmsServiceInterface
{
    public function send(string $phone, string $message): bool
    {
        Log::info('OTP request sent.', [
            'phone' => $this->maskPhone($phone),
        ]);

        if ($this->shouldExposeOtp()) {
            Log::info('OTP code (demo/preview only): '.$message, [
                'phone' => $this->maskPhone($phone),
            ]);
        }

        return true;
    }

    /**
     * OTP is observable only when explicitly enabled AND not in production.
     * Both conditions must hold, so a stray OTP_DEMO_MODE=true can never leak
     * the code into a real production environment.
     */
    private function shouldExposeOtp(): bool
    {
        // Never expose the code in production, even if the flag is set.
        if ((string) config('app.env', 'production') === 'production') {
            return false;
        }

        return (bool) config('sms.otp_demo_mode', false);
    }

    private function maskPhone(string $phone): string
    {
        return '****'.substr($phone, -4);
    }
}
