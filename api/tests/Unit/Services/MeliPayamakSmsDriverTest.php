<?php

namespace Tests\Unit\Services;

use App\Services\Sms\Drivers\MeliPayamakSmsDriver;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

class MeliPayamakSmsDriverTest extends TestCase
{
    private const ENDPOINT = 'https://rest.payamak-panel.com/api/SendSMS';

    public function test_otp_message_is_sent_via_pattern_with_body_id(): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['Value' => '15180363180635879', 'retStatus' => 1], 200),
        ]);

        $driver = $this->driver(['body_id' => '37322']);

        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Http::assertSent(function ($request): bool {
            return $request->url() === self::ENDPOINT.'/BaseServiceNumber'
                && $request['username'] === 'user'
                && $request['password'] === 'pass'
                && $request['to'] === '09123456789'
                && $request['bodyId'] === '37322'
                // The single pattern variable is the OTP digits themselves.
                && $request['text'] === '12345';
        });
    }

    public function test_token_auth_mode_passes_console_token_as_password(): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['Value' => '15180363180635879'], 200),
        ]);

        $driver = $this->driver(['body_id' => '37322', 'auth' => 'token', 'token' => 'console-token']);

        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Http::assertSent(fn ($request) => $request['password'] === 'console-token');
    }

    public function test_without_body_id_it_falls_back_to_plain_send(): void
    {
        Http::fake([
            self::ENDPOINT.'/SendSMS' => Http::response(['Value' => '15180363180635879'], 200),
        ]);

        $driver = $this->driver(['from' => '50004001122333']);

        $this->assertTrue($driver->send('09123456789', 'کد تأیید شما: 12345'));

        Http::assertSent(function ($request): bool {
            return $request->url() === self::ENDPOINT.'/SendSMS'
                && $request['from'] === '50004001122333'
                && $request['text'] === 'کد تأیید شما: 12345';
        });
    }

    public function test_without_body_id_and_from_it_fails_before_any_request(): void
    {
        Http::fake();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SMS_MELIPAYAMAK_BODY_ID');

        $this->driver()->send('09123456789', 'کد تأیید شما: 12345');

        Http::assertNothingSent();
    }

    /**
     * @dataProvider documentedErrorCodes
     */
    public function test_documented_error_codes_are_mapped_to_meaningful_exceptions(string $code, string $fragment): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['Value' => $code], 200),
        ]);

        try {
            $this->driver(['body_id' => '37322'])->send('09123456789', 'کد تأیید شما: 12345');
            $this->fail("Expected RuntimeException for error code {$code}.");
        } catch (RuntimeException $e) {
            $this->assertStringContainsString($fragment, $e->getMessage(), "Wrong message for code {$code}.");
        }
    }

    public static function documentedErrorCodes(): array
    {
        return [
            'wrong credentials (0)' => ['0', 'username or password/APIKey is incorrect'],
            'no credit (2)' => ['2', 'insufficient panel credit'],
            'not sent (11)' => ['11', '"not sent"'],
            'ip not whitelisted (-109)' => ['-109', 'allowed-IP list is required'],
            'apikey required (-110)' => ['-110', 'APIKey must be used'],
        ];
    }

    public function test_unknown_error_code_still_fails_loudly(): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['Value' => '-999'], 200),
        ]);
        Log::spy();

        try {
            $this->driver(['body_id' => '37322'])->send('09123456789', 'کد 12345');
            $this->fail('Expected RuntimeException for unknown code.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('-999', $e->getMessage());
        }
    }

    public function test_http_failure_throws(): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['error' => 'boom'], 500),
        ]);
        Log::spy();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('HTTP 500');

        $this->driver(['body_id' => '37322', 'retries' => 0])->send('09123456789', 'کد 12345');
    }

    public function test_non_numeric_value_is_treated_as_accepted(): void
    {
        Http::fake([
            self::ENDPOINT.'/BaseServiceNumber' => Http::response(['Value' => 'OK-abc'], 200),
        ]);

        $this->assertTrue($this->driver(['body_id' => '37322'])->send('09123456789', 'کد 12345'));
    }

    /**
     * @param array<string, mixed> $overrides
     */
    private function driver(array $overrides = []): MeliPayamakSmsDriver
    {
        return new MeliPayamakSmsDriver(array_merge([
            'endpoint' => self::ENDPOINT,
            'username' => 'user',
            'password' => 'pass',
            'timeout' => 10,
            'retries' => 0,
        ], $overrides));
    }
}
