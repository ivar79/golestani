<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Profile photo for the logged-in user (Phase 2 UX request, 2026-09-19).
 *
 * Stores the public storage path (e.g. "avatars/01JXXXX.jpg") written by
 * POST /auth/avatar; null until the user uploads one. No backfill needed —
 * every existing user simply has no profile photo yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('avatar')->nullable()->after('username');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('avatar');
        });
    }
};
