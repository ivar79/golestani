<?php

namespace App\Services\Payments;

use RuntimeException;

/** Provider unreachable / provider 5xx / request rejected. Transaction rows stay recoverable (pending). */
class PaymentGatewayException extends RuntimeException
{
    public function __construct(
        public readonly string $reason,
        string $message = '',
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message !== '' ? $message : $reason, 0, $previous);
    }
}
