<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('designers', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('display_name', 120);
            $table->string('slug', 150)->unique();
            $table->text('bio')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->json('social_links')->nullable();
            $table->enum('status', ['pending', 'approved', 'rejected', 'suspended'])->default('pending');
            $table->text('moderation_note')->nullable();
            $table->timestamps();
            $table->index(['status', 'display_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('designers');
    }
};
