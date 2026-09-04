<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('portfolios', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('designer_id')->constrained()->cascadeOnDelete();
            $table->string('title', 160);
            $table->text('description')->nullable();
            $table->string('file_path');
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('file_size');
            $table->enum('status', ['pending', 'approved', 'rejected', 'suspended'])->default('pending');
            $table->text('moderation_note')->nullable();
            $table->timestamps();
            $table->index(['designer_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('portfolios');
    }
};
