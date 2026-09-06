<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table): void {
            $table->string('logo')->nullable();
            $table->string('cover_image')->nullable();
            // Phase 2 onboarding path tracker: 1 = uploaded, 2 = generated, 3 = designer_order
            $table->integer('onboarding_path')->default(1);
        });

        Schema::table('business_cards', function (Blueprint $table): void {
            $table->string('creation_type', 40)->default('generated'); // uploaded, generated, designer_order
            $table->string('front_image')->nullable();
            $table->string('back_image')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('business_cards', function (Blueprint $table): void {
            $table->dropColumn(['creation_type', 'front_image', 'back_image']);
        });

        Schema::table('businesses', function (Blueprint $table): void {
            $table->dropColumn(['logo', 'cover_image', 'onboarding_path']);
        });
    }
};
