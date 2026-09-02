<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone', 15)->nullable()->unique()->after('remember_token');
            $table->boolean('is_active')->default(true)->after('phone');

            // Auth is phone-first (OTP); these legacy columns stay optional.
            $table->string('name')->nullable()->change();
            $table->string('email')->nullable()->change();
            $table->string('password')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['phone']);
            // Keep the nullable legacy-column changes in place to avoid making
            // existing rows invalid during rollback.
            $table->dropColumn(['phone', 'is_active']);
        });
    }
};
