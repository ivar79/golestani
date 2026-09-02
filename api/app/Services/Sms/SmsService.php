<?php
namespace App\Services\Sms;
use App\Services\Sms\Contracts\SmsProviderInterface;
class SmsService { public function __construct(private readonly SmsProviderInterface $provider) {} public function send(string $phone,string $message): bool { return $this->provider->send($phone,$message); } }
