<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('business_reports', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reporter_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('type', 60);
            $table->text('message');
            $table->string('status', 30)->default('open');
            $table->text('admin_note')->nullable();
            $table->timestamps();
            $table->index(['status', 'created_at']);
            $table->index(['business_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_reports');
    }
};
