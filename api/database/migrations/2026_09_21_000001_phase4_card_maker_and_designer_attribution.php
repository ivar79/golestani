<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 1. Add referral_code to designers table
        if (Schema::hasTable('designers') && ! Schema::hasColumn('designers', 'referral_code')) {
            Schema::table('designers', function (Blueprint $table): void {
                $table->string('referral_code', 32)->nullable()->unique()->after('slug');
            });
        }

        // 2. Add designer_id to businesses table (nullable foreign key)
        if (Schema::hasTable('businesses') && ! Schema::hasColumn('businesses', 'designer_id')) {
            Schema::table('businesses', function (Blueprint $table): void {
                $table->foreignId('designer_id')->nullable()->constrained('designers')->nullOnDelete()->after('user_id');
            });
        }

        // 3. Add print file and typography fields to business_cards table
        if (Schema::hasTable('business_cards')) {
            Schema::table('business_cards', function (Blueprint $table): void {
                if (! Schema::hasColumn('business_cards', 'print_file_path')) {
                    $table->string('print_file_path')->nullable()->after('back_image');
                }
                if (! Schema::hasColumn('business_cards', 'print_file_name')) {
                    $table->string('print_file_name')->nullable()->after('print_file_path');
                }
                if (! Schema::hasColumn('business_cards', 'print_file_mime')) {
                    $table->string('print_file_mime', 100)->nullable()->after('print_file_name');
                }
                if (! Schema::hasColumn('business_cards', 'font_family')) {
                    $table->string('font_family', 40)->default('sans')->after('font_size');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('business_cards')) {
            Schema::table('business_cards', function (Blueprint $table): void {
                $cols = array_filter(
                    ['print_file_path', 'print_file_name', 'print_file_mime', 'font_family'],
                    fn ($c) => Schema::hasColumn('business_cards', $c)
                );
                if (! empty($cols)) {
                    $table->dropColumn($cols);
                }
            });
        }

        if (Schema::hasTable('businesses') && Schema::hasColumn('businesses', 'designer_id')) {
            Schema::table('businesses', function (Blueprint $table): void {
                $table->dropConstrainedForeignId('designer_id');
            });
        }

        if (Schema::hasTable('designers') && Schema::hasColumn('designers', 'referral_code')) {
            Schema::table('designers', function (Blueprint $table): void {
                $table->dropColumn('referral_code');
            });
        }
    }
};
