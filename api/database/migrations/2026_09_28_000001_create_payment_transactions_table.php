<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Online payment transactions (ZarinPal sandbox era).
 *
 * SECURITY invariants enforced at the schema level:
 *  - authority is UNIQUE (nullable until the provider returns it) — an
 *    authority can therefore belong to EXACTLY ONE transaction row, ever.
 *  - ref_id is UNIQUE (nullable) — one provider reference can never be
 *    attached to two paid rows.
 *  - subscription_id is UNIQUE (nullable) — one transaction can produce at
 *    most ONE subscription (consumption idempotency).
 *  - amount/currency/plan_id/business_id are server-written snapshots from
 *    the plans table at init time and are NEVER accepted from client input.
 *
 * State machine: pending → paid | failed | canceled | expired.
 * Only `paid` (with paid_at + verified_at) may activate a subscription, and
 * only once (subscription_id set).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained()->restrictOnDelete();
            $table->string('provider', 32)->default('zarinpal');
            $table->string('authority', 64)->nullable()->unique();
            $table->string('ref_id', 64)->nullable()->unique();
            $table->string('card_pan_masked', 32)->nullable();
            $table->unsignedBigInteger('amount');
            $table->string('currency', 10)->default('IRR');
            $table->enum('status', ['pending', 'paid', 'failed', 'canceled', 'expired'])->default('pending');
            $table->string('failure_reason', 120)->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->json('verification_payload')->nullable();
            $table->foreignId('subscription_id')->nullable()->unique()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->index(['business_id', 'status']);
            $table->index(['user_id', 'status']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_transactions');
    }
};
