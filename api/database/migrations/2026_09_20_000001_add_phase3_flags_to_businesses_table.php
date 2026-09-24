<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 3 approved additions — lightweight preparation fields.
 *
 * Scope guardrails (per approved implementation prompt):
 *  - businesses.user_id stays NOT NULL; ownership architecture is untouched.
 *  - No new indexes: sorting happens after filtering on a near-zero-cardinality
 *    flag; add one only if profiling proves it is required.
 *  - Existing rows inherit the defaults (is_claimed = true, is_promoted = false).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table): void {
            $table->boolean('is_promoted')->default(false);
            $table->boolean('is_claimed')->default(true);
            $table->unsignedTinyInteger('verification_level')->default(0);
            $table->string('license_tracking_code')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table): void {
            $table->dropColumn(['is_promoted', 'is_claimed', 'verification_level', 'license_tracking_code']);
        });
    }
};
