<?php

namespace App\Services\Sms\Drivers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Provider-neutral HTTP adapter. Provider-specific field names can be
 * configured without changing authentication or OTP business logic.
 */
class HttpSmsDriver implements SmsServiceInterface
{
    public function __construct(private readonly array $config = [])
    {
    }

    public function send(string $phone, string $message): bool
    {
        $url = (string) ($this->config['url'] ?? '');
        if ($url === '') {
            throw new RuntimeException('SMS gateway URL is not configured.');
        }

        $request = $this->request();
        $payload = [
            (string) ($this->config['phone_field'] ?? 'phone') => $phone,
            (string) ($this->config['message_field'] ?? 'message') => $message,
        ];

        $response = $request->post($url, $payload);

        if ($response->successful()) {
            Log::info('SMS gateway accepted message.', ['status' => $response->status()]);
            return true;
        }

        Log::error('SMS gateway rejected message.', ['status' => $response->status()]);
        throw new RuntimeException("SMS gateway request failed with HTTP {$response->status()}.");
    }

    private function request(): PendingRequest
    {
        $request = Http::timeout((int) ($this->config['timeout'] ?? 10))
            ->retry((int) ($this->config['retries'] ?? 0), (int) ($this->config['retry_sleep'] ?? 100));

        $headers = (array) ($this->config['headers'] ?? []);
        $apiKey = (string) ($this->config['api_key'] ?? '');
        $apiKeyHeader = (string) ($this->config['api_key_header'] ?? '');

        if ($apiKey !== '' && $apiKeyHeader !== '') {
            $headers[$apiKeyHeader] = $apiKey;
        }

        return $request->withHeaders($headers);
    }
}
