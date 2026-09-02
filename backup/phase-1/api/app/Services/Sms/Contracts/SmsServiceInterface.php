<?php

namespace App\Services\Sms\Contracts;

interface SmsServiceInterface
{
    /**
     * Send a text message to the given Iranian mobile number.
     */
    public function send(string $phone, string $message): bool;
}
