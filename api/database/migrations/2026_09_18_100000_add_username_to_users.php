<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Unique public username per user (Phase 2 UX request, 2026-09-18).
 *
 * Users log in with OTP on their phone, then choose a human handle that must
 * be globally unique. Rules: 3-30 chars, lowercase latin letters / digits /
 * underscore, must start with a letter or digit. Enforced by a CHECK so the
 * rule survives any future client, plus a unique index for lookups.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('username', 30)->nullable()->after('phone');
        });

        // Normalize before indexing: trim + lowercase so 'Ali' and 'ali '
        // collapse to one canonical form.
        DB::table('users')->whereNotNull('username')->update([
            'username' => DB::raw('lower(trim(username))'),
        ]);

        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement("ALTER TABLE users ADD CONSTRAINT users_username_format_chk CHECK (username ~ '^[a-z0-9][a-z0-9_]{2,29}$')");
        }

        Schema::table('users', function (Blueprint $t): void {
            $t->unique('username');
        });
    }

    public function down(): void
    {
        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format_chk');
        }
        Schema::table('users', function (Blueprint $table): void {
            $table->dropUnique(['username']);
            $table->dropColumn('username');
        });
    }
};
