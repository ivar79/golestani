<?php

namespace App\Services\Sms\Drivers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * MeliPayamak (ملی‌پیامک) adapter.
 *
 * Endpoint (official sample repo Melipayamak/melipayamak-python, sms/rest.py):
 *   POST https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber
 *     username, password, to, text[] (pattern variables), bodyId
 *
 * The OTP path uses the shared service line + pattern (bodyId): no dedicated
 * sender line is required and delivery to blacklisted numbers works. When no
 * bodyId is configured the driver falls back to the plain-text send endpoint
 * with an explicit dedicated sender line (from).
 *
 * Auth modes (SMS_MELIPAYAMAK_AUTH):
 *  - "password" (classic panel): SMS_MELIPAYAMAK_USERNAME + SMS_MELIPAYAMAK_PASSWORD
 *  - "token" (REST console):     SMS_MELIPAYAMAK_TOKEN is used as the password
 *
 * The response value is an accepted-request identifier (recId) or a numeric
 * error code — it is NOT proof of handset delivery (polling GetDeliveries2 is
 * out of scope for auth). return=true in the JSON body means "accepted".
 *
 * This driver never logs the OTP plaintext, only masked metadata.
 */
class MeliPayamakSmsDriver implements SmsServiceInterface
{
    private const DEFAULT_ENDPOINT = 'https://rest.payamak-panel.com/api/SendSMS';

    /**
     * A successful send returns a recId longer than 15 digits; error codes are
     * small numbers (… -110 to 19). Anything at or above this threshold is a
     * recId, not an error.
     */
    private const REC_ID_THRESHOLD = 10 ** 15;

    /** Documented numeric result codes (melipayamak.com/api docs). */
    private const ERRORS = [
        0 => 'MeliPayamak: username or password/APIKey is incorrect.',
        2 => 'MeliPayamak: insufficient panel credit.',
        3 => 'MeliPayamak: daily send limit reached.',
        7 => 'MeliPayamak: message contains a filtered word.',
        10 => 'MeliPayamak: panel is not active.',
        11 => 'MeliPayamak: request is in "not sent" state.',
        12 => 'MeliPayamak: panel documents/verification incomplete.',
        19 => 'MeliPayamak: hourly send limit exceeded.',
        -1 => 'MeliPayamak: web service access is disabled — contact support.',
        -3 => 'MeliPayamak: sender line is not defined in the system.',
        -4 => 'MeliPayamak: bodyId is invalid or not approved yet.',
        -5 => 'MeliPayamak: pattern variables do not match the approved template.',
        -7 => 'MeliPayamak: sender line error — contact support.',
        -108 => 'MeliPayamak: this IP is blocked after failed API attempts.',
        -109 => 'MeliPayamak: allowed-IP list is required — whitelist this server IP in the panel.',
        -110 => 'MeliPayamak: APIKey must be used instead of the panel password.',
    ];

    public function __construct(private readonly array $config = [])
    {
    }

    public function send(string $phone, string $message): bool
    {
        $code = $this->extractCode($message);

        if ($code !== null && ! empty($this->config['body_id'])) {
            return $this->sendPattern($phone, $code);
        }

        return $this->sendPlain($phone, $message);
    }

    /**
     * Extract the OTP digits from the message body, e.g.
     * "کد تأیید شما: 12345" -> "12345". Same shape as LastIssuedOtp.
     */
    private function extractCode(string $message): ?string
    {
        return preg_match('/\b(\d+)\b/u', $message, $m) === 1 ? $m[1] : null;
    }

    private function sendPattern(string $phone, string $code): bool
    {
        // The approved OTP template has exactly one variable: the code itself.
        // Order matters: SendByBaseNumber expects pattern variables in order.
        $payload = [
            'username' => $this->username(),
            'password' => $this->password(),
            'to' => $phone,
            'bodyId' => (string) $this->config['body_id'],
            'text' => $code,
        ];

        $url = rtrim($this->endpoint(), '/').'/BaseServiceNumber';

        $response = $this->request()->post($url, $payload);

        return $this->interpret($response, 'pattern');
    }

    private function sendPlain(string $phone, string $message): bool
    {
        $from = trim((string) ($this->config['from'] ?? ''));

        if ($from === '') {
            // Without a bodyId AND without a dedicated sender line there is no
            // valid sending route — fail loudly instead of guessing.
            throw new RuntimeException(
                'MeliPayamak: either SMS_MELIPAYAMAK_BODY_ID (pattern) or SMS_MELIPAYAMAK_FROM (dedicated line) must be configured.'
            );
        }

        $payload = [
            'username' => $this->username(),
            'password' => $this->password(),
            'to' => $phone,
            'from' => $from,
            'text' => $message,
            'isFlash' => false,
        ];

        $url = rtrim($this->endpoint(), '/').'/SendSMS';

        $response = $this->request()->post($url, $payload);

        return $this->interpret($response, 'plain');
    }

    private function interpret(\Illuminate\Http\Client\Response $response, string $mode): bool
    {
        if (! $response->successful()) {
            Log::error('MeliPayamak HTTP error.', ['mode' => $mode, 'status' => $response->status()]);

            throw new RuntimeException("MeliPayamak request failed with HTTP {$response->status()}.");
        }

        // REST wrapper returns {"Value": "<recId or error code>", "retStatus": n, "retStatusValue": "..."}.
        // The code number itself arrives as a JSON string in "Value".
        $body = (string) $response->json('Value', '');
        $code = is_numeric($body) ? (int) $body : null;

        // Numeric codes are ALL failures except "1" (documented success) and
        // the >15-digit recId. This covers negative system errors (0, -1 …
        // -110) AND positive provider rejections (2 no-credit, 3 daily limit,
        // 11 not-sent, 19 hourly limit, …).
        if ($code !== null && $code !== 1 && abs($code) < self::REC_ID_THRESHOLD) {
            Log::error('MeliPayamak rejected the message.', ['mode' => $mode, 'code' => $body]);

            throw new RuntimeException(self::ERRORS[$code] ?? "MeliPayamak unknown error code {$body}.");
        }

        // "1" (SendSms success) or a non-numeric recId string: the request was accepted.
        Log::info('MeliPayamak accepted the message.', ['mode' => $mode]);

        return true;
    }

    private function request(): PendingRequest
    {
        // No ->throw(): transport-level failures (timeouts) are retried, HTTP
        // error responses reach interpret() which maps them to a RuntimeException.
        return Http::timeout((int) ($this->config['timeout'] ?? 10))
            ->retry((int) ($this->config['retries'] ?? 2), (int) ($this->config['retry_sleep'] ?? 200))
            ->asForm();
    }

    private function endpoint(): string
    {
        return (string) ($this->config['endpoint'] ?? self::DEFAULT_ENDPOINT);
    }

    private function username(): string
    {
        return (string) ($this->config['username'] ?? '');
    }

    private function password(): string
    {
        // "token" mode (REST console) reuses the password field: the console
        // token is passed as the password parameter.
        return $this->authMode() === 'token'
            ? (string) ($this->config['token'] ?? '')
            : (string) ($this->config['password'] ?? '');
    }

    private function authMode(): string
    {
        return (string) ($this->config['auth'] ?? 'password');
    }
}
