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

        return true;
    }

    private function maskPhone(string $phone): string
    {
        return '****'.substr($phone, -4);
    }
}
