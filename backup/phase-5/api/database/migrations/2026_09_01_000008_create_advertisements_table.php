<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('advertisements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('slot', 60);
            $table->string('title', 160);
            $table->string('target_url', 500);
            $table->string('image_path')->nullable();
            $table->enum('status', ['pending', 'approved', 'rejected', 'expired'])->default('pending');
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->text('admin_note')->nullable();
            $table->timestamps();
            $table->index(['slot', 'status', 'starts_at', 'ends_at']);
        });
    }

    public function down(): void { Schema::dropIfExists('advertisements'); }
};
