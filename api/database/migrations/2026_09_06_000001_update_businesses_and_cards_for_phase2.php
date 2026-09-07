<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public bool $withinTransaction = false;

    public function up(): void
    {
        if (Schema::hasTable('businesses')) {
            if (! Schema::hasColumn('businesses', 'logo')) {
                Schema::table('businesses', function (Blueprint $table): void {
                    $table->string('logo')->nullable();
                });
            }

            if (! Schema::hasColumn('businesses', 'cover_image')) {
                Schema::table('businesses', function (Blueprint $table): void {
                    $table->string('cover_image')->nullable();
                });
            }

            if (! Schema::hasColumn('businesses', 'onboarding_path')) {
                Schema::table('businesses', function (Blueprint $table): void {
                    // Phase 2 onboarding path tracker: 1 = uploaded, 2 = generated, 3 = designer_order
                    $table->integer('onboarding_path')->default(1);
                });
            }
        }

        if (Schema::hasTable('business_cards')) {
            if (! Schema::hasColumn('business_cards', 'creation_type')) {
                Schema::table('business_cards', function (Blueprint $table): void {
                    $table->string('creation_type', 40)->default('generated'); // uploaded, generated, designer_order
                });
            }

            if (! Schema::hasColumn('business_cards', 'front_image')) {
                Schema::table('business_cards', function (Blueprint $table): void {
                    $table->string('front_image')->nullable();
                });
            }

            if (! Schema::hasColumn('business_cards', 'back_image')) {
                Schema::table('business_cards', function (Blueprint $table): void {
                    $table->string('back_image')->nullable();
                });
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('business_cards')) {
            Schema::table('business_cards', function (Blueprint $table): void {
                $columnsToDrop = array_filter(
                    ['creation_type', 'front_image', 'back_image'],
                    fn ($col) => Schema::hasColumn('business_cards', $col)
                );
                if (! empty($columnsToDrop)) {
                    $table->dropColumn($columnsToDrop);
                }
            });
        }

        if (Schema::hasTable('businesses')) {
            Schema::table('businesses', function (Blueprint $table): void {
                $columnsToDrop = array_filter(
                    ['logo', 'cover_image', 'onboarding_path'],
                    fn ($col) => Schema::hasColumn('businesses', $col)
                );
                if (! empty($columnsToDrop)) {
                    $table->dropColumn($columnsToDrop);
                }
            });
        }
    }
};
