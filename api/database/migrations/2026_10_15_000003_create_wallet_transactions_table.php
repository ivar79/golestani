<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * APPEND-ONLY LEDGER (دفتر کل) — the money truth of the wallet system.
 *
 * INVARIANTS (hard rules, enforced in the model + writer service):
 *   1. Rows are NEVER updated or deleted. A correction is a NEW row with the
 *      opposite amount (`commission_reversed`, `adjustment`). The model throws
 *      on update/delete so a stray ->save() cannot rewrite history.
 *   2. `idempotency_key` is UNIQUE, which is what makes commission accrual
 *      exactly-once. Keys: `commission:payment:{payment_transaction_id}`
 *      (online purchase/renewal), `commission:order:{subscription_id}`
 *      (manual/receipt purchase — see below), and `reverse:…` for reversals.
 *      This replaces the brief's (type, subscription_id) unique index, which
 *      could not pay a RENEWAL: an online renewal extends the SAME
 *      subscription row instead of creating a new one.
 *   3. Money is integer RIAL, signed (`amount` positive = credited to the
 *      designer, negative = debited). `balance_after` is the wallet balance
 *      immediately after this row — the audit trail that lets an admin
 *      recompute the whole history.
 *
 * WHY TWO PURCHASE EVENTS: online payments have their own audited row
 * (payment_transactions); a manual/receipt purchase has no gateway row, so its
 * unique purchase event IS the subscription row created by
 * SubscriptionController@store (receipt_reference = the manual transfer ref).
 * Both columns are nullable and the idempotency_key says which one applies.
 *
 * TIMESTAMPS: `created_at` only (useCurrent) — an immutable ledger row has no
 * `updated_at` to speak of, so the model runs with $timestamps = false and the
 * writer sets created_at explicitly (never client input).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('wallet_transactions')) {
            return;
        }

        Schema::create('wallet_transactions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('wallet_id')->constrained()->cascadeOnDelete();
            $table->enum('type', [
                'commission_accrued',
                'withdrawal_hold',
                'withdrawal_paid',
                'withdrawal_released',
                'commission_reversed',
                'adjustment',
            ]);
            $table->bigInteger('amount');
            $table->bigInteger('balance_after');
            $table->string('idempotency_key', 191)->unique();
            $table->string('reference_type', 64)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->foreignId('subscription_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('payment_transaction_id')->nullable()->constrained()->nullOnDelete();
            $table->text('description')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['wallet_id', 'created_at']);
            $table->index(['wallet_id', 'type']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transactions');
    }
};
