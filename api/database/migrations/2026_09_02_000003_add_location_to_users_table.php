<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M1 (Phase 3): persist the user's chosen location until they change it.
     * Nullable columns only — existing data untouched.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('is_active');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $table->string('location_label')->nullable()->after('longitude');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude', 'location_label']);
        });
    }
};
