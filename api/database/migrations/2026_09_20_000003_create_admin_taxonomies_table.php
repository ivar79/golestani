<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('admin_taxonomies', function (Blueprint $table): void {
            $table->id();
            $table->string('type', 40);
            $table->foreignId('parent_id')->nullable()->constrained('admin_taxonomies')->nullOnDelete();
            $table->string('name', 160);
            $table->string('slug', 180);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();
            $table->unique(['type', 'slug']);
            $table->index(['type', 'parent_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_taxonomies');
    }
};
