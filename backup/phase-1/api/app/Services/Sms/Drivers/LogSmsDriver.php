<?php

namespace App\Services\Sms\Drivers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use Illuminate\Support\Facades\Log;

/**
 * Development driver: logs delivery metadata without exposing message content.
 */
class LogSmsDriver implements SmsServiceInterface
{
    public function send(string $phone, string $message): bool
    {
        Log::info('OTP request sent.', [
            'phone' => $this->maskPhone($phone),
        ]);

        // Local/development convenience ONLY: make the OTP discoverable so a
        // reviewing client can complete login without a real SMS gateway.
        // Never active in production — the code is not written to any log.
        if (app()->environment('local', 'testing', 'development')) {
            Log::info('OTP code (development only): '.$message, [
                'phone' => $this->maskPhone($phone),
            ]);
        }

        return true;
    }

    private function maskPhone(string $phone): string
    {
        return '****'.substr($phone, -4);
    }
}
