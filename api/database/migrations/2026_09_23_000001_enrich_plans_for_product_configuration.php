<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Plan = product configuration, editable from the Admin Panel without any
 * code change. Adds identity, display, and pricing metadata to the Phase 5
 * table while keeping `features` (JSON) and `is_active` as the existing
 * lifecycle contract.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('plans')) {
            return;
        }

        Schema::table('plans', function (Blueprint $table): void {
            if (! Schema::hasColumn('plans', 'slug')) {
                // Stable identity used by URLs/exports. Never client-chosen
                // at purchase time; renamed only by an admin.
                $table->string('slug', 120)->nullable()->unique()->after('name');
            }
            if (! Schema::hasColumn('plans', 'description')) {
                $table->text('description')->nullable()->after('slug');
            }
            if (! Schema::hasColumn('plans', 'currency')) {
                // Extensible pricing: amount + currency now, billing_period
                // can be added later without touching existing rows.
                $table->string('currency', 10)->default('IRR')->after('price');
            }
            if (! Schema::hasColumn('plans', 'sort_order')) {
                $table->unsignedInteger('sort_order')->default(0)->after('features');
            }
            if (! Schema::hasColumn('plans', 'is_featured')) {
                $table->boolean('is_featured')->default(false)->after('sort_order');
            }
            if (! Schema::hasColumn('plans', 'is_public')) {
                // Admin can keep a plan purchasable-but-hidden (or visible for
                // display only) — pricing page renders only is_public rows.
                $table->boolean('is_public')->default(true)->after('is_featured');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('plans')) {
            return;
        }

        Schema::table('plans', function (Blueprint $table): void {
            $cols = array_filter(
                ['slug', 'description', 'currency', 'sort_order', 'is_featured', 'is_public'],
                fn (string $c) => Schema::hasColumn('plans', $c)
            );
            if (! empty($cols)) {
                $table->dropColumn($cols);
            }
        });
    }
};
