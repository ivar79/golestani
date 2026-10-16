<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Designer withdrawal requests — MANUAL SETTLEMENT ONLY.
 *
 * No payment gateway, no bank API, no automatic transfer is involved
 * anywhere: the designer asks for a payout, the admin pays it outside the
 * system (پایا / اینترنت‌بانک) and records the tracking number in
 * `payment_reference`. The system only records and confirms.
 *
 * SHEBA IS SNAPSHOT, NOT REFERENCED: the request stores the sheba (IR + 24
 * digits = 26 chars) and its holder name exactly as submitted. If the designer
 * later edits the bank account, the already-submitted (and possibly already
 * paid) request must keep showing where that money was actually sent.
 *
 * STATUS MACHINE (terminal states are final — never editable):
 *   pending → approved → paid      (paid requires payment_reference)
 *   pending → rejected             (reason required; money returns to balance)
 *   pending → cancelled            (by the designer, before review)
 * `reviewed_at` stamps approve/reject, `paid_at` stamps the manual payment.
 *
 * AT MOST ONE OPEN (pending/approved) REQUEST PER USER: enforced in
 * App\Services\Wallet\WithdrawalService inside a DB::transaction under the
 * wallet row lock, so two simultaneous submissions cannot both hold money.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('withdrawal_requests')) {
            return;
        }

        Schema::create('withdrawal_requests', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('amount');
            $table->string('sheba', 26);
            $table->string('owner_name', 120);
            $table->enum('status', ['pending', 'approved', 'paid', 'rejected', 'cancelled'])->default('pending');
            $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('admin_note')->nullable();
            $table->string('payment_reference', 160)->nullable();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'requested_at']);
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('withdrawal_requests');
    }
};
