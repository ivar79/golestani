<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('business_cards', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('template', 40)->default('classic');
            $table->string('theme', 40)->default('navy');
            $table->string('font_size', 20)->default('medium');
            $table->string('export_format', 10)->nullable();
            $table->timestamp('exported_at')->nullable();
            $table->timestamps();
            $table->unique(['business_id', 'template']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_cards');
    }
};
