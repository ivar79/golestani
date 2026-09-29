<?php

namespace App\Services\Payments;

use Illuminate\Support\Facades\Http;

/**
 * ZarinPal v4 adapter (sandbox + production).
 *
 * SECURITY:
 *  - The merchant credential comes exclusively from config (env). It is
 *    never logged, never returned to clients, never embedded in URLs.
 *  - The AMOUNT sent to verify comes from the caller (the DB transaction
 *    row) — never from client input.
 *  - Errors (network, timeout, provider 5xx) throw PaymentGatewayException
 *    so the caller keeps the transaction row in `pending` (recoverable)
 *    instead of guessing a state.
 */
class ZarinPalGateway implements PaymentGatewayInterface
{
    /** Verification success codes (v4 API): 100 = verified, 101 = already verified. */
    public const VERIFY_OK = 100;

    public const VERIFY_ALREADY = 101;

    public function __construct(
        private readonly string $merchantId,
        private readonly bool $sandbox,
        private readonly int $timeout = 15,
    ) {}

    /** Build from config — the only production entry point. */
    public static function fromConfig(): self
    {
        $env = (string) config('zarinpal.env', 'sandbox');

        if ($env === 'production') {
            $merchant = (string) config('zarinpal.merchant_id', '');
            abort_if($merchant === '', 500, 'ZARINPAL_MERCHANT_ID is not configured for production.');
            $sandbox = false;
        } else {
            $merchant = (string) (config('zarinpal.merchant_id', '') ?: config('zarinpal.sandbox_merchant_id'));
            $sandbox = true;
        }

        return new self($merchant, $sandbox, (int) config('zarinpal.request_timeout', 15));
    }

    public function isSandbox(): bool
    {
        return $this->sandbox;
    }

    /**
     * Create a payment session. Returns:
     *  - authority: the provider token (empty string on failure)
     *  - redirect_url: StartPay URL for browser redirection (null on failure)
     *
     * @return array{authority: string, redirect_url: ?string}
     */
    public function createPayment(int $amount, string $returnUrl, array $metadata = []): array
    {
        $payload = [
            'merchant_id' => $this->merchantId,
            'amount' => $amount,
            'callback_url' => $returnUrl,
            'description' => (string) ($metadata['description'] ?? 'خرید اشتراک اینکارت'),
            'metadata' => array_filter([
                'email' => $metadata['email'] ?? null,
                'mobile' => $metadata['mobile'] ?? null,
            ], fn ($v) => $v !== null),
        ];

        try {
            $response = $this->client()
                ->acceptJson()
                ->post($this->url('request'), $payload);
        } catch (\Throwable $e) {
            report($e);
            throw new PaymentGatewayException('provider_unreachable', previous: $e);
        }

        if ($response->status() >= 500) {
            throw new PaymentGatewayException('provider_error_'.$response->status());
        }

        $body = $response->json() ?? [];
        $code = (int) ($body['data']['code'] ?? 0);

        if ($code !== 100 || empty($body['data']['authority'])) {
            $message = (string) ($body['errors']['message'] ?? $body['data']['message'] ?? 'unknown');
            throw new PaymentGatewayException('request_rejected: '.$message);
        }

        $authority = (string) $body['data']['authority'];

        return [
            'authority' => $authority,
            'redirect_url' => $this->startPayUrl($authority),
        ];
    }

    /**
     * Verify a payment for the GIVEN amount (always the DB row's amount).
     *
     * @return array{ok: bool, code: ?int, ref_id: ?string, card_pan_masked: ?string, message: ?string}
     */
    public function verifyPayment(string $authority, int $amount): array
    {
        try {
            $response = $this->client()
                ->acceptJson()
                ->post($this->url('verify'), [
                    'merchant_id' => $this->merchantId,
                    'amount' => $amount,
                    'authority' => $authority,
                ]);
        } catch (\Throwable $e) {
            report($e);
            throw new PaymentGatewayException('provider_unreachable', previous: $e);
        }

        if ($response->status() >= 500) {
            throw new PaymentGatewayException('provider_error_'.$response->status());
        }

        $body = $response->json() ?? [];
        $data = is_array($body['data'] ?? null) ? $body['data'] : [];
        $code = isset($data['code']) ? (int) $data['code'] : null;

        if ($code === self::VERIFY_OK || $code === self::VERIFY_ALREADY) {
            return [
                'ok' => true,
                'code' => $code,
                'ref_id' => isset($data['ref_id']) ? (string) $data['ref_id'] : null,
                'card_pan_masked' => isset($data['card_pan']) ? (string) $data['card_pan'] : null,
                // 101 = already verified: genuine but consumed; the state
                // machine (not this flag) decides idempotency.
                'message' => $code === self::VERIFY_ALREADY ? 'already_verified' : null,
            ];
        }

        $message = (string) ($body['errors']['message'] ?? $data['message'] ?? 'verification_failed');

        return ['ok' => false, 'code' => $code, 'ref_id' => null, 'card_pan_masked' => null, 'message' => $message];
    }

    public function startPayUrl(string $authority): string
    {
        return $this->url('start_pay').$authority;
    }

    /**
     * Shared HTTP client (timeout + optional local-CA override).
     * TLS VERIFICATION IS NEVER DISABLED. Some Windows dev machines lack a
     * system CA bundle, which makes EVERY https call fail with cURL error 60
     * — a local broken-trust-store problem, not a reason to ship insecure
     * HTTP. ZARINPAL_CACERT (absolute path to a PEM bundle, e.g. the
     * cacert.pem shipped by Composer) re-enables verification against an
     * explicit bundle. Unset (default) = normal system verification.
     */
    private function client(): \Illuminate\Http\Client\PendingRequest
    {
        $request = Http::timeout($this->timeout);
        $caInfo = (string) config('zarinpal.cacert', '');

        return $caInfo !== '' ? $request->withOptions(['curl' => [CURLOPT_CAINFO => $caInfo]]) : $request;
    }

    private function url(string $key): string
    {
        $envKey = $this->sandbox ? 'sandbox' : 'production';

        return (string) config("zarinpal.urls.{$envKey}.{$key}");
    }
}
