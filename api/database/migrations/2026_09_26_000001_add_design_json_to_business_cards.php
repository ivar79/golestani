<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // PHASE 4 (layered card editor): the editor document is additive —
        // NULL means "render with the template renderer" (existing cards keep
        // working verbatim). No data migration is needed.
        if (Schema::hasTable('business_cards') && ! Schema::hasColumn('business_cards', 'design_json')) {
            Schema::table('business_cards', function (Blueprint $table): void {
                $table->jsonb('design_json')->nullable()->after('print_file_mime');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('business_cards') && Schema::hasColumn('business_cards', 'design_json')) {
            Schema::table('business_cards', function (Blueprint $table): void {
                $table->dropColumn('design_json');
            });
        }
    }
};
