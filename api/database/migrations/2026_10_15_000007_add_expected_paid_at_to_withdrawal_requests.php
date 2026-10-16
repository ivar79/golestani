<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The admin records WHEN the money is expected to land.
 *
 * `expected_paid_at` is set (optionally) at approval time and is the promise
 * the designer sees on their wallet page and in the notification — the payout
 * itself is still a MANUAL bank transfer, so this is an estimate, never an
 * automatic transfer date. It defaults to approval + the admin-configured
 * settlement window (App\Services\Wallet\WalletSettings), which is why it can
 * be filled even when the admin does not type a date.
 *
 * It is deliberately a SEPARATE column from `paid_at` (the factual stamp of the
 * manual transfer): the estimate must never be mistaken for the settlement.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('withdrawal_requests') || Schema::hasColumn('withdrawal_requests', 'expected_paid_at')) {
            return;
        }

        Schema::table('withdrawal_requests', function (Blueprint $table): void {
            $table->timestamp('expected_paid_at')->nullable()->after('paid_at');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('withdrawal_requests') || ! Schema::hasColumn('withdrawal_requests', 'expected_paid_at')) {
            return;
        }

        Schema::table('withdrawal_requests', function (Blueprint $table): void {
            $table->dropColumn('expected_paid_at');
        });
    }
};
