<?php

namespace App\Services\Payments;

/**
 * Contract for online payment gateways (ZarinPal today, others later).
 *
 * SECURITY notes for every implementation:
 *  - createPayment receives the amount from the SERVER (DB plan snapshot).
 *  - verifyPayment receives the amount from the SERVER (transaction row).
 *    The client can never influence either value.
 */
interface PaymentGatewayInterface
{
    /**
     * Create a payment session at the provider.
     *
     * @return array{authority: string, redirect_url: ?string}
     */
    public function createPayment(int $amount, string $returnUrl, array $metadata = []): array;

    /**
     * Verify a payment against the provider. Returns the verification
     * result (ok flag + provider data) — the caller's state machine decides
     * activation, never the adapter.
     *
     * @return array{ok: bool, code: ?int, ref_id: ?string, card_pan_masked: ?string, message: ?string}
     */
    public function verifyPayment(string $authority, int $amount): array;
}
