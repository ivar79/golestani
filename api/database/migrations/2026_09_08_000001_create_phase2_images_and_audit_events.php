<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void
    {
        Schema::create('business_images', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->string('alt', 160)->nullable();
            $table->timestamps();
        });
        Schema::create('audit_events', function (Blueprint $table): void {
            $table->id();
            // No cascading foreign keys: deleted objects keep their audit history.
            $table->unsignedBigInteger('actor_id')->nullable()->index();
            $table->string('event', 100)->index();
            $table->string('subject_type', 60);
            $table->unsignedBigInteger('subject_id')->nullable();
            $table->json('metadata');
            $table->timestamp('created_at')->useCurrent()->index();
            $table->index(['subject_type', 'subject_id']);
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('business_images');
        Schema::dropIfExists('audit_events');
    }
};
