<?php

namespace Tests\Unit\Services;

use App\Services\Sms\Drivers\HttpSmsDriver;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

class HttpSmsDriverTest extends TestCase
{
    public function test_it_posts_configured_payload_and_api_key(): void
    {
        Http::fake(['https://sms.test/send' => Http::response(['ok' => true], 200)]);

        $driver = new HttpSmsDriver([
            'url' => 'https://sms.test/send',
            'api_key' => 'secret',
            'api_key_header' => 'X-API-Key',
            'phone_field' => 'receptor',
            'message_field' => 'body',
            'retries' => 0,
        ]);

        $this->assertTrue($driver->send('09123456789', 'کد تأیید: 12345'));

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://sms.test/send'
                && $request->header('X-API-Key')[0] === 'secret'
                && $request['receptor'] === '09123456789'
                && $request['body'] === 'کد تأیید: 12345';
        });
    }

    public function test_missing_url_fails_without_making_a_request(): void
    {
        Http::fake();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SMS gateway URL is not configured.');

        (new HttpSmsDriver())->send('09123456789', 'test');
        Http::assertNothingSent();
    }

    public function test_failed_response_is_logged_and_throws(): void
    {
        Http::fake(['https://sms.test/send' => Http::response(['error' => 'bad'], 422)]);
        Log::spy();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('HTTP 422');

        try {
            (new HttpSmsDriver(['url' => 'https://sms.test/send', 'retries' => 0]))
                ->send('09123456789', 'test');
        } finally {
            Log::shouldHaveReceived('error')->once();
        }
    }
}
