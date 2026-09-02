<?php
namespace App\Services\Sms\Contracts;
interface SmsProviderInterface { public function send(string $phone, string $message): bool; }
