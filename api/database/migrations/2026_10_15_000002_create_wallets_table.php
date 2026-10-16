<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ONE wallet per designer user (decision: wallets.user_id unique).
 *
 * MONEY UNIT: both balances are integer RIAL (never float/decimal).
 *
 * SIGNED, NOT UNSIGNED — deliberate: a commission REVERSAL (subscription
 * rejected after it had accrued) may push a designer's balance below zero.
 * The ledger must record that truth instead of failing the insert (Postgres
 * rejects negative values in an unsigned integer) and the designer simply
 * pays it back out of the next commissions. The negative balance is shown to
 * the admin (decision 4).
 *
 *   balance         — withdrawable money (commission accrued, minus holds,
 *                     minus money already paid out via withdrawal requests)
 *   pending_balance — money held by OPEN withdrawal requests; it leaves
 *                     `balance` the moment a request is submitted and only
 *                     disappears (or comes back) when the request is paid or
 *                     cancelled/rejected.
 *
 * Withdrawable amount at any instant = balance − pending_balance, and a new
 * request is only accepted while that value is positive.
 *
 * Every mutation happens under a row lock inside DB::transaction
 * (App\Services\Wallet\WalletLedger) — never a bare increment.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('wallets')) {
            return;
        }

        Schema::create('wallets', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->bigInteger('balance')->default(0);
            $table->bigInteger('pending_balance')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallets');
    }
};
