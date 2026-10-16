<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Withdrawal cooldown after a BANK ACCOUNT CHANGE.
 *
 * A stolen session that can change the payout sheba and immediately request a
 * withdrawal is the single most valuable attack on this subsystem. Changing
 * the account therefore (a) requires a fresh OTP to the account's own phone,
 * and (b) freezes withdrawals for `wallet.withdrawals.bank_change_cooldown_hours`
 * (default 24h) counted from this timestamp.
 *
 * NULL means "never changed" — the FIRST registration does not start the
 * cooldown (registration is already OTP-gated, and blocking a brand-new
 * designer's first payout for a day would be pure friction). The column is set
 * only when the stored sheba actually changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('designer_bank_accounts') || Schema::hasColumn('designer_bank_accounts', 'bank_changed_at')) {
            return;
        }

        Schema::table('designer_bank_accounts', function (Blueprint $table): void {
            $table->timestamp('bank_changed_at')->nullable()->after('owner_name');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('designer_bank_accounts') || ! Schema::hasColumn('designer_bank_accounts', 'bank_changed_at')) {
            return;
        }

        Schema::table('designer_bank_accounts', function (Blueprint $table): void {
            $table->dropColumn('bank_changed_at');
        });
    }
};
