<?php
namespace App\Services\Payments;
interface PaymentGatewayInterface { public function createPayment(int $amount,string $returnUrl,array $metadata=[]): array; public function verifyPayment(string $authority,int $amount): bool; }
