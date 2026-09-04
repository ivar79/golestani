<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained()->restrictOnDelete();
            $table->enum('status', ['pending_receipt', 'active', 'rejected', 'expired'])->default('pending_receipt');
            $table->string('receipt_reference', 160)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();
            $table->text('admin_note')->nullable();
            $table->timestamps();
            $table->index(['business_id', 'status', 'end_date']);
        });
    }

    public function down(): void { Schema::dropIfExists('subscriptions'); }
};
